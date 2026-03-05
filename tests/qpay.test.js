'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const express = require('express');

// ---------------------------------------------------------------------------
// Stub axios before loading any QPay modules so no real HTTP calls are made.
// The stub supports a call-sequence queue: each element is { result, error }.
// ---------------------------------------------------------------------------
const axiosStub = {
  _queue: [],
  _callIndex: 0,
  _calls: [],
  reset(responses) {
    this._queue = responses || [];
    this._callIndex = 0;
    this._calls = [];
  },
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') {
    return {
      post: async (_url, _body, _opts) => {
        axiosStub._calls.push({ url: _url, body: _body, opts: _opts });
        const entry = axiosStub._queue[axiosStub._callIndex] ||
                      axiosStub._queue[axiosStub._queue.length - 1] ||
                      { result: null };
        axiosStub._callIndex++;
        if (entry.error) throw entry.error;
        return { data: entry.result };
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Set dummy env vars so getQPayToken does not complain
process.env.QPAY_USERNAME = 'test_user';
process.env.QPAY_PASSWORD = 'test_pass';
process.env.BASE_URL = 'https://test.example.com';
process.env.QPAY_MERCHANT_ID = 'TEST_MERCHANT_ID';
// Set dummy Google env vars (used by the webhook calendar path)
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';

// Load modules after stubs are in place
const qpayService = require('../services/qpay');
const qpayRouter = require('../routes/qpay');
// Access the shared in-memory store exported from the router module
const { paymentStatuses } = qpayRouter;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/qpay', qpayRouter);
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data ? Buffer.byteLength(data) : 0,
        },
      };
      const req = http.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Token caching tests
// ---------------------------------------------------------------------------
test('getQPayToken: fetches a new token when cache is empty', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([{ result: { access_token: 'tok_abc' } }]);

  const token = await qpayService.getQPayToken();
  assert.equal(token, 'tok_abc');
});

test('getQPayToken: returns cached token without a second network call', async () => {
  // Cache still holds 'tok_abc'; reset queue to a different value to detect re-fetch
  axiosStub.reset([{ result: { access_token: 'tok_NEW' } }]);
  const token = await qpayService.getQPayToken();
  assert.equal(token, 'tok_abc');
});

test('getQPayToken: sends terminal_id as hardcoded DALATECH_AI in the token request body', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([{ result: { access_token: 'tok_tid' } }]);

  await qpayService.getQPayToken();

  const tokenCall = axiosStub._calls[0];
  assert.ok(tokenCall, 'expected at least one axios.post call');
  assert.deepEqual(tokenCall.body, { terminal_id: 'DALATECH_AI' });
});

test('getQPayToken: throws when env vars are missing', async () => {
  qpayService._resetTokenCache();
  const savedUser = process.env.QPAY_USERNAME;
  const savedPass = process.env.QPAY_PASSWORD;
  delete process.env.QPAY_USERNAME;
  delete process.env.QPAY_PASSWORD;

  await assert.rejects(() => qpayService.getQPayToken(), /environment variables/);

  process.env.QPAY_USERNAME = savedUser;
  process.env.QPAY_PASSWORD = savedPass;
});

test('createInvoice: throws when QPAY_MERCHANT_ID env var is missing', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([{ result: { access_token: 'tok_mid' } }]);
  const savedMerchantId = process.env.QPAY_MERCHANT_ID;
  delete process.env.QPAY_MERCHANT_ID;

  await assert.rejects(
    () => qpayService.createInvoice({ amount: 20000, description: 'Test', callbackUrl: 'https://example.com/cb' }),
    /QPAY_MERCHANT_ID/,
  );

  process.env.QPAY_MERCHANT_ID = savedMerchantId;
});

// ---------------------------------------------------------------------------
// POST /api/qpay/create-payment
// ---------------------------------------------------------------------------
test('create-payment: 400 when name is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { phone: '99001122', amount: '20000', description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Test - 99001122' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('required'));
});

test('create-payment: 400 when phone is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { name: 'Test', amount: '20000', description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Test - 99001122' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('required'));
});

test('create-payment: 400 when amount is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { name: 'Test', phone: '99001122', description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Test - 99001122' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('required'));
});

test('create-payment: 400 when description is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { name: 'Test', phone: '99001122', amount: '20000' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('required'));
});

test('create-payment: 200 with qr_image, urls, and invoice_id on success', async () => {
  qpayService._resetTokenCache();
  // First call → auth token; second call → invoice response
  axiosStub.reset([
    { result: { access_token: 'tok_seq' } },
    { result: { invoice_id: 'inv_test_001', qr_image: 'data:image/png;base64,abc', urls: [{ name: 'Khan Bank', link: 'khanbank://pay' }] } },
  ]);

  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', {
    name: 'Болд',
    phone: '99001122',
    amount: '20000',
    description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Болд - 99001122',
  });

  assert.equal(status, 200);
  assert.ok(body.qr_image);
  assert.ok(Array.isArray(body.urls));
  assert.equal(body.invoice_id, 'inv_test_001');
});

test('create-payment: invoice stored with full calendar description', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_cal' } },
    { result: { invoice_id: 'inv_cal_001', qr_image: 'data:image/png;base64,xyz', urls: [] } },
  ]);

  const app = buildApp();
  const fullDesc = 'Matrix Eco: Ana - 2026-03-05 14:00 - Болд - 99001122';
  await request(app, 'POST', '/api/qpay/create-payment', {
    name: 'Болд',
    phone: '99001122',
    amount: '20000',
    description: fullDesc,
  });

  assert.equal(paymentStatuses['inv_cal_001']?.description, fullDesc);
  delete paymentStatuses['inv_cal_001'];
});

test('create-payment: 502 when QPay API fails', async () => {
  qpayService._resetTokenCache();
  // Auth token succeeds; invoice call throws
  axiosStub.reset([
    { result: { access_token: 'tok_err' } },
    { error: new Error('QPay network error') },
  ]);

  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', {
    name: 'Болд',
    phone: '99001122',
    amount: '20000',
    description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Болд - 99001122',
  });

  assert.equal(status, 502);
  assert.ok(body.error.includes('QPay'));
});

// ---------------------------------------------------------------------------
// POST /api/qpay/webhook
// ---------------------------------------------------------------------------
test('webhook: 400 when invoice_id is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/webhook', { status: 'PAID' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('invoice_id'));
});

test('webhook: 200 with invoice_id present (invoice_id field) and marks PAID', async () => {
  // Pre-populate the store with a PENDING invoice so the webhook can look it up
  paymentStatuses['inv_123'] = { status: 'PENDING', description: null, createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/webhook', { invoice_id: 'inv_123' });
  assert.equal(status, 200);
  assert.equal(body.invoiceId, 'inv_123');
  assert.equal(body.received, true);
  assert.equal(paymentStatuses['inv_123'].status, 'PAID');
  delete paymentStatuses['inv_123'];
});

test('webhook: 200 with invoice_id present (id field fallback)', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/webhook', { id: 'inv_456' });
  assert.equal(status, 200);
  assert.equal(body.invoiceId, 'inv_456');
});

// ---------------------------------------------------------------------------
// Amount sanitization and description fallback tests
// ---------------------------------------------------------------------------
test('create-payment: cleans amount with commas and currency symbol (e.g. "20,000 ₮" → 20000)', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_clean' } },
    { result: { invoice_id: 'inv_clean_001', qr_image: 'data:image/png;base64,abc', urls: [] } },
  ]);

  const app = buildApp();
  await request(app, 'POST', '/api/qpay/create-payment', {
    name: 'Болд',
    phone: '99001122',
    amount: '20,000 ₮',
    description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Болд - 99001122',
  });

  // Find the invoice call (second axios.post call)
  const invoiceCall = axiosStub._calls[1];
  assert.ok(invoiceCall, 'expected invoice axios.post call');
  assert.equal(invoiceCall.body.amount, 20000, 'amount should be the cleaned value 20000');
  delete paymentStatuses['inv_clean_001'];
});

test('create-payment: payload uses hardcoded QPay v2 fields (merchant_id, currency, mcc_code)', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_desc' } },
    { result: { invoice_id: 'inv_desc_001', qr_image: 'data:image/png;base64,abc', urls: [] } },
  ]);

  const app = buildApp();
  await request(app, 'POST', '/api/qpay/create-payment', {
    name: 'Болд',
    phone: '99001122',
    amount: '20000',
    description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Болд - 99001122',
  });

  const invoiceCall = axiosStub._calls[1];
  assert.ok(invoiceCall, 'expected invoice axios.post call');
  assert.equal(invoiceCall.body.merchant_id, process.env.QPAY_MERCHANT_ID, 'merchant_id should come from QPAY_MERCHANT_ID env var');
  assert.equal(invoiceCall.body.currency, 'MNT', 'currency should be MNT');
  assert.equal(invoiceCall.body.mcc_code, '7230', 'mcc_code should be 7230');
  assert.equal(invoiceCall.body.amount, 20000, 'amount should be the actual booking amount');
  assert.equal(invoiceCall.body.description, 'Болд - 99001122', 'description should be the customer name and phone');
  assert.ok(invoiceCall.body.callback_url, 'callback_url should be present in the payload');
  delete paymentStatuses['inv_desc_001'];
});

test('create-payment: 400 when amount is not a valid number (e.g. letters only)', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', {
    name: 'Болд',
    phone: '99001122',
    amount: 'invalid',
    description: 'Matrix Eco: Ana - 2026-03-05 10:00 - Болд - 99001122',
  });
  assert.equal(status, 400);
  assert.ok(body.error.includes('valid positive number'));
});

test('createInvoice service: logs QPay Payload before sending request', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_log' } },
    { result: { invoice_id: 'inv_log_001', qr_image: 'data:image/png;base64,abc', urls: [] } },
  ]);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args); originalLog(...args); };

  try {
    await qpayService.createInvoice({ amount: 20000, description: 'Болд - 99001122', callbackUrl: 'https://test.example.com/api/qpay/webhook' });
  } finally {
    console.log = originalLog;
  }

  const payloadLog = logs.find((args) => args[0] === 'FINAL TEST PAYLOAD:');
  assert.ok(payloadLog, 'expected a "TEST QPAY PAYLOAD:" log entry');
  assert.equal(payloadLog[1].amount, 20000);
});

// ---------------------------------------------------------------------------
// GET /api/qpay/check-payment/:invoiceId
// ---------------------------------------------------------------------------
test('check-payment: returns UNKNOWN for an untracked invoice', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/qpay/check-payment/nonexistent_inv', null);
  assert.equal(status, 200);
  assert.equal(body.status, 'UNKNOWN');
});

test('check-payment: returns PENDING for a newly created invoice', async () => {
  paymentStatuses['inv_pending'] = { status: 'PENDING', description: 'Test', createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/qpay/check-payment/inv_pending', null);
  assert.equal(status, 200);
  assert.equal(body.status, 'PENDING');
  delete paymentStatuses['inv_pending'];
});

test('check-payment: returns PAID after webhook marks invoice as PAID', async () => {
  paymentStatuses['inv_paid'] = { status: 'PAID', description: null, createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/qpay/check-payment/inv_paid', null);
  assert.equal(status, 200);
  assert.equal(body.status, 'PAID');
  delete paymentStatuses['inv_paid'];
});

// ---------------------------------------------------------------------------
// POST /api/qpay/check-payment
// ---------------------------------------------------------------------------
test('POST check-payment: 400 when invoice_id is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/check-payment', {});
  assert.equal(status, 400);
  assert.ok(body.error.includes('invoice_id'));
});

test('POST check-payment: returns PAID immediately when in-memory status is already PAID', async () => {
  paymentStatuses['inv_already_paid'] = { status: 'PAID', description: null, calendarEventCreated: true, createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/check-payment', { invoice_id: 'inv_already_paid' });
  assert.equal(status, 200);
  assert.equal(body.invoice_status, 'PAID');
  delete paymentStatuses['inv_already_paid'];
});

test('POST check-payment: calls QPay API and returns invoice_status when invoice is PENDING', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_poll' } },
    { result: { invoice_status: 'OPEN' } },
  ]);
  paymentStatuses['inv_open'] = { status: 'PENDING', description: null, calendarEventCreated: false, createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/check-payment', { invoice_id: 'inv_open' });
  assert.equal(status, 200);
  assert.equal(body.invoice_status, 'OPEN');
  delete paymentStatuses['inv_open'];
});

test('POST check-payment: marks invoice as PAID in memory when QPay returns PAID', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_paid_poll' } },
    { result: { invoice_status: 'PAID' } },
  ]);
  paymentStatuses['inv_qpay_paid'] = { status: 'PENDING', description: null, calendarEventCreated: false, createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/check-payment', { invoice_id: 'inv_qpay_paid' });
  assert.equal(status, 200);
  assert.equal(body.invoice_status, 'PAID');
  assert.equal(paymentStatuses['inv_qpay_paid'].status, 'PAID');
  delete paymentStatuses['inv_qpay_paid'];
});

test('POST check-payment: falls back to in-memory UNKNOWN when QPay API fails and invoice is not tracked', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_fallback' } },
    { error: new Error('QPay network error') },
  ]);
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/check-payment', { invoice_id: 'inv_untracked_fail' });
  assert.equal(status, 200);
  assert.equal(body.invoice_status, 'UNKNOWN');
});

test('POST check-payment: falls back to in-memory PENDING when QPay API fails and invoice is PENDING', async () => {
  qpayService._resetTokenCache();
  axiosStub.reset([
    { result: { access_token: 'tok_fallback2' } },
    { error: new Error('QPay network error') },
  ]);
  paymentStatuses['inv_pending_fail'] = { status: 'PENDING', description: null, calendarEventCreated: false, createdAt: Date.now() };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/check-payment', { invoice_id: 'inv_pending_fail' });
  assert.equal(status, 200);
  assert.equal(body.invoice_status, 'PENDING');
  delete paymentStatuses['inv_pending_fail'];
});
