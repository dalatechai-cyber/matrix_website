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
process.env.QPAY_MERCHANT_ID = 'm';
process.env.SALON_CLOSURE_START = 'none';

const Module = require('node:module');
const originalLoad = Module._load;
const calls = { insert: 0, qpay: 0, invoices: [], events: [] };
const { createFakeCalendar } = require('./helpers/fakeCalendar');
const fakeCal = createFakeCalendar();
Module._load = function (request) {
  if (request === 'googleapis') {
    return {
      google: {
        auth: { JWT: class { async authorize() { return {}; } } },
        calendar: () => ({
          freebusy: fakeCal.api.freebusy,
          events: {
            ...fakeCal.api.events,
            // Bookings are counted; the 5-minute holds (sh…) are not.
            insert: async (args) => {
              if (!String(args.requestBody.id || '').startsWith('sh')) { calls.insert += 1; calls.events.push(args.requestBody); }
              return fakeCal.api.events.insert(args);
            },
          },
        }),
      },
    };
  }
  if (request === 'axios') {
    return {
      post: async (url, body) => {
        calls.qpay += 1;
        if (String(url).endsWith('/invoice')) calls.invoices.push(body);
        return { data: { access_token: 't', invoice_id: 'inv', count: 0, rows: [] } };
      },
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
    createPaymentHandler({ method: 'POST', headers: cookie ? { cookie, host: 'www.matrixecosalon.org' } : { host: 'www.matrixecosalon.org' }, body },
      { status(c) { this.c = c; return this; }, json(b) { resolve({ status: this.c, body: b }); } });
  });
}

async function testCookie() {
  const r = await request('GET', `/?test=${TOKEN}`);
  const set = [].concat(r.headers['set-cookie'] || [])[0] || '';
  return set.split(';')[0];
}

const PAGES = ['/', '/index.html', '/services.html', '/products.html', '/keune-products.html', '/booking.html', '/contact.html'];

beforeEach(() => {
  delete process.env.SITE_MAINTENANCE;
  process.env.BOOKING_TEST_TOKEN = TOKEN;
  calls.insert = 0; calls.qpay = 0; calls.invoices = []; calls.events = []; fakeCal.reset();
});

test('maintenance off (default): every page is the real page', async () => {
  delete process.env.BOOKING_TEST_TOKEN;
  for (const p of PAGES) {
    const r = await request('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(r.text.includes('Tara Salon'), p);
    assert.ok(!r.text.includes(MAINTENANCE_MESSAGE), p);
  }
  const booking = await request('GET', '/booking.html');
  assert.ok(booking.text.includes('id="booking"'));
  const team = await request('GET', '/team.html');
  assert.equal(team.status, 301, 'the retired team page sends visitors to the team section');
  assert.equal(team.headers.location, '/#team');
  const zurag = await request('GET', '/zurag.html');
  assert.equal(zurag.status, 301, 'the removed gallery sends visitors home');
  assert.equal(zurag.headers.location, '/');
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
    assert.ok(r.text.includes('tel:+97676001888') && r.text.includes('tel:+97691005498'), p);
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
  const r = await request('GET', `/booking.html?test=${TOKEN}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/booking.html');
  const withBranch = await request('GET', `/booking.html?branch=yaarmag&test=${TOKEN}`);
  assert.equal(withBranch.headers.location, '/booking.html?branch=yaarmag', 'only the token is dropped');
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

const PAY = {
  name: 'Тест', phone: '99112233', staffName: 'Ананд', customerGender: 'male', depositTermsAccepted: true,
  bookingDate: '2035-06-04', description: 'Matrix Eco: Ананд - 2035-06-04 14:00 - Тест - 99112233',
};

test('a real customer is always charged the stylist price, whatever amount the page sends', async () => {
  for (const amount of [100, '100', 1, 0, 'abc', undefined]) {
    calls.invoices = [];
    await invokeStandalone({ ...PAY, amount });
    assert.equal(calls.invoices[0].amount, 20000, `sent ${amount}`);
    assert.ok(calls.invoices[0].callback_url.includes('.r&h='), 'callback marks a real booking');
  }
  calls.invoices = [];
  const r = await request('POST', '/api/qpay/create-payment', { body: { ...PAY, amount: 100 } });
  assert.equal(r.status, 200);
  assert.equal(calls.invoices[0].amount, 20000);
});

test('only the tester\'s signed cookie gets the 100₮ deposit, on both payment paths', async () => {
  const cookie = await testCookie();
  await invokeStandalone({ ...PAY, amount: 20000 }, cookie);
  assert.equal(calls.invoices[0].amount, 100);
  assert.ok(calls.invoices[0].callback_url.includes('.t&h='), 'callback marks a test booking');
  await request('POST', '/api/qpay/create-payment', { body: { ...PAY, amount: 20000 }, cookie });
  assert.equal(calls.invoices[1].amount, 100);
  // With test mode switched off, the same cookie is worth nothing.
  delete process.env.BOOKING_TEST_TOKEN;
  await invokeStandalone({ ...PAY, amount: 20000 }, cookie);
  assert.equal(calls.invoices[2].amount, 20000);
});

test('a booking from the tester\'s browser is titled «ТЕСТ»; a customer\'s is not', async () => {
  const cookie = await testCookie();
  const body = { stylistId: 'Ананд', startTime: '2035-06-04T15:00:00+08:00', customerPhone: '99112233', customerGender: 'male' };
  await request('POST', '/api/calendar/book', { body: { ...body, invoiceId: 'inv_t' }, cookie });
  // Another customer (another phone), an hour later: same calendar, no «ТЕСТ».
  await request('POST', '/api/calendar/book', { body: { ...body, startTime: '2035-06-04T16:00:00+08:00', customerPhone: '88112233', invoiceId: 'inv_r' } });
  assert.ok(calls.events[0].summary.startsWith('ТЕСТ – '), calls.events[0].summary);
  assert.ok(calls.events[0].description.startsWith('ТЕСТ'), 'description says test too');
  assert.ok(!calls.events[1].summary.includes('ТЕСТ'), calls.events[1].summary);
});

test('/api/site-mode tells only the tester\'s browser it is in test mode', async () => {
  const cookie = await testCookie();
  const t = JSON.parse((await request('GET', '/api/site-mode', { cookie })).text);
  const c = JSON.parse((await request('GET', '/api/site-mode')).text);
  assert.deepEqual(t, { test: true, testDeposit: 100 });
  assert.deepEqual(c, { test: false, testDeposit: null });
});
