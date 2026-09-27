'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const {
  blockedByMaintenance, isTestToken, testCookieHeader, maintenancePage,
} = require('./config/siteMode');
const webhookRouter = require('./routes/webhooks');
const qpayRouter = require('./routes/qpay');
const calendarRouter = require('./routes/calendar');
const { getCalendarClient } = require('./services/googleCalendar');

const app = express();

app.use(express.json());

/**
 * The site's pages are served from here, not as static files (vercel.json),
 * so SITE_MAINTENANCE can replace every page with the maintenance notice.
 * ?test=<BOOKING_TEST_TOKEN> on any page marks the tester's browser; the
 * token is then dropped from the address bar.
 */
const PAGES = new Set(['index', 'services', 'team', 'zurag', 'products', 'keune-products']);
app.get(['/', '/:page.html'], (req, res, next) => {
  const page = req.params.page || 'index';
  if (!PAGES.has(page)) return next();

  if (typeof req.query.test === 'string') {
    if (isTestToken(req.query.test)) res.setHeader('Set-Cookie', testCookieHeader());
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, req.path);
  }

  if (blockedByMaintenance(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '3600');
    return res.status(503).type('html').send(maintenancePage());
  }

  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  return res.sendFile(path.join(__dirname, `${page}.html`), (err) => {
    if (err && !res.headersSent) next(err);
  });
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
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Matrix Salon server running on port ${PORT}`);
  });
}

module.exports = app;
