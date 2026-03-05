'use strict';

const { google } = require('googleapis');

/**
 * Return an authenticated Google Calendar client using a service account.
 *
 * Credentials are read from environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL – the service account client_email
 *   GOOGLE_PRIVATE_KEY            – the private key (Vercel encodes newlines as \n)
 *
 * The service account must have been granted access to each stylist calendar
 * (share the calendar with the service account email address).
 *
 * @returns {Promise<import('googleapis').calendar_v3.Calendar>}
 */
async function getCalendarClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error('Missing required environment variable: GOOGLE_SERVICE_ACCOUNT_EMAIL');
  }
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Missing required environment variable: GOOGLE_PRIVATE_KEY');
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  await auth.authorize();
  return google.calendar({ version: 'v3', auth });
}

module.exports = { getCalendarClient };
