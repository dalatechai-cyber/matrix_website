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

// A Парк Од hairdresser's calendar, connected through her PARKOD_CALENDAR_* variable.
const PARKOD_CAL = 'parkod-calendar@group.calendar.google.com';

const PARKOD_ENV = {
  PARKOD_BOOKING: 'on',
  PARKOD_QPAY_BANK_CODE: '050000',
  PARKOD_QPAY_ACCOUNT_NUMBER: '5000123456',
  PARKOD_QPAY_ACCOUNT_NAME: 'Парк Од эзэмшигч',
  PARKOD_TELEGRAM_CHAT_ID: '-100parkod',
  PARKOD_CALENDAR_SARAA: PARKOD_CAL,
};
function connectParkOd() {
  Object.assign(process.env, PARKOD_ENV);
  branchData.branches.parkod.workHours = { weekday: [10, 20], sunday: [11, 19] };
}
function disconnectParkOd() {
  for (const k of Object.keys(PARKOD_ENV)) delete process.env[k];
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
    assert.ok(['yaarmag', 'parkod'].includes(cfg.branch), `${id} has no branch`);
  }
  assert.deepEqual(stylistsOf('yaarmag'), ['Oyunaa', 'Badamaa', 'Anand', 'Uyanga', 'Zaya', 'Chimgee', 'Otgonjargal']);
  assert.deepEqual(stylistsOf('parkod'), [], 'no Парк Од calendar is connected yet');
});

test('branches: Парк Од never falls back to Яармаг\'s QPay account', () => {
  const account = qpayAccountFor('parkod');
  assert.equal(account.complete, false);
  assert.equal(account.merchantId, null, 'the handlers keep the one merchant they always used');
  assert.equal(account.bankAccounts, null, 'no bank account until hers is set');
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
  assert.deepEqual(publicBranches()[1].stylists.map((s) => s.id), ['Saraa']);
  assert.ok(!publicBranches()[0].stylists.some((s) => s.id === 'Saraa'));
});

test('not connected: Парк Од gets no times and no invoice on either payment path', async () => {
  const slots = await request('GET', `/api/calendar/available-slots?date=2035-06-04&stylistId=${'Saraa'}`);
  assert.equal(slots.status, 409);
  const express409 = await request('POST', '/api/qpay/create-payment', paymentBody('Saraa', { branch: 'parkod' }));
  assert.equal(express409.status, 409);
  const standalone = await invokeStandalone(paymentBody('Saraa', { branch: 'parkod' }));
  assert.equal(standalone.status, 409);
  assert.equal(net.calls.length, 0, 'QPay never called');
  assert.equal(cal.freebusy.length, 0, 'no calendar read');
});

test('mismatch: a page naming the other branch gets no invoice', async () => {
  connectParkOd();
  for (const [staff, branch] of [['Оюунсүрэн', 'parkod'], ['Oyunaa', 'parkod'], ['Saraa', 'yaarmag']]) {
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

test('Парк Од connected: the same login and merchant as Яармаг, only her bank account differs', async () => {
  connectParkOd();
  const standalone = await invokeStandalone(paymentBody('Saraa', { branch: 'parkod' }));
  assert.equal(standalone.status, 200);
  let inv = invoiceCall();
  assert.equal(inv.body.merchant_id, '17e69f2a-d1a4-4fe6-a5a2-34a649378414', 'Яармаг\'s merchant, as for Яармаг');
  assert.deepEqual(inv.body.bank_accounts, [{ account_bank_code: '050000', account_number: '5000123456', account_name: 'Парк Од эзэмшигч', is_default: true }]);
  assert.deepEqual(tokenCalls()[0].body, { terminal_id: 'DALATECH_AI' });
  assert.equal(tokenCalls()[0].auth, basic('yaarmag_user', 'yaarmag_pass'));

  net.calls = [];
  const viaExpress = await request('POST', '/api/qpay/create-payment', paymentBody('Saraa', { branch: 'parkod' }));
  assert.equal(viaExpress.status, 200);
  inv = invoiceCall();
  assert.equal(inv.body.merchant_id, 'YAARMAG_ENV_MERCHANT', 'the Express path\'s merchant, as for Яармаг');
  assert.equal(inv.body.bank_accounts[0].account_number, '5000123456');

  net.calls = [];
  const check = await request('POST', '/api/qpay/check-payment', { invoice_id: 'inv_1', branch: 'parkod' });
  assert.equal(check.body.invoice_status, 'PAID');
  const checkCall = net.calls.find((c) => c.url.endsWith('/payment/check'));
  assert.equal(checkCall.auth, `Bearer tok:${basic('yaarmag_user', 'yaarmag_pass')}`, 'checked on the one shared login');

  const slots = await request('GET', `/api/calendar/available-slots?date=2035-06-04&stylistId=${'Saraa'}&branch=parkod`);
  assert.equal(slots.status, 200);
  assert.deepEqual(cal.freebusy, [PARKOD_CAL]);
});

test('Парк Од: a late QPay callback is checked on the shared login and booked on her calendar', async () => {
  connectParkOd();
  const url = callbackUrlFor('https://www.example.mn', {
    stylistId: 'Saraa', date: '2035-06-04', time: '14:00', customerGender: 'female',
    customerPhone: '99112233', services: ['Угаалт'], agreedAt: new Date(), amount: 20000,
  });
  assert.ok(url, 'a callback URL can be signed for a Парк Од hairdresser');
  const path = url.slice('https://www.example.mn'.length);
  const r = await request('POST', path, { object_id: 'inv_1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.handled, 'booked');
  assert.ok(net.calls.filter((c) => c.url.includes('qpay')).every((c) => c.auth.includes(basic('yaarmag_user', 'yaarmag_pass'))),
    'every QPay call made on the one shared login');
  assert.equal(cal.inserts.length, 1);
  assert.equal(cal.inserts[0].calendarId, PARKOD_CAL);
  assert.ok(cal.inserts[0].requestBody.description.includes('Branch: Парк Од салбар'));
});

test('alerts: each branch\'s go only to its own chat, never the other owner\'s', async () => {
  const { sendSalonAlert } = require('../services/telegram');
  await sendSalonAlert('a', { branch: 'yaarmag' });
  await sendSalonAlert('b', { branch: 'parkod' }); // no Парк Од chat: logged, not sent to Яармаг
  process.env.PARKOD_TELEGRAM_CHAT_ID = '-100parkod';
  await sendSalonAlert('c', { branch: 'parkod' });
  assert.deepEqual(net.telegram.map((t) => t.chat_id), ['-100yaarmag', '-100parkod']);
});

test('readiness: Парк Од needs its own alert chat before it takes bookings', () => {
  connectParkOd();
  assert.equal(branchReadiness('parkod').ready, true);
  delete process.env.PARKOD_TELEGRAM_CHAT_ID;
  assert.deepEqual(branchReadiness('parkod'), { ready: false, reason: 'no-alert-chat' });
});

test('/book: no browser booking for a branch not taking online bookings', async () => {
  const r = await request('POST', '/api/calendar/book', {
    stylistId: 'Saraa', startTime: '2035-06-04T14:00:00+08:00', customerPhone: '99112233', customerGender: 'female', invoiceId: 'x',
  });
  assert.equal(r.status, 409);
  assert.equal(cal.inserts.length, 0);
});

test('Яармаг hours: available times keep today\'s opening hours', async () => {
  const r = await request('GET', '/api/calendar/available-slots?date=2035-06-03&stylistId=anand&branch=yaarmag'); // a Sunday
  assert.equal(r.status, 200);
  assert.equal(r.body.availableSlots[0], '11:00');
  assert.equal(r.body.availableSlots.at(-1), '18:00');
  const wrong = await request('GET', '/api/calendar/available-slots?date=2035-06-03&stylistId=anand&branch=parkod');
  assert.equal(wrong.status, 400);
});

test('Парк Од\'s invoice is Яармаг\'s invoice with only the bank account changed', async () => {
  const bodies = {};
  for (const [staff, branch] of [['Oyunaa', 'yaarmag'], ['Saraa', 'parkod']]) {
    connectParkOd();
    bodies[branch] = [];
    for (const send of [invokeStandalone, (b) => request('POST', '/api/qpay/create-payment', b)]) {
      net.calls = [];
      qpayService._resetTokenCache();
      const r = await send(paymentBody(staff, { branch, time: '15:00' }));
      assert.equal(r.status, 200, `${staff} @ ${branch}`);
      const { bank_accounts: bank, description, callback_url: _cb, amount: _a, ...rest } = invoiceCall().body;
      bodies[branch].push({ rest, bank, token: tokenCalls()[0] });
    }
  }
  for (let i = 0; i < 2; i += 1) {
    assert.deepEqual(bodies.parkod[i].rest, bodies.yaarmag[i].rest, 'merchant, currency, mcc: identical');
    assert.deepEqual(bodies.parkod[i].token, bodies.yaarmag[i].token, 'same login and terminal');
    assert.equal(bodies.yaarmag[i].bank[0].account_number, '416055415');
    assert.equal(bodies.parkod[i].bank[0].account_number, '5000123456');
  }
});

test('Парк Од: a missing bank account, or Яармаг\'s account, keeps her closed', () => {
  connectParkOd();
  assert.equal(qpayAccountFor('parkod').complete, true);
  for (const k of ['PARKOD_QPAY_BANK_CODE', 'PARKOD_QPAY_ACCOUNT_NUMBER', 'PARKOD_QPAY_ACCOUNT_NAME']) {
    connectParkOd();
    delete process.env[k];
    assert.equal(qpayAccountFor('parkod').complete, false, `without ${k}`);
  }
  connectParkOd();
  process.env.PARKOD_QPAY_ACCOUNT_NUMBER = '416055415';
  assert.equal(qpayAccountFor('parkod').complete, false, 'Яармаг\'s bank account');
  assert.deepEqual(branchReadiness('parkod'), { ready: false, reason: 'no-qpay' });
});

test('stylists: renamed hairdressers keep their calendars; the old names still book the same person', () => {
  const pairs = [['Oyunaa', 'Оюунсүрэн'], ['Oyunaa', 'oyunsuren'], ['Badamaa', 'Бадамцэцэг'], ['Zaya', 'Батзаяа'], ['Chimgee', 'Уранчимэг'], ['Anand', 'Ананд'], ['Uyanga', 'Уянга']];
  for (const [now, before] of pairs) {
    assert.equal(STYLIST_CONFIG[before].calendarId, STYLIST_CONFIG[now].calendarId, before);
    assert.equal(STYLIST_CONFIG[before].price, STYLIST_CONFIG[now].price, before);
    assert.equal(STYLIST_CONFIG[before].person, now);
  }
  assert.equal(STYLIST_CONFIG.Oyunaa.level, 'SPECIAL үсчин');
  assert.equal(STYLIST_CONFIG.Oyunaa.price, 20000);
  assert.equal(STYLIST_CONFIG.Zaya.price, 10000);
  for (const name of ['Boloroo', 'Saraa', 'Tomoo', 'Bulgaa', 'Enhuush', 'Chimegee', 'Tuchku']) {
    assert.equal(STYLIST_CONFIG[name].price, 20000, `${name}: every Парк Од deposit is 20,000₮`);
    assert.equal(STYLIST_CONFIG[name].branch, 'parkod');
  }
  assert.deepEqual(Object.keys(STYLIST_CONFIG).filter((k) => STYLIST_CONFIG[k].gender === 'male' && !STYLIST_CONFIG[k].alias && !STYLIST_CONFIG[k].ascii), ['Anand', 'Tuchku']);
});

test('Otgonjargal is bookable again (1-р зэрэг, 10,000₮); her old ids reach her', async () => {
  assert.ok(stylistsOf('yaarmag').includes('Otgonjargal'));
  for (const old of ['Отгонжаргал', 'otgonzargal']) {
    assert.equal(STYLIST_CONFIG[old].person, 'Otgonjargal');
    assert.equal(STYLIST_CONFIG[old].calendarId, STYLIST_CONFIG.Otgonjargal.calendarId);
  }
  assert.equal(STYLIST_CONFIG.Otgonjargal.price, 10000);
  assert.equal(STYLIST_CONFIG.Otgonjargal.title, 'Hair Stylist');
  const r = await invokeStandalone(paymentBody('Otgonjargal'));
  assert.equal(r.status, 200);
  assert.equal(invoiceCall().body.amount, 10000);
});

test('a retired hairdresser gets no times and no invoice', async () => {
  STYLIST_CONFIG['Retired Test'] = { ...STYLIST_CONFIG.Zaya, person: 'Retired Test', retired: true, calendarId: 'retired@cal' };
  try {
    const slots = await request('GET', `/api/calendar/available-slots?date=2035-06-04&stylistId=${encodeURIComponent('Retired Test')}`);
    assert.equal(slots.status, 409);
    const r = await invokeStandalone(paymentBody('Retired Test'));
    assert.equal(r.status, 409);
    assert.equal(r.body.reason, 'stylist-retired');
    assert.equal(net.calls.length, 0);
  } finally {
    delete STYLIST_CONFIG['Retired Test'];
  }
});

// A Mongolian IBAN for a given 16-digit bank+account part, with real check digits.
function mnIban(rest16) {
  const { normalizeAccountNumber } = require('../config/branches');
  for (let c = 0; c < 100; c += 1) {
    const iban = `MN${String(c).padStart(2, '0')}${rest16}`;
    if (normalizeAccountNumber(iban) === iban) return iban;
  }
  throw new Error('no check digits');
}

test('Парк Од: her IBAN is sent as one MN… string with no spaces; a bad IBAN or Яармаг\'s keeps her closed', async () => {
  const { normalizeAccountNumber } = require('../config/branches');
  const iban = mnIban('0005005135357509');
  assert.equal(normalizeAccountNumber(`${iban.slice(0, 4)} ${iban.slice(4, 8)} ${iban.slice(8)}`), iban, 'spaces dropped');
  assert.equal(normalizeAccountNumber(iban.slice(0, 2) + (iban[2] === '9' ? '0' : String(Number(iban[2]) + 1)) + iban.slice(3)), null, 'a mistyped check digit is refused');
  assert.equal(normalizeAccountNumber('5135 357 509'), '5135357509', 'a plain account number still works');
  connectParkOd();
  process.env.PARKOD_QPAY_ACCOUNT_NUMBER = iban.match(/.{1,4}/g).join(' ');
  process.env.PARKOD_QPAY_ACCOUNT_NAME = 'БОЛОРТУЯА ГОНГОР';
  const r = await invokeStandalone(paymentBody('Saraa', { branch: 'parkod' }));
  assert.equal(r.status, 200);
  assert.deepEqual(invoiceCall().body.bank_accounts, [{ account_bank_code: '050000', account_number: iban, account_name: 'БОЛОРТУЯА ГОНГОР', is_default: true }]);
  process.env.PARKOD_QPAY_ACCOUNT_NUMBER = mnIban('0004000416055415');
  assert.equal(qpayAccountFor('parkod').complete, false, 'Яармаг\'s account written as an IBAN is refused');
  process.env.PARKOD_QPAY_ACCOUNT_NUMBER = 'MN00 not an account';
  assert.equal(qpayAccountFor('parkod').complete, false);
});

test('Яармаг\'s payee name is in capitals, given name first; her account number is unchanged', () => {
  const y = qpayAccountFor('yaarmag').bankAccounts[0];
  assert.deepEqual([y.account_bank_code, y.account_number, y.account_name], ['040000', '416055415', 'ОЮУНСҮРЭН ЭРХЭМБААТАР']);
});

test('no deposit anywhere is below 10,000₮: 20,000₮ SPECIAL and Мастер, 10,000₮ 1-р зэрэг', () => {
  // Guards against a temporary 100₮ test price being merged by accident. The
  // test link's 100₮ (config/siteMode.js) is not a price: it needs a signed
  // cookie and marks the booking «ТЕСТ».
  const { LEVELS, STYLIST_CONFIG } = require('../config/stylists');
  const { publicBranches } = require('../lib/publicBranches');
  const expected = { special: 20000, master: 20000, first: 10000 };
  assert.deepEqual(Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.deposit])), expected);
  for (const [key, cfg] of Object.entries(STYLIST_CONFIG)) {
    assert.ok(cfg.price >= 10000, `${key}: deposit ${cfg.price}₮ is below 10,000₮`);
    assert.equal(cfg.price, expected[cfg.levelKey], `${key}: deposit must be its level's`);
  }
  const shown = Object.values(publicBranches()).flatMap((b) => b.stylists || []);
  assert.ok(shown.length > 0);
  for (const s of shown) assert.ok(s.deposit >= 10000, `${s.id}: page deposit ${s.deposit}₮ is below 10,000₮`);
});

test('switch: Парк Од fully connected but PARKOD_BOOKING not «on» — no times, no invoice; Яармаг unaffected', async () => {
  const { branchReadiness, onlineBookingOpen } = require('../config/branches');
  connectParkOd();
  for (const off of [undefined, '', 'off', 'no']) {
    if (off === undefined) delete process.env.PARKOD_BOOKING; else process.env.PARKOD_BOOKING = off;
    assert.deepEqual(branchReadiness('parkod'), { ready: false, reason: 'booking-off' }, String(off));
    assert.equal(onlineBookingOpen('yaarmag'), true);
  }
  assert.equal(branchReadiness('yaarmag').ready, true);
  const slots = await request('GET', '/api/calendar/available-slots?date=2035-06-04&stylistId=Saraa');
  assert.equal(slots.status, 409);
  assert.equal((await request('POST', '/api/qpay/create-payment', paymentBody('Saraa', { branch: 'parkod' }))).status, 409);
  assert.equal((await invokeStandalone(paymentBody('Saraa', { branch: 'parkod' }))).status, 409);
  assert.equal(net.calls.length, 0, 'QPay never called');
  const park = require('../lib/publicBranches').publicBranches().find((b) => b.id === 'parkod');
  assert.equal(park.ready, false);
  assert.deepEqual(park.phones, ['76001888'], 'the booking page shows her phone instead');
  process.env.PARKOD_BOOKING = 'on';
  assert.equal(branchReadiness('parkod').ready, true, 'on again without a code change');
});
