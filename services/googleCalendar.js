'use strict';

const { google } = require('googleapis');

/**
 * Normalise the GOOGLE_PRIVATE_KEY environment variable value into a valid
 * PEM private key string.
 *
 * Vercel and other hosting platforms can store the key in several ways:
 *   1. With literal "\n" two-character sequences (most common when the user
 *      pastes the raw JSON string value from credentials.json).
 *   2. With actual newline characters (when the user pastes the real PEM
 *      block including its line breaks).
 *   3. Wrapped in surrounding double-quotes by accident.
 *
 * @param {string} raw  The raw value of process.env.GOOGLE_PRIVATE_KEY
 * @returns {string}    A PEM-formatted private key string
 */
function normalisePrivateKey(raw) {
  let key = raw;

  // Strip a single layer of surrounding double- or single-quotes that users
  // sometimes accidentally include when pasting into Vercel's env-var input.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  // Replace literal two-character sequences "\n" with real newline characters.
  // This covers the most common Vercel case where the JSON string value is
  // pasted verbatim (newlines stored as the escape sequence).
  key = key.replace(/\\n/g, '\n');

  return key;
}

/**
 * Return an authenticated Google Calendar client using a service account.
 *
 * Credentials are read from environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL – the service account client_email
 *   GOOGLE_PRIVATE_KEY            – the private key PEM string.
 *                                   Copy the value of the "private_key" field
 *                                   from your credentials.json (the raw JSON
 *                                   string including literal \n sequences) and
 *                                   paste it directly into Vercel's env-var UI.
 *                                   Do NOT wrap the value in extra quotes.
 *
 * The service account must have been granted access to each stylist calendar:
 *   share each Google Calendar with the service account email address and grant
 *   at least "Make changes to events" (writer) permission.
 *
 * @returns {Promise<import('googleapis').calendar_v3.Calendar>}
 */
async function getCalendarClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error(
      'Missing required environment variable: GOOGLE_SERVICE_ACCOUNT_EMAIL. ' +
      'Set it to the client_email value from your Google service account credentials.json.',
    );
  }
  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error(
      'Missing required environment variable: GOOGLE_PRIVATE_KEY. ' +
      'Set it to the private_key value from your Google service account credentials.json ' +
      '(paste the raw JSON string value including the \\n sequences; do not add extra quotes).',
    );
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim();
  const key = normalisePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  // Sanity-check: a valid PEM private key must start with the header line.
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY does not appear to be a valid PEM private key. ' +
      'Ensure you copied the private_key value from credentials.json correctly ' +
      'and that it starts with "-----BEGIN PRIVATE KEY-----".',
    );
  }

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  try {
    await auth.authorize();
  } catch (authErr) {
    throw new Error(
      `Google service account authentication failed: ${authErr.message}. ` +
      'Check that GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are correct, ' +
      'the Google Calendar API is enabled for your GCP project, and the service account ' +
      'has been shared with the relevant calendars.',
    );
  }

  return google.calendar({ version: 'v3', auth });
}

module.exports = { getCalendarClient, normalisePrivateKey };
