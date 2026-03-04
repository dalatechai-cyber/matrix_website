'use strict';

const path = require('path');
const { google } = require('googleapis');

/**
 * Path to the service account key file.
 * Override by setting the GOOGLE_APPLICATION_CREDENTIALS environment variable.
 */
const DEFAULT_KEY_FILE = path.join(__dirname, '..', 'credentials.json');

/**
 * Return an authenticated Google Calendar client using a service account.
 *
 * The service account key file must be a JSON file obtained from the Google
 * Cloud Console (IAM & Admin → Service Accounts → Create key → JSON).
 * The service account must have been granted access to each stylist calendar
 * (share the calendar with the service account email address).
 *
 * @returns {Promise<import('googleapis').calendar_v3.Calendar>}
 */
async function getCalendarClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_KEY_FILE;
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const authClient = await auth.getClient();
  return google.calendar({ version: 'v3', auth: authClient });
}

module.exports = { getCalendarClient };
