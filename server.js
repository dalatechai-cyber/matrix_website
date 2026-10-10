'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const {
  blockedByMaintenance, isTestToken, isTestRequest, testCookieHeader, maintenancePage, TEST_DEPOSIT_MNT,
  testRejectedCookieHeader, clearTestRejectedCookieHeader, testLinkRejected,
} = require('./config/siteMode');
const webhookRouter = require('./routes/webhooks');
const qpayRouter = require('./routes/qpay');
const calendarRouter = require('./routes/calendar');
const setupRouter = require('./routes/setup');
const { getCalendarClient } = require('./services/googleCalendar');
const { PAGES, renderPage } = require('./lib/pages');
const { publicBranches } = require('./lib/publicBranches');
const { redirectTarget, canonicalOriginFor } = require('./config/canonicalHost');

const app = express();

app.use(express.json());

// CANONICAL_HOST (config/canonicalHost.js; off unless set): a page opened on
// the old address answers 301 to the same page on the canonical one. /api/*
// is never redirected, so callbacks to the old host keep working.
app.use((req, res, next) => {
  const target = redirectTarget(req);
  if (target === null) return next();
  // Bounded, so a rollback reaches browsers within the hour (an un-headed 301 is cached for ever).
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.redirect(301, target);
});

/**
 * The site's pages are served from here, not as static files (vercel.json),
 * so SITE_MAINTENANCE can replace every page with the maintenance notice, and
 * so lib/pages.js can add the shared header, footer and branch details.
 * ?test=<BOOKING_TEST_TOKEN> on any page marks the tester's browser; the
 * token is then dropped from the address bar.
 */
// Retired pages: team → the home page's «Манай үсчид»; zurag («Бүтээл», removed
// 2026-10-04: its photos were Matrix's) → home until Tara's own gallery exists.
const RETIRED_PAGES = new Set(['team', 'zurag']);
app.get(['/', '/:page.html'], (req, res, next) => {
  const page = req.params.page || 'index';
  // The old team page now lives as the home page's «Манай үсчид» section.
  if (RETIRED_PAGES.has(page)) return res.redirect(301, page === 'team' ? '/#team' : '/');
  if (!PAGES.includes(page)) return next();

  if (typeof req.query.test === 'string') {
    res.setHeader('Set-Cookie', isTestToken(req.query.test)
      ? [testCookieHeader(), clearTestRejectedCookieHeader()]
      : [testRejectedCookieHeader()]);
    res.setHeader('Cache-Control', 'no-store');
    // Drop only the token; keep e.g. ?branch=yaarmag.
    const rest = new URLSearchParams(req.originalUrl.split('?')[1] || '');
    rest.delete('test');
    const qs = rest.toString();
    return res.redirect(302, qs ? `${req.path}?${qs}` : req.path);
  }

  if (blockedByMaintenance(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '3600');
    return res.status(503).type('html').send(maintenancePage());
  }

  let html;
  try {
    html = renderPage(page, { origin: pageOrigin(req) });
  } catch (err) {
    return next(err);
  }
  if (html == null) return next();
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return res.type('html').send(html);
});

/** Public origin for canonical and social-preview links. */
function pageOrigin(req) {
  const canonical = canonicalOriginFor(req);
  if (canonical !== null) return canonical;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return process.env.BASE_URL || '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

// Tells the booking page whether this browser is the tester's (the test
// cookie is HttpOnly), so it can show the test banner and the 100₮ deposit.
app.get('/api/site-mode', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const test = isTestRequest(req);
  return res.json({ test, testDeposit: test ? TEST_DEPOSIT_MNT : null, testLinkRejected: testLinkRejected(req) });
});

/**
 * GET /api/branches — what the booking page needs to start: each branch's
 * public details, whether it takes online bookings, and its hairdressers
 * (name, tier, deposit, gender, photo). Calendar ids and QPay settings never
 * leave the server. The one list, so the page cannot drift from the server.
 */
app.get('/api/branches', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ branches: publicBranches() });
});

// robots.txt and the sitemap name the public origin (the canonical host when
// CANONICAL_HOST is set). Served by this function (vercel.json).
app.get('/robots.txt', (req, res) => {
  const origin = pageOrigin(req);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
});
app.get('/sitemap.xml', (req, res) => {
  const origin = pageOrigin(req);
  if (!origin) return res.status(404).type('text/plain').send('Not found');
  const urls = PAGES.map((p) => `  <url><loc>${origin}${p === 'index' ? '/' : `/${p}.html`}</loc></url>`).join('\n');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

app.use('/api/webhooks', webhookRouter);
app.use('/api/qpay', qpayRouter);
app.use('/api/calendar', calendarRouter);
// Preview-only setup check for connecting calendars (404 on Production).
app.use('/api/setup', setupRouter);

/**
 * GET /api/health
 *
 * Diagnostic endpoint that checks whether the required environment variables
 * are present and whether the Google Calendar service account can authenticate.
 * Useful for verifying a Vercel deployment is configured correctly.
 *
 * Returns HTTP 200 when everything is healthy, HTTP 500 with a descriptive
 * error message when something is missing or misconfigured.
 */
app.get('/api/health', async (_req, res) => {
  const checks = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
    QPAY_USERNAME: !!process.env.QPAY_USERNAME,
    QPAY_PASSWORD: !!process.env.QPAY_PASSWORD,
    BASE_URL: !!process.env.BASE_URL,
  };

  const missingVars = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (missingVars.length > 0) {
    return res.status(500).json({
      status: 'error',
      message: `Missing environment variables: ${missingVars.join(', ')}`,
    });
  }

  // Test Google Calendar authentication
  try {
    await getCalendarClient();
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: `Google Calendar authentication failed: ${err.message}`,
    });
  }

  return res.status(200).json({ status: 'ok' });
});

if (require.main === module) {
  // Local development only: on Vercel, static files are served by the platform
  // (vercel.json), never by this function.
  app.use(express.static(__dirname, { index: false }));
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Tara Salon server running on port ${PORT}`);
  });
}

module.exports = app;
