'use strict';

/**
 * The website's 5-minute hold (services/bookingHold.js): while a customer
 * looks at the QR, their time is taken everywhere, so the website and
 * Messenger can never both reach a QR for one time. Run against an in-memory
 * Google Calendar that behaves like the real one (tests/helpers/fakeCalendar.js)
 * and a QPay fake that answers like Quick QR v2.
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
process.env.BOOKING_CALLBACK_SECRET = 'callback-secret-for-tests';

const { createFakeCalendar, googleapisWith } = require('./helpers/fakeCalendar');

const fakeCal = createFakeCalendar();
const qpay = { calls: [], telegram: [], failInvoice: false, paid: new Set(), n: 0 };

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'googleapis') return googleapisWith(fakeCal);
  if (request === 'axios') {
    const handle = async (method, url, body, opts) => {
      qpay.calls.push({ method, url, body, auth: opts && opts.headers && opts.headers.Authorization });
      if (url.includes('api.telegram.org')) { qpay.telegram.push(body.text); return { data: { ok: true } }; }
      if (url.endsWith('/auth/token')) return { data: { access_token: 'tok', expires_in: 86400 } };
      if (url.endsWith('/invoice')) {
        if (qpay.failInvoice) throw Object.assign(new Error('QPay down'), { response: { status: 500, data: { error: 'x' } } });
        qpay.n += 1;
        return { data: { invoice_id: `inv_${qpay.n}`, qr_text: 'q', qr_image: 'iVBOR', urls: [] } };
      }
      if (url.endsWith('/payment/check')) {
        const paid = qpay.paid.has(body.invoice_id);
        return { data: paid ? { count: 1, paid_amount: 20000, rows: [{ payment_status: 'PAID' }] } : { count: 0, rows: [] } };
      }
      if (url.includes('/invoice/')) return { data: { invoice_status: 'PAID', invoice_description: 'Сараа - 99112233' } };
      throw new Error('unexpected ' + url);
    };
    return { post: (u, b, o) => handle('POST', u, b, o), get: (u, o) => handle('GET', u, undefined, o) };
  }
  return originalLoad.apply(this, arguments);
};

const { STYLIST_CONFIG } = require('../config/stylists');
const { holdIdFor, HOLD_PREFIX } = require('../services/bookingHold');
const { eventIdForBooking } = require('../services/bookingWriter');
const { callbackUrlFor } = require('../services/lateBooking');
const qpayRouter = require('../routes/qpay');
const calendarRouter = require('../routes/calendar');
const createPaymentHandler = require('../api/qpay/create-payment');
const qpayService = require('../services/qpay');

const CAL = STYLIST_CONFIG.Oyunaa.calendarId;
const DATE = '2035-06-04'; // a Monday
const SPECIAL_CUT = 'Эмэгтэй засалт — Тайралт том хүн /SPECIAL/'; // 75 minutes
const START = new Date(`${DATE}T14:00:00+08:00`);

beforeEach(() => {
  fakeCal.reset();
  qpay.calls = []; qpay.telegram = []; qpay.failInvoice = false; qpay.paid = new Set(); qpay.n = 0;
  qpayService._resetTokenCache();
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/qpay', qpayRouter);
  a.use('/api/calendar', calendarRouter);
  return a;
}
function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app().listen(0, () => {
      const payload = body ? JSON.stringify(body) : '';
      const req = http.request({
        port: server.address().port, method, path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), host: 'www.example.mn', ...headers },
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
function standalone(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { resolve({ status: this.statusCode, body: d }); return this; },
    };
    createPaymentHandler({ method: 'POST', headers: { host: 'www.example.mn' }, body }, res);
  });
}
const PATHS = [['standalone', standalone], ['express', (b) => request('POST', '/api/qpay/create-payment', b)]];

function pay(phone, { time = '14:00', staff = 'Oyunaa', services = SPECIAL_CUT } = {}) {
  return {
    name: 'Сараа', phone, amount: 20000, branch: 'yaarmag',
    description: `Matrix Eco: ${staff} - ${DATE} ${time} - Сараа - ${phone}`,
    staffName: staff, bookingDate: DATE, bookingTime: time, selectedServices: services,
    customerGender: 'female', depositTermsAccepted: true, depositTermsAcceptedAt: new Date().toISOString(),
  };
}
const holds = () => fakeCal.live(CAL).filter((e) => e.id.startsWith(HOLD_PREFIX));
const invoices = () => qpay.calls.filter((c) => c.url.endsWith('/invoice'));
function expire(id) {
  const e = fakeCal.all(CAL).find((x) => x.id === id);
  fakeCal.put(CAL, { ...e, extendedProperties: { private: { taraHold: '1', holdExpiresAt: new Date(Date.now() - 1000).toISOString() } } });
}

for (const [label, send] of PATHS) {
  test(`${label}: the QR comes with a hold over the whole appointment; a second customer gets «taken» and no QR`, async () => {
    const a = await send(pay('99112233'));
    assert.equal(a.status, 200);
    assert.ok(a.body.hold_expires_at, 'the page is told when the hold ends');
    const [h] = holds();
    assert.equal(h.id, holdIdFor(CAL, START, '99112233'));
    assert.equal(h.transparency, 'opaque', 'a hold is busy time');
    assert.equal(h.start.dateTime, START.toISOString());
    assert.equal(new Date(h.end.dateTime) - START, 75 * 60000, 'the whole SPECIAL cut, 75 min');
    const left = new Date(h.extendedProperties.private.holdExpiresAt) - Date.now();
    assert.ok(left > 5 * 60000 && left <= 5 * 60000 + 31000, `expires with the QR (+30 s): ${left}`);

    qpay.calls = [];
    const b = await send(pay('88112233', { time: '15:00' })); // overlaps 14:00–15:15
    assert.equal(b.status, 409);
    assert.equal(b.body.slotTaken, true);
    assert.equal(b.body.error, 'Уучлаарай, энэ цаг өөр хүнд захиалагдсан байна. Өөр цаг сонгоно уу.');
    assert.equal(invoices().length, 0, 'QPay never asked for the taken time');
    assert.equal(holds().length, 1);
  });

  test(`${label}: a renewed QR extends the same hold; QPay failing gives the time back`, async () => {
    await send(pay('99112233'));
    const first = holds()[0];
    const again = await send(pay('99112233'));
    assert.equal(again.status, 200, 'the customer\'s own hold is not «taken»');
    assert.equal(holds().length, 1);
    assert.ok(holds()[0].extendedProperties.private.holdExpiresAt >= first.extendedProperties.private.holdExpiresAt);

    qpay.failInvoice = true;
    const fail = await send(pay('77112233', { time: '17:00' }));
    assert.ok(fail.status >= 500);
    assert.ok(!holds().some((h) => h.id === holdIdFor(CAL, new Date(`${DATE}T17:00:00+08:00`), '77112233')), 'released');
  });

  test(`${label}: a Messenger hold or a booking on the time means no QR; an unreadable calendar means no QR`, async () => {
    fakeCal.put(CAL, {
      id: 'dh' + '0123456789abcdef'.repeat(2), summary: 'chat hold', extendedProperties: { private: { dalaBookingState: 'hold' } }, transparency: 'opaque',
      start: { dateTime: `${DATE}T06:30:00Z` }, end: { dateTime: `${DATE}T07:30:00Z` },
    });
    const r = await send(pay('99112233'));
    assert.equal(r.status, 409);
    assert.equal(invoices().length, 0);
    fakeCal.reset();
    const realList = fakeCal.api.events.list;
    fakeCal.api.events.list = async () => { throw Object.assign(new Error('backend'), { code: 503 }); };
    try {
      const down = await send(pay('99112233'));
      assert.equal(down.status, 503);
      assert.equal(invoices().length, 0, 'never a QR for a time nobody could check');
    } finally {
      fakeCal.api.events.list = realList;
    }
  });
}

test('race: another hold inserted earlier while ours went in — ours yields; one inserted later — it is the one that must yield', async () => {
  // Another website customer slips in between our check and our insert.
  fakeCal.hooks.beforeInsert = async ({ requestBody }) => {
    if (requestBody.id === holdIdFor(CAL, START, '99112233')) {
      fakeCal.hooks.beforeInsert = null;
      await fakeCal.api.events.insert({ calendarId: CAL, requestBody: {
        id: holdIdFor(CAL, START, '88112233'), transparency: 'opaque',
        extendedProperties: { private: { taraHold: '1', holdExpiresAt: new Date(Date.now() + 300000).toISOString(), holdPlacedAt: new Date(Date.now() - 1000).toISOString() } },
        start: { dateTime: START.toISOString() }, end: { dateTime: new Date(START.getTime() + 3600000).toISOString() },
      } });
    }
  };
  const lost = await standalone(pay('99112233'));
  assert.equal(lost.status, 409);
  assert.deepEqual(holds().map((h) => h.id), [holdIdFor(CAL, START, '88112233')], 'only the earlier hold remains');

  fakeCal.reset();
  // A chat hold lands just AFTER ours: we keep the time (the chat sees ours and yields).
  fakeCal.hooks.afterInsert = async ({ event }) => {
    if (event.id.startsWith(HOLD_PREFIX)) {
      fakeCal.hooks.afterInsert = null;
      await fakeCal.api.events.insert({ calendarId: CAL, requestBody: {
        id: 'dh' + 'b'.repeat(32), transparency: 'opaque', extendedProperties: { private: { dalaBookingState: 'hold' } },
        start: { dateTime: START.toISOString() }, end: { dateTime: new Date(START.getTime() + 3600000).toISOString() },
      } });
    }
  };
  const won = await standalone(pay('99112233'));
  assert.equal(won.status, 200);
});

test('expiry: an unpaid hold stops blocking when its QR runs out, and is deleted when the day is read', async () => {
  await standalone(pay('99112233'));
  const id = holds()[0].id;
  let slots = await request('GET', `/api/calendar/available-slots?date=${DATE}&stylistId=Oyunaa&services=${encodeURIComponent(SPECIAL_CUT)}`);
  assert.ok(!slots.body.availableSlots.includes('14:00'), 'held: not offered');
  assert.ok(!slots.body.availableSlots.includes('13:00'), '13:00–14:15 would overlap the hold');
  expire(id);
  slots = await request('GET', `/api/calendar/available-slots?date=${DATE}&stylistId=Oyunaa&services=${encodeURIComponent(SPECIAL_CUT)}`);
  assert.ok(slots.body.availableSlots.includes('14:00'), 'offered again after the QR ran out');
  assert.equal(holds().length, 0, 'the expired hold was deleted');
  const second = await standalone(pay('88112233'));
  assert.equal(second.status, 200, 'another customer can now take it');
});

test('paid: the booking replaces the hold, with no false «slot taken»', async () => {
  await standalone(pay('99112233'));
  const r = await request('POST', '/api/calendar/book', {
    stylistId: 'Oyunaa', branch: 'yaarmag', startTime: START.toISOString(), customerName: 'Сараа', customerPhone: '99112233',
    selectedServices: SPECIAL_CUT, customerGender: 'female', depositTermsAccepted: true, invoiceId: 'inv_1',
  });
  assert.equal(r.status, 200);
  assert.equal(holds().length, 0, 'hold released');
  const live = fakeCal.live(CAL);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, eventIdForBooking(CAL, START, '99112233'));
  assert.equal(qpay.telegram.length, 0, 'no alert');
});

test('paid late, after the hold expired and the time was taken: alert, never a double booking', async () => {
  await standalone(pay('99112233'));
  expire(holds()[0].id);
  const other = await standalone(pay('88112233'));
  assert.equal(other.status, 200, 'the second customer gets the time once the first QR ran out');
  const url = callbackUrlFor('https://www.example.mn', {
    stylistId: 'Oyunaa', date: DATE, time: '14:00', customerGender: 'female', customerPhone: '99112233',
    services: [SPECIAL_CUT], agreedAt: new Date(), amount: 20000,
  });
  qpay.paid.add('inv_1');
  const late = await request('POST', url.slice('https://www.example.mn'.length), { object_id: 'inv_1' });
  assert.equal(late.body.handled, 'conflict');
  assert.equal(qpay.telegram.length, 1);
  assert.equal(fakeCal.live(CAL).filter((e) => e.transparency !== 'transparent' && !e.id.startsWith(HOLD_PREFIX)).length, 0, 'no booking over the other customer\'s hold');
});

test('sweep: deletes only expired website holds; protected by CRON_SECRET when set', async () => {
  await standalone(pay('99112233'));
  await standalone(pay('88112233', { time: '17:00' }));
  fakeCal.put(CAL, { id: 'dh' + 'c'.repeat(40), transparency: 'opaque', start: { dateTime: `${DATE}T02:00:00Z` }, end: { dateTime: `${DATE}T03:00:00Z` } });
  expire(holds()[0].id);
  process.env.CRON_SECRET = 'cron-secret';
  try {
    assert.equal((await request('GET', '/api/calendar/sweep-holds')).status, 401);
    const r = await request('GET', '/api/calendar/sweep-holds', null, { authorization: 'Bearer cron-secret' });
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, 1);
  } finally {
    delete process.env.CRON_SECRET;
  }
  assert.equal(holds().length, 1, 'the live hold stays');
  assert.ok(fakeCal.live(CAL).some((e) => e.id === 'dh' + 'c'.repeat(40)), 'a chat hold is never touched');
});

test('Яармаг\'s invoice is exactly what it always was (plus nothing)', async () => {
  const r = await standalone(pay('99112233'));
  assert.equal(r.status, 200);
  const inv = invoices()[0].body;
  const { callback_url: cb, ...rest } = inv;
  assert.deepEqual(rest, {
    merchant_id: '17e69f2a-d1a4-4fe6-a5a2-34a649378414',
    amount: 20000,
    currency: 'MNT',
    description: 'Сараа - 99112233',
    mcc_code: '7230',
    bank_accounts: [{ account_bank_code: '040000', account_number: '416055415', account_name: 'Эрхэмбаатар Оюунсүрэн', is_default: true }],
  });
  assert.ok(cb.startsWith('https://www.example.mn/api/qpay/late-payment?b=v1.oyunaa.'));
  const token = qpay.calls.find((c) => c.url.endsWith('/auth/token'));
  assert.deepEqual(token.body, { terminal_id: 'DALATECH_AI' });
});

test('a customer\'s earlier hold is never dropped by a newer one (its QR may still be paid)', async () => {
  await standalone(pay('99112233'));
  const r = await standalone(pay('99112233', { time: '17:00' }));
  assert.equal(r.status, 200);
  assert.equal(holds().length, 2);
});

test('a paid chat booking (dh…, state booking) is never treated as a hold that yields', async () => {
  fakeCal.put(CAL, {
    id: 'dh' + 'a'.repeat(32), transparency: 'opaque', extendedProperties: { private: { dalaBookingState: 'booking' } },
    start: { dateTime: START.toISOString() }, end: { dateTime: new Date(START.getTime() + 3600000).toISOString() },
  });
  const r = await standalone(pay('99112233'));
  assert.equal(r.status, 409);
});

test('hold ids are valid Google event ids (a–v, 0–9 only)', () => {
  const id = holdIdFor(CAL, START, '99112233');
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.ok(id.startsWith('sh'));
});

test('a burst of holds from one address is refused', async () => {
  const { _resetRateLimit } = require('../services/bookingHold');
  _resetRateLimit();
  const results = [];
  for (let i = 0; i < 24; i += 1) {
    // Different days so every hold succeeds; only placed holds count.
    const day = String(1 + i).padStart(2, '0');
    const body = pay(`9911${String(1000 + i)}`);
    body.description = body.description.replace(DATE, `2035-07-${day}`);
    body.bookingDate = `2035-07-${day}`;
    results.push((await request('POST', '/api/qpay/create-payment', body)).status);
  }
  assert.equal(results.filter((x) => x === 200).length, 20, results.join(','));
  assert.ok(results.slice(20).every((x) => x === 429), results.join(','));
  _resetRateLimit();
});

test('sweep: refused without CRON_SECRET', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await request('GET', '/api/calendar/sweep-holds')).status, 401);
});
