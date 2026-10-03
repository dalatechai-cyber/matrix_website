'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const {
  blockedByMaintenance, isTestToken, isTestRequest, testCookieHeader, maintenancePage, TEST_DEPOSIT_MNT,
} = require('./config/siteMode');
const webhookRouter = require('./routes/webhooks');
const qpayRouter = require('./routes/qpay');
const calendarRouter = require('./routes/calendar');
const { getCalendarClient } = require('./services/googleCalendar');
const { PAGES, renderPage } = require('./lib/pages');
const { publicBranches } = require('./lib/publicBranches');

const app = express();

app.use(express.json());

/**
 * The site's pages are served from here, not as static files (vercel.json),
 * so SITE_MAINTENANCE can replace every page with the maintenance notice, and
 * so lib/pages.js can add the shared header, footer and branch details.
 * ?test=<BOOKING_TEST_TOKEN> on any page marks the tester's browser; the
 * token is then dropped from the address bar.
 */
const RETIRED_PAGES = new Set(['team']);
app.get(['/', '/:page.html'], (req, res, next) => {
  const page = req.params.page || 'index';
  // The old team page now lives as the home page's «Манай үсчид» section.
  if (RETIRED_PAGES.has(page)) return res.redirect(301, page === 'team' ? '/#team' : '/');
  if (!PAGES.includes(page)) return next();

  if (typeof req.query.test === 'string') {
    if (isTestToken(req.query.test)) res.setHeader('Set-Cookie', testCookieHeader());
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
  return res.json({ test, testDeposit: test ? TEST_DEPOSIT_MNT : null });
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

app.use('/api/webhooks', webhookRouter);
app.use('/api/qpay', qpayRouter);
app.use('/api/calendar', calendarRouter);

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
