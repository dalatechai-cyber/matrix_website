'use strict';

/**
 * SITE_MAINTENANCE and the tester's bypass (config/siteMode.js).
 * Maintenance must replace every page and stop new payments, but never block
 * a customer who has already paid.
 */

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const http = require('node:http');

process.env.QPAY_USERNAME = 'u';
process.env.QPAY_PASSWORD = 'p';
process.env.SALON_CLOSURE_START = 'none';

const Module = require('node:module');
const originalLoad = Module._load;
const calls = { insert: 0, qpay: 0 };
Module._load = function (request) {
  if (request === 'googleapis') {
    return {
      google: {
        auth: { JWT: class { async authorize() { return {}; } } },
        calendar: () => ({
          freebusy: { query: async () => ({ data: { calendars: {} } }) },
          events: {
            get: async () => { const e = new Error('nf'); e.code = 404; throw e; },
            insert: async ({ requestBody }) => { calls.insert += 1; return { data: { id: requestBody.id || 'e1' } }; },
          },
        }),
      },
    };
  }
  if (request === 'axios') {
    return {
      post: async () => { calls.qpay += 1; return { data: { access_token: 't', invoice_id: 'inv', count: 0, rows: [] } }; },
      get: async () => { calls.qpay += 1; return { data: {} }; },
    };
  }
  return originalLoad.apply(this, arguments);
};

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'a@b.c';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';
const app = require('../server');
const createPaymentHandler = require('../api/qpay/create-payment');
const { MAINTENANCE_MESSAGE, MESSENGER_URL, TEST_COOKIE } = require('../config/siteMode');

const TOKEN = 'test-token-0123456789abcdef';

function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const payload = body ? JSON.stringify(body) : '';
      const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
      if (cookie) headers.Cookie = cookie;
      const req = http.request({ port: server.address().port, method, path, headers }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, headers: res.headers, text: data }); });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.end(payload);
    });
  });
}

function invokeStandalone(body, cookie) {
  return new Promise((resolve) => {
    createPaymentHandler({ method: 'POST', headers: cookie ? { cookie } : {}, body },
      { status(c) { this.c = c; return this; }, json(b) { resolve({ status: this.c, body: b }); } });
  });
}

async function testCookie() {
  const r = await request('GET', `/?test=${TOKEN}`);
  const set = [].concat(r.headers['set-cookie'] || [])[0] || '';
  return set.split(';')[0];
}

const PAGES = ['/', '/index.html', '/services.html', '/team.html', '/zurag.html', '/products.html', '/keune-products.html'];

beforeEach(() => {
  delete process.env.SITE_MAINTENANCE;
  process.env.BOOKING_TEST_TOKEN = TOKEN;
  calls.insert = 0; calls.qpay = 0;
});

test('maintenance off (default): every page is the real page', async () => {
  delete process.env.BOOKING_TEST_TOKEN;
  for (const p of PAGES) {
    const r = await request('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(r.text.includes('Matrix Eco'), p);
    assert.ok(!r.text.includes(MAINTENANCE_MESSAGE), p);
  }
  const booking = await request('GET', '/');
  assert.ok(booking.text.includes('id="booking"'));
});

test('an unknown .html path is not served from here', async () => {
  const r = await request('GET', '/secret.html');
  assert.equal(r.status, 404);
});

test('maintenance on: every page shows the notice with Messenger and both numbers, nothing to book', async () => {
  process.env.SITE_MAINTENANCE = 'on';
  for (const p of PAGES) {
    const r = await request('GET', p);
    assert.equal(r.status, 503, p);
    assert.ok(r.text.includes(MAINTENANCE_MESSAGE), p);
    assert.ok(r.text.includes(MESSENGER_URL), p);
    assert.ok(r.text.includes('tel:+97676001888') && r.text.includes('tel:+97680905498'), p);
    assert.ok(!r.text.includes('<script'), 'no booking script on the maintenance page');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('maintenance on: no availability and no new invoice on either payment path', async () => {
  process.env.SITE_MAINTENANCE = 'on';
  const slots = await request('GET', '/api/calendar/available-slots?date=2035-06-04&stylistId=anand');
  assert.equal(slots.status, 503);
  const express = await request('POST', '/api/qpay/create-payment', { body: { name: 'a', phone: '1', amount: 20000, description: 'x' } });
  assert.equal(express.status, 503);
  assert.equal(JSON.parse(express.text).error, MAINTENANCE_MESSAGE);
  const standalone = await invokeStandalone({ amount: 20000, staffName: 'Ананд', customerGender: 'male', depositTermsAccepted: true });
  assert.equal(standalone.status, 503);
  assert.equal(calls.qpay, 0, 'QPay never called');
});

test('maintenance on: a customer who already paid still gets booked', async () => {
  process.env.SITE_MAINTENANCE = 'on';
  const r = await request('POST', '/api/calendar/book', {
    body: { stylistId: 'Ананд', startTime: '2035-06-04T14:00:00+08:00', customerPhone: '99112233', customerGender: 'male', invoiceId: 'inv_paid' },
  });
  assert.equal(r.status, 200);
  assert.equal(calls.insert, 1);
});

test('test link: sets a signed cookie, strips the token from the address bar, bypasses maintenance', async () => {
  process.env.SITE_MAINTENANCE = 'on';
  const r = await request('GET', `/team.html?test=${TOKEN}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/team.html');
  const cookie = [].concat(r.headers['set-cookie'])[0];
  assert.ok(cookie.startsWith(`${TEST_COOKIE}=`) && /HttpOnly/.test(cookie) && /Secure/.test(cookie));
  assert.ok(!cookie.includes(TOKEN), 'the token itself is never stored in the cookie');
  const page = await request('GET', '/', { cookie: cookie.split(';')[0] });
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes(MAINTENANCE_MESSAGE));
  const slots = await request('GET', '/api/calendar/available-slots?date=2035-06-04&stylistId=anand', { cookie: cookie.split(';')[0] });
  assert.notEqual(slots.status, 503);
});

test('a wrong token, a forged cookie, or a too-short configured token gives no bypass', async () => {
  process.env.SITE_MAINTENANCE = 'on';
  const wrong = await request('GET', '/?test=wrong-token-0123456789');
  assert.equal(wrong.status, 302);
  assert.equal(wrong.headers['set-cookie'], undefined);
  const forged = await request('GET', '/', { cookie: `${TEST_COOKIE}=deadbeef` });
  assert.equal(forged.status, 503);
  process.env.BOOKING_TEST_TOKEN = 'short';
  const short = await request('GET', '/?test=short');
  assert.equal(short.headers['set-cookie'], undefined);
});

test('changing BOOKING_TEST_TOKEN invalidates old test cookies', async () => {
  process.env.SITE_MAINTENANCE = 'on';
  const cookie = await testCookie();
  process.env.BOOKING_TEST_TOKEN = 'another-token-0123456789abcdef';
  const r = await request('GET', '/', { cookie });
  assert.equal(r.status, 503);
});
