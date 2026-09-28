'use strict';

/**
 * Tara Salon has two branches with separate owners. A booking at one branch
 * must only ever reach that branch's stylists' calendars and that branch's
 * QPay account — never the other's — and a branch that is not connected yet
 * must take no booking at all.
 */

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const http = require('node:http');
const express = require('express');

process.env.QPAY_USERNAME = 'yaarmag_user';
process.env.QPAY_PASSWORD = 'yaarmag_pass';
process.env.QPAY_MERCHANT_ID = 'YAARMAG_ENV_MERCHANT';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';
process.env.SALON_CLOSURE_START = 'none';
process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
process.env.TELEGRAM_CHAT_ID = '-100yaarmag';

const net = { calls: [], telegram: [] };
const cal = { freebusy: [], inserts: [] };

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'googleapis') {
    return {
      google: {
        auth: { JWT: class { async authorize() { return {}; } }, GoogleAuth: class { async getClient() { return {}; } } },
        calendar: () => ({
          freebusy: {
            query: async ({ requestBody }) => {
              cal.freebusy.push(requestBody.items[0].id);
              return { data: { calendars: { [requestBody.items[0].id]: { busy: [] } } } };
            },
          },
          events: {
            get: async () => { const e = new Error('Not Found'); e.code = 404; throw e; },
            insert: async ({ calendarId, requestBody }) => {
              cal.inserts.push({ calendarId, requestBody });
              return { data: { ...requestBody, id: requestBody.id || 'auto' } };
            },
            list: async () => ({ data: { items: [] } }),
          },
        }),
      },
    };
  }
  if (request === 'axios') {
    const handle = async (method, url, body, opts) => {
      net.calls.push({ method, url, body, auth: opts && opts.headers && opts.headers.Authorization });
      if (url.includes('api.telegram.org')) { net.telegram.push(body); return { data: { ok: true } }; }
      if (url.endsWith('/auth/token')) return { data: { access_token: `tok:${opts.headers.Authorization}` } };
      if (url.endsWith('/payment/check')) return { data: { count: 1, rows: [{ payment_status: 'PAID' }] } };
      if (url.includes('/invoice/')) return { data: { invoice_status: 'PAID', invoice_description: 'Сараа - 99112233' } };
      if (url.endsWith('/invoice')) return { data: { invoice_id: 'inv_1', qr_image: 'x', urls: [] } };
      throw new Error('unexpected ' + url);
    };
    return { post: (url, body, opts) => handle('POST', url, body, opts), get: (url, opts) => handle('GET', url, undefined, opts) };
  }
  return originalLoad.apply(this, arguments);
};

const branchData = require('../data/branches.json');
const { STYLIST_CONFIG } = require('../config/stylists');
const { branchReadiness, resolveBookingBranch, stylistsOf, qpayAccountFor } = require('../config/branches');
const qpayRouter = require('../routes/qpay');
const calendarRouter = require('../routes/calendar');
const createPaymentHandler = require('../api/qpay/create-payment');
const { callbackUrlFor } = require('../services/lateBooking');
const { publicBranches } = require('../lib/publicBranches');
const qpayService = require('../services/qpay');

// A Парк Од hairdresser, as one will be added to config/stylists.js.
const PARKOD_CAL = 'parkod-calendar@group.calendar.google.com';
STYLIST_CONFIG['Парк Тест'] = { calendarId: PARKOD_CAL, price: 20000, level: 'Мастер үсчин', gender: 'female', branch: 'parkod' };
STYLIST_CONFIG.parktest = { calendarId: PARKOD_CAL, price: 20000, level: 'Мастер үсчин', gender: 'female', branch: 'parkod' };

const PARKOD_ENV = {
  PARKOD_QPAY_USERNAME: 'parkod_user',
  PARKOD_QPAY_PASSWORD: 'parkod_pass',
  PARKOD_QPAY_TERMINAL_ID: 'PARKOD_TERMINAL',
  PARKOD_QPAY_MERCHANT_ID: 'PARKOD_MERCHANT',
  PARKOD_QPAY_BANK_CODE: '050000',
  PARKOD_QPAY_ACCOUNT_NUMBER: '5000123456',
  PARKOD_QPAY_ACCOUNT_NAME: 'Парк Од эзэмшигч',
};
function connectParkOd() {
  Object.assign(process.env, PARKOD_ENV);
  branchData.branches.parkod.workHours = { weekday: [10, 20], sunday: [11, 19] };
}
function disconnectParkOd() {
  for (const k of Object.keys(PARKOD_ENV)) delete process.env[k];
  delete process.env.PARKOD_TELEGRAM_CHAT_ID;
  branchData.branches.parkod.workHours = null;
}

beforeEach(() => {
  disconnectParkOd();
  net.calls = []; net.telegram = [];
  cal.freebusy = []; cal.inserts = [];
  qpayService._resetTokenCache();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/qpay', qpayRouter);
  app.use('/api/calendar', calendarRouter);
  return app;
}
function request(method, path, body) {
  const app = buildApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const payload = body ? JSON.stringify(body) : '';
      const req = http.request({
        port: server.address().port, method, path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), host: 'www.example.mn' },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.end(payload);
    });
  });
}
function invokeStandalone(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); return this; },
    };
    createPaymentHandler({ method: 'POST', headers: { host: 'www.example.mn' }, body }, res);
  });
}
const paymentBody = (staffName, extra = {}) => ({
  name: 'Сараа', phone: '99112233', amount: 20000,
  description: `Matrix Eco: ${staffName} - 2035-06-04 14:00 - Сараа - 99112233`,
  staffName, bookingDate: '2035-06-04', selectedServices: 'Угаалт',
  customerGender: 'female', depositTermsAccepted: true, depositTermsAcceptedAt: new Date().toISOString(),
  ...extra,
});
const invoiceCall = () => net.calls.find((c) => c.url.endsWith('/invoice'));
const tokenCalls = () => net.calls.filter((c) => c.url.endsWith('/auth/token'));
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

// ---------------------------------------------------------------------------

test('branches: Яармаг is bookable with every current hairdresser; Парк Од is not connected yet', () => {
  assert.deepEqual(branchReadiness('yaarmag'), { ready: true, reason: 'ok' });
  assert.equal(branchReadiness('parkod').ready, false);
  for (const [id, cfg] of Object.entries(STYLIST_CONFIG)) {
    if (id === 'Парк Тест' || id === 'parktest') continue;
    assert.equal(cfg.branch, 'yaarmag', `${id} has no branch`);
  }
  assert.equal(stylistsOf('yaarmag').length, 7);
});

test('branches: Парк Од never falls back to Яармаг\'s QPay account', () => {
  const account = qpayAccountFor('parkod');
  assert.equal(account.complete, false);
  assert.equal(account.username, null);
  assert.equal(account.merchantId, null);
  assert.equal(account.bankAccounts, null);
  connectParkOd();
  const connected = qpayAccountFor('parkod');
  assert.equal(connected.complete, true);
  assert.notEqual(connected.bankAccounts[0].account_number, '416055415');
});

test('branches: /api/branches lists each branch\'s hairdressers only, and no calendar ids', () => {
  const list = publicBranches();
  assert.deepEqual(list.map((b) => b.id), ['yaarmag', 'parkod']);
  const [yaarmag, parkod] = list;
  assert.equal(parkod.ready, false);
  assert.deepEqual(parkod.stylists, [], 'no hairdressers offered at a branch not yet connected');
  assert.equal(yaarmag.stylists.length, 7);
  for (const s of yaarmag.stylists) {
    assert.equal(STYLIST_CONFIG[s.id].gender, s.gender, `${s.id} gender differs from the server`);
    assert.equal(STYLIST_CONFIG[s.id].price, s.deposit, `${s.id} deposit differs from the server`);
  }
  assert.ok(!JSON.stringify(list).includes('@group.calendar.google.com'), 'calendar ids stay on the server');
  connectParkOd();
  assert.deepEqual(publicBranches()[1].stylists.map((s) => s.id), ['Парк Тест']);
  assert.ok(!publicBranches()[0].stylists.some((s) => s.id === 'Парк Тест'));
});

test('not connected: Парк Од gets no times and no invoice on either payment path', async () => {
  const slots = await request('GET', `/api/calendar/available-slots?date=2035-06-04&stylistId=${encodeURIComponent('Парк Тест')}`);
  assert.equal(slots.status, 409);
  const express409 = await request('POST', '/api/qpay/create-payment', paymentBody('Парк Тест', { branch: 'parkod' }));
  assert.equal(express409.status, 409);
  const standalone = await invokeStandalone(paymentBody('Парк Тест', { branch: 'parkod' }));
  assert.equal(standalone.status, 409);
  assert.equal(net.calls.length, 0, 'QPay never called');
  assert.equal(cal.freebusy.length, 0, 'no calendar read');
});

test('mismatch: a page naming the other branch gets no invoice', async () => {
  connectParkOd();
  for (const [staff, branch] of [['Оюунсүрэн', 'parkod'], ['Парк Тест', 'yaarmag']]) {
    const r1 = await request('POST', '/api/qpay/create-payment', paymentBody(staff, { branch }));
    assert.equal(r1.status, 409, `${staff} @ ${branch}`);
    assert.equal(r1.body.reason, 'branch-mismatch');
    const r2 = await invokeStandalone(paymentBody(staff, { branch }));
    assert.equal(r2.status, 409);
  }
  assert.equal(net.calls.length, 0);
  assert.deepEqual(resolveBookingBranch({ stylistId: 'Оюунсүрэн', branch: 'parkod' }).reason, 'branch-mismatch');
});

test('Яармаг: both payment paths use exactly the account they always did', async () => {
  const standalone = await invokeStandalone(paymentBody('Оюунсүрэн', { branch: 'yaarmag' }));
  assert.equal(standalone.status, 200);
  let inv = invoiceCall();
  assert.equal(inv.body.merchant_id, '17e69f2a-d1a4-4fe6-a5a2-34a649378414');
  assert.equal(inv.body.bank_accounts[0].account_number, '416055415');
  assert.deepEqual(tokenCalls()[0].body, { terminal_id: 'DALATECH_AI' });
  assert.equal(tokenCalls()[0].auth, basic('yaarmag_user', 'yaarmag_pass'));

  net.calls = [];
  const viaExpress = await request('POST', '/api/qpay/create-payment', paymentBody('Оюунсүрэн'));
  assert.equal(viaExpress.status, 200, 'a page from before branches (no branch field) still pays Яармаг');
  inv = invoiceCall();
  assert.equal(inv.body.merchant_id, 'YAARMAG_ENV_MERCHANT');
  assert.equal(inv.body.bank_accounts[0].account_number, '416055415');
});

test('Парк Од connected: invoices, payment checks and times use only its own account and calendar', async () => {
  connectParkOd();
  const standalone = await invokeStandalone(paymentBody('Парк Тест', { branch: 'parkod' }));
  assert.equal(standalone.status, 200);
  let inv = invoiceCall();
  assert.equal(inv.body.merchant_id, 'PARKOD_MERCHANT');
  assert.equal(inv.body.bank_accounts[0].account_number, '5000123456');
  assert.deepEqual(tokenCalls()[0].body, { terminal_id: 'PARKOD_TERMINAL' });
  assert.equal(tokenCalls()[0].auth, basic('parkod_user', 'parkod_pass'));

  net.calls = [];
  const viaExpress = await request('POST', '/api/qpay/create-payment', paymentBody('Парк Тест', { branch: 'parkod' }));
  assert.equal(viaExpress.status, 200);
  inv = invoiceCall();
  assert.equal(inv.body.merchant_id, 'PARKOD_MERCHANT');
  assert.ok(net.calls.every((c) => !c.auth || !c.auth.includes(Buffer.from('yaarmag_user:yaarmag_pass').toString('base64'))),
    'Яармаг credentials never used for Парк Од');

  net.calls = [];
  const check = await request('POST', '/api/qpay/check-payment', { invoice_id: 'inv_1', branch: 'parkod' });
  assert.equal(check.body.invoice_status, 'PAID');
  const checkCall = net.calls.find((c) => c.url.endsWith('/payment/check'));
  assert.equal(checkCall.auth, `Bearer tok:${basic('parkod_user', 'parkod_pass')}`, 'checked with Парк Од\'s token');

  const slots = await request('GET', `/api/calendar/available-slots?date=2035-06-04&stylistId=${encodeURIComponent('Парк Тест')}&branch=parkod`);
  assert.equal(slots.status, 200);
  assert.deepEqual(cal.freebusy, [PARKOD_CAL]);
});

test('Парк Од: a late QPay callback is checked on Парк Од\'s account and booked on its calendar', async () => {
  connectParkOd();
  process.env.PARKOD_TELEGRAM_CHAT_ID = '-100parkod';
  const url = callbackUrlFor('https://www.example.mn', {
    stylistId: 'Парк Тест', date: '2035-06-04', time: '14:00', customerGender: 'female',
    customerPhone: '99112233', services: ['Угаалт'], agreedAt: new Date(), amount: 20000,
  });
  assert.ok(url, 'a callback URL can be signed for a Парк Од hairdresser');
  const path = url.slice('https://www.example.mn'.length);
  const r = await request('POST', path, { object_id: 'inv_1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.handled, 'booked');
  assert.ok(net.calls.filter((c) => c.url.includes('qpay')).every((c) => c.auth.includes(basic('parkod_user', 'parkod_pass'))),
    'every QPay call made with Парк Од credentials');
  assert.equal(cal.inserts.length, 1);
  assert.equal(cal.inserts[0].calendarId, PARKOD_CAL);
  assert.ok(cal.inserts[0].requestBody.description.includes('Branch: Парк Од салбар'));
});

test('alerts: Парк Од\'s go to its own chat when set; Яармаг\'s to the salon chat', async () => {
  const { sendSalonAlert } = require('../services/telegram');
  await sendSalonAlert('a', { branch: 'yaarmag' });
  await sendSalonAlert('b', { branch: 'parkod' });
  process.env.PARKOD_TELEGRAM_CHAT_ID = '-100parkod';
  await sendSalonAlert('c', { branch: 'parkod' });
  assert.deepEqual(net.telegram.map((t) => t.chat_id), ['-100yaarmag', '-100yaarmag', '-100parkod']);
});

test('Яармаг hours: available times keep today\'s opening hours', async () => {
  const r = await request('GET', '/api/calendar/available-slots?date=2035-06-03&stylistId=anand&branch=yaarmag'); // a Sunday
  assert.equal(r.status, 200);
  assert.equal(r.body.availableSlots[0], '11:00');
  assert.equal(r.body.availableSlots.at(-1), '18:00');
  const wrong = await request('GET', '/api/calendar/available-slots?date=2035-06-03&stylistId=anand&branch=parkod');
  assert.equal(wrong.status, 400);
});
