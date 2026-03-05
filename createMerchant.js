'use strict';

/**
 * createMerchant.js
 * -----------------
 * One-time script to register Matrix Salon as a sub-merchant via the QPay v2 API.
 *
 * Usage:
 *   node createMerchant.js
 *
 * Fill in every placeholder below before running.
 * Credentials can also be supplied via environment variables:
 *   QPAY_USERNAME / QPAY_PASSWORD
 *
 * After the merchant is created QPay will return a merchant `id`.
 * Copy that value into your Vercel environment as QPAY_MERCHANT_ID
 * (or whatever variable name your server expects).
 */

// ─── Credentials ─────────────────────────────────────────────────────────────
// Set these here or export them as environment variables before running.
const QPAY_USERNAME = process.env.QPAY_USERNAME || 'YOUR_QPAY_USERNAME';
const QPAY_PASSWORD = process.env.QPAY_PASSWORD || 'YOUR_QPAY_PASSWORD';

// ─── Merchant type ────────────────────────────────────────────────────────────
// Use 'company' if Matrix Salon is registered as a company (most common).
// Use 'person'  if registering as an individual (requires first_name/last_name
//               instead of company_name).
const MERCHANT_TYPE = 'company'; // 'company' | 'person'

// ─── Company payload (used when MERCHANT_TYPE === 'company') ──────────────────
const COMPANY_PAYLOAD = {
  register_number: 'YOUR_COMPANY_REGISTER_NUMBER', // e.g. '1234567'
  company_name:    'Matrix Salon',
  name:            'Matrix Salon',                  // display / short name
  mcc_code:        '7230',                          // MCC 7230 = Beauty Salons
  city:            'Ulaanbaatar',
  district:        'YOUR_DISTRICT',                 // e.g. 'Sukhbaatar'
  address:         'YOUR_FULL_ADDRESS',
  phone:           'YOUR_PHONE_NUMBER',             // e.g. '99001234'
  email:           'YOUR_EMAIL_ADDRESS',            // e.g. 'info@matrixsalon.mn'
};

// ─── Person payload (used when MERCHANT_TYPE === 'person') ───────────────────
const PERSON_PAYLOAD = {
  register_number: 'YOUR_PERSON_REGISTER_NUMBER',  // national ID number
  first_name:      'YOUR_FIRST_NAME',
  last_name:       'YOUR_LAST_NAME',
  name:            'Matrix Salon',
  mcc_code:        '7230',
  city:            'Ulaanbaatar',
  district:        'YOUR_DISTRICT',
  address:         'YOUR_FULL_ADDRESS',
  phone:           'YOUR_PHONE_NUMBER',
  email:           'YOUR_EMAIL_ADDRESS',
};

// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

const QPAY_BASE_URL = 'https://quickqr.qpay.mn/v2';

/**
 * Minimal promise-based HTTP helper so the script has zero extra dependencies.
 * @param {string} url
 * @param {'GET'|'POST'} method
 * @param {object|null} body
 * @param {object} headers
 * @returns {Promise<object>}
 */
function request(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        ...headers,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // ── Step 1: authenticate ──────────────────────────────────────────────────
  if (
    !QPAY_USERNAME || !QPAY_PASSWORD ||
    QPAY_USERNAME === 'YOUR_QPAY_USERNAME' ||
    QPAY_PASSWORD === 'YOUR_QPAY_PASSWORD'
  ) {
    console.error(
      '\nERROR: Please set QPAY_USERNAME and QPAY_PASSWORD ' +
      '(either in this script or as environment variables) before running.\n',
    );
    process.exit(1);
  }

  console.log('Authenticating with QPay…');
  const credentials = Buffer.from(`${QPAY_USERNAME}:${QPAY_PASSWORD}`).toString('base64');

  const authResponse = await request(
    `${QPAY_BASE_URL}/auth/token`,
    'POST',
    {},
    { Authorization: `Basic ${credentials}` },
  );

  if (authResponse.status !== 200 || !authResponse.data.access_token) {
    console.error('\nERROR: Failed to obtain QPay token.');
    console.error('Status:', authResponse.status);
    console.error('Response:', JSON.stringify(authResponse.data, null, 2));
    process.exit(1);
  }

  const accessToken = authResponse.data.access_token;
  console.log('✔ Token obtained.\n');

  // ── Step 2: create the merchant ───────────────────────────────────────────
  const endpoint = `${QPAY_BASE_URL}/merchant/${MERCHANT_TYPE}`;
  const payload  = MERCHANT_TYPE === 'company' ? COMPANY_PAYLOAD : PERSON_PAYLOAD;

  console.log(`Registering merchant via POST ${endpoint}…`);
  console.log('Payload:', JSON.stringify(payload, null, 2), '\n');

  const merchantResponse = await request(
    endpoint,
    'POST',
    payload,
    { Authorization: `Bearer ${accessToken}` },
  );

  console.log('─── Full QPay response ───────────────────────────────────────');
  console.log(JSON.stringify(merchantResponse.data, null, 2));
  console.log('──────────────────────────────────────────────────────────────\n');

  const SUCCESS_STATUSES = [200, 201];
  if (SUCCESS_STATUSES.includes(merchantResponse.status)) {
    if (merchantResponse.status !== 200) {
      // QPay v2 typically returns 200; log a notice if a different 2xx code is seen
      // so that behaviour changes are easy to spot.
      console.warn(
        `NOTICE: Received HTTP ${merchantResponse.status} instead of the expected 200. ` +
        'This may indicate an API change — check the full response above.\n',
      );
    }

    const merchantId = merchantResponse.data.id || merchantResponse.data.merchant_id;
    if (merchantId) {
      console.log('✔ Merchant created successfully!');
      console.log(`\n  ➜  Merchant ID: ${merchantId}\n`);
      console.log(
        'Copy this ID into your Vercel environment variables ' +
        '(e.g. QPAY_MERCHANT_ID) so the app can create invoices.\n',
      );
    } else {
      console.log('✔ Request succeeded but no "id" field was found in the response.');
      console.log('  Check the full response above for the merchant identifier.\n');
    }
  } else {
    console.error(`\nERROR: Unexpected status code ${merchantResponse.status}.`);
    console.error('Check the full response above for details.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err.message || err);
  process.exit(1);
});
