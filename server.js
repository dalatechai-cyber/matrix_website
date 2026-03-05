'use strict';

require('dotenv').config();

const express = require('express');
const webhookRouter = require('./routes/webhooks');
const qpayRouter = require('./routes/qpay');
const calendarRouter = require('./routes/calendar');
const { getCalendarClient } = require('./services/googleCalendar');

const app = express();

app.use(express.json());

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
