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
  reset(responses) {
    this._queue = responses || [];
    this._callIndex = 0;
  },
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') {
    return {
      post: async (_url, _body, _opts) => {
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
// Set dummy Google env vars (used by the webhook calendar path)
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';

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

// ---------------------------------------------------------------------------
// POST /api/qpay/create-payment
// ---------------------------------------------------------------------------
test('create-payment: 400 when merchantId is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { amount: '5000', description: 'Test' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('required'));
});

test('create-payment: 400 when amount is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { merchantId: 'M1', description: 'Test' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('required'));
});

test('create-payment: 400 when description is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', { merchantId: 'M1', amount: '5000' });
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
    merchantId: 'MERCHANT_001',
    amount: '5000',
    description: 'Test haircut booking',
  });

  assert.equal(status, 200);
  assert.ok(body.qr_image);
  assert.ok(Array.isArray(body.urls));
  assert.equal(body.invoice_id, 'inv_test_001');
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
    merchantId: 'MERCHANT_001',
    amount: '5000',
    description: 'Test haircut booking',
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
