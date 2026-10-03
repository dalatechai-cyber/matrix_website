'use strict';

/**
 * A paid invoice always ends in exactly one of: the appointment on the
 * calendar, or the salon alerted on Telegram — however late the payment, and
 * whichever of the browser (/api/calendar/book) and QPay's callback
 * (/api/qpay/late-payment) gets there first.
 */

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const http = require('node:http');
const express = require('express');

process.env.QPAY_USERNAME = 'test_user';
process.env.QPAY_PASSWORD = 'test_pass';
process.env.QPAY_MERCHANT_ID = 'TEST_MERCHANT_ID';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';
process.env.SALON_CLOSURE_START = 'none';
process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
process.env.TELEGRAM_CHAT_ID = '-100123';

// --- Google Calendar stub: an in-memory calendar per calendarId -------------
const cal = { events: {}, busy: [], inserts: [], insertError: null, freebusyCalls: 0, patches: [] };
// --- axios stub: QPay + Telegram -------------------------------------------
const net = { paid: true, invoiceDesc: 'Сараа - 99112233', telegram: [], checkError: null, calls: [], paymentObject: null };

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
              cal.freebusyCalls += 1;
              return { data: { calendars: { [requestBody.items[0].id]: { busy: cal.busy } } } };
            },
          },
          events: {
            list: async ({ calendarId, timeMin, timeMax, q }) => ({
              data: {
                items: Object.values(cal.events).filter((e) => e.calendarId === calendarId
                  && new Date(e.start.dateTime) >= new Date(timeMin) && new Date(e.start.dateTime) <= new Date(timeMax)
                  && (!q || `${e.summary} ${e.description}`.includes(q))),
              },
            }),
            patch: async ({ eventId, requestBody }) => {
              cal.patches.push({ eventId, requestBody });
              Object.assign(cal.events[eventId], requestBody);
              return { data: cal.events[eventId] };
            },
            get: async ({ eventId }) => {
              if (cal.events[eventId]) return { data: cal.events[eventId] };
              const e = new Error('Not Found'); e.code = 404; throw e;
            },
            insert: async ({ calendarId, requestBody }) => {
              if (cal.insertError) throw cal.insertError;
              if (requestBody.id && cal.events[requestBody.id]) { const e = new Error('Conflict'); e.code = 409; throw e; }
              const id = requestBody.id || `auto_${cal.inserts.length}`;
              const stored = { ...requestBody, id, status: 'confirmed', calendarId };
              cal.events[id] = stored;
              cal.inserts.push(stored);
              return { data: stored };
            },
          },
        }),
      },
    };
  }
  if (request === 'axios') {
    const handle = async (method, url, body) => {
      net.calls.push({ method, url, body });
      if (url.includes('api.telegram.org')) { net.telegram.push(body.text); return { data: { ok: true } }; }
      if (url.endsWith('/auth/token')) return { data: { access_token: 'tok' } };
      if (url.endsWith('/payment/check')) {
        if (net.checkError) throw net.checkError;
        return { data: net.paid ? { count: 1, paid_amount: 20000, rows: [{ payment_status: 'PAID' }] } : { count: 0, rows: [] } };
      }
      if (url.includes('/payment/') && method === 'GET') {
        if (!net.paymentObject) throw new Error('payment not found');
        return { data: { payment_id: url.split('/').pop(), object_type: 'INVOICE', object_id: net.paymentObject } };
      }
      if (url.includes('/invoice/')) return { data: { invoice_status: 'PAID', invoice_description: net.invoiceDesc } };
      if (url.endsWith('/invoice')) return { data: { invoice_id: 'inv_new', qr_image: 'x', urls: [] } };
      throw new Error('unexpected ' + url);
    };
    return { post: (url, body) => handle('POST', url, body), get: (url) => handle('GET', url) };
  }
  return originalLoad.apply(this, arguments);
};

const qpayRouter = require('../routes/qpay');
const calendarRouter = require('../routes/calendar');
const createPaymentHandler = require('../api/qpay/create-payment');
const { callbackUrlFor } = require('../services/lateBooking');
const { eventIdForInvoice, eventIdForBooking } = require('../services/bookingWriter');
const qpayService = require('../services/qpay');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/qpay', qpayRouter);
  app.use('/api/calendar', calendarRouter);
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const payload = body ? JSON.stringify(body) : '';
      const req = http.request({
        port: server.address().port, method, path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
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

const OUYNSUREN_CAL = require('../config/stylists').STYLIST_CONFIG['Оюунсүрэн'].calendarId;
const AGREED = new Date('2035-06-03T09:00:00Z');

function callbackPath(overrides = {}) {
  const url = callbackUrlFor('https://www.matrixecosalon.org', {
    stylistId: 'Оюунсүрэн', date: '2035-06-04', time: '14:00', customerGender: 'female',
    customerPhone: '99112233', services: 'Энгийн засалт', agreedAt: AGREED, amount: 20000, ...overrides,
  });
  const u = new URL(url);
  return u.pathname + u.search;
}

beforeEach(() => {
  cal.events = {}; cal.busy = []; cal.inserts = []; cal.insertError = null; cal.freebusyCalls = 0; cal.patches = [];
  net.paid = true; net.invoiceDesc = 'Сараа - 99112233'; net.telegram = []; net.checkError = null; net.calls = []; net.paymentObject = null;
  qpayService._resetTokenCache();
});

test('late payment, slot still free: the appointment is booked, no alert', async () => {
  const { status, body } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_1', payment_id: 'p1' });
  assert.equal(status, 200);
  assert.equal(body.handled, 'booked');
  assert.equal(cal.inserts.length, 1);
  const ev = cal.inserts[0];
  assert.equal(ev.id, eventIdForBooking(OUYNSUREN_CAL, new Date('2035-06-04T06:00:00Z'), '99112233'));
  assert.equal(ev.calendarId, OUYNSUREN_CAL);
  assert.equal(ev.start.dateTime, '2035-06-04T06:00:00.000Z');
  assert.equal(ev.end.dateTime, '2035-06-04T07:00:00.000Z');
  assert.ok(ev.description.includes('Name: Сараа'));
  assert.ok(ev.description.includes('Customer: Эмэгтэй (female)'));
  assert.ok(ev.description.includes('Deposit terms accepted: 2035-06-03 17:00:00 (UTC+8)'), ev.description);
  assert.ok(ev.description.includes('QPay invoice: inv_1'));
  assert.equal(ev.transparency, undefined);
  assert.equal(net.telegram.length, 0);
});

test('late payment, slot taken meanwhile: salon alerted with the customer, paid note kept on the calendar', async () => {
  cal.busy = [{ start: '2035-06-04T06:00:00Z', end: '2035-06-04T07:00:00Z' }];
  const { status, body } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_2' });
  assert.equal(status, 200);
  assert.equal(body.handled, 'conflict');
  assert.equal(net.telegram.length, 1);
  const alert = net.telegram[0];
  for (const part of ['Сараа', '99112233', 'Oyunaa', '2035-06-04 14:00', 'Энгийн засалт', '20,000₮', 'inv_2']) {
    assert.ok(alert.includes(part), `alert lacks ${part}: ${alert}`);
  }
  const note = cal.inserts[0];
  assert.equal(note.transparency, 'transparent', 'the note must not block anyone else');
  assert.ok(note.summary.startsWith('⚠ ТӨЛСӨН, ЦАГ ДАВХЦСАН'));
  // A retried callback does not alert twice.
  const again = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_2' });
  assert.equal(again.body.handled, 'conflict');
  assert.equal(net.telegram.length, 1);
});

test('the browser booked first: the callback finds it and does nothing', async () => {
  const app = buildApp();
  const book = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Оюунсүрэн', startTime: '2035-06-04T14:00:00+08:00', customerName: 'Сараа', customerPhone: '99112233',
    selectedServices: 'Энгийн засалт', customerGender: 'female', depositTermsAccepted: true, invoiceId: 'inv_3',
  });
  assert.equal(book.status, 200);
  // The browser's own event now makes the slot busy — it must not read as a conflict.
  cal.busy = [{ start: '2035-06-04T06:00:00Z', end: '2035-06-04T07:00:00Z' }];
  const cb = await request(app, 'POST', callbackPath(), { object_id: 'inv_3' });
  assert.equal(cb.body.handled, 'already-booked');
  assert.equal(cal.inserts.length, 1);
  assert.equal(net.telegram.length, 0);
});

test('the callback booked first: the browser is told it is booked, not double-booked', async () => {
  const app = buildApp();
  await request(app, 'POST', callbackPath(), { object_id: 'inv_4' });
  cal.busy = [{ start: '2035-06-04T06:00:00Z', end: '2035-06-04T07:00:00Z' }];
  const book = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Оюунсүрэн', startTime: '2035-06-04T14:00:00+08:00', customerPhone: '99112233',
    selectedServices: 'Энгийн засалт', customerGender: 'female', invoiceId: 'inv_4',
  });
  assert.equal(book.status, 200);
  assert.equal(book.body.alreadyBooked, true);
  assert.equal(cal.inserts.length, 1);
  assert.equal(net.telegram.length, 0);
});

test('the browser finds its slot taken after paying: 409 conflict and the salon is alerted', async () => {
  cal.busy = [{ start: '2035-06-04T06:30:00Z', end: '2035-06-04T07:30:00Z' }];
  const book = await request(buildApp(), 'POST', '/api/calendar/book', {
    stylistId: 'Оюунсүрэн', startTime: '2035-06-04T14:00:00+08:00', customerName: 'Сараа', customerPhone: '99112233',
    selectedServices: 'Энгийн засалт', customerGender: 'female', invoiceId: 'inv_5',
  });
  assert.equal(book.status, 409);
  assert.equal(book.body.conflict, true);
  assert.equal(net.telegram.length, 1);
});

test('a forged or altered callback is refused and touches nothing', async () => {
  const path = callbackPath().replace('.1400.', '.1500.');
  const { status } = await request(buildApp(), 'POST', path, { object_id: 'inv_6' });
  assert.equal(status, 403);
  assert.equal(cal.inserts.length, 0);
  assert.equal(net.calls.length, 0);
});

test('a callback for an unpaid invoice books nothing', async () => {
  net.paid = false;
  const { body } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_7' });
  assert.equal(body.handled, 'not-paid');
  assert.equal(cal.inserts.length, 0);
  assert.equal(net.telegram.length, 0);
});

test('QPay unreachable while confirming: asks QPay to retry and tells staff to check', async () => {
  net.checkError = new Error('ETIMEDOUT');
  const { status } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_8' });
  assert.equal(status, 502);
  assert.equal(cal.inserts.length, 0);
  assert.equal(net.telegram.length, 1);
});

test('Google Calendar failing after payment: staff are alerted, QPay gets 200', async () => {
  cal.insertError = Object.assign(new Error('backendError'), { code: 500 });
  const { status, body } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_9' });
  assert.equal(status, 200);
  assert.equal(body.handled, 'alerted-error');
  assert.equal(net.telegram.length, 1);
  assert.ok(net.telegram[0].includes('99112233'));
});

test('an invoice whose phone differs from the signed booking is not booked', async () => {
  net.invoiceDesc = 'Хэн нэгэн - 88000000';
  const { body } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_10' });
  assert.equal(body.handled, 'alerted-mismatch');
  assert.equal(cal.inserts.length, 0);
  assert.equal(net.telegram.length, 1);
});

test('a callback naming no invoice is not booked, but staff are told to check', async () => {
  const { body } = await request(buildApp(), 'POST', callbackPath(), { payment_id: 'p9' });
  assert.equal(body.handled, 'alerted-no-invoice-id');
  assert.equal(cal.inserts.length, 0);
  assert.equal(net.telegram.length, 1);
});

test('a callback naming only the payment (GET ?qpay_payment_id=) is resolved to its invoice and booked', async () => {
  net.paymentObject = 'inv_12';
  const { status, body } = await request(buildApp(), 'GET', callbackPath() + '&qpay_payment_id=pay_12');
  assert.equal(status, 200);
  assert.equal(body.handled, 'booked');
  assert.equal(cal.inserts[0].id, eventIdForBooking(OUYNSUREN_CAL, new Date('2035-06-04T06:00:00Z'), '99112233'));
  assert.ok(cal.inserts[0].description.includes('QPay invoice: inv_12'));
});

test('no invoice id at all, but the browser already booked this phone into the slot: no alert', async () => {
  const app = buildApp();
  await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Оюунсүрэн', startTime: '2035-06-04T14:00:00+08:00', customerPhone: '99112233',
    selectedServices: 'Энгийн засалт', customerGender: 'female', invoiceId: 'inv_13',
  });
  const { body } = await request(app, 'POST', callbackPath(), { status: 'PAID' });
  assert.equal(body.handled, 'already-booked');
  assert.equal(net.telegram.length, 0);
  assert.equal(cal.inserts.length, 1);
});

test('a late test payment is booked as «ТЕСТ»', async () => {
  const { body } = await request(buildApp(), 'POST', callbackPath({ test: true, amount: 100 }), { object_id: 'inv_t1' });
  assert.equal(body.handled, 'booked');
  assert.ok(cal.inserts[0].summary.startsWith('ТЕСТ – '), cal.inserts[0].summary);
});

test('an expired QR replaced by a new one: paying the new invoice books once', async () => {
  // Invoice A expired unpaid; the customer took a new QR (invoice B) and paid it.
  const app = buildApp();
  const cb = await request(app, 'POST', callbackPath(), { object_id: 'inv_B' });
  assert.equal(cb.body.handled, 'booked');
  const book = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Оюунсүрэн', startTime: '2035-06-04T14:00:00+08:00', customerPhone: '99112233',
    selectedServices: 'Энгийн засалт', customerGender: 'female', invoiceId: 'inv_B',
  });
  assert.equal(book.body.alreadyBooked, true);
  assert.equal(cal.inserts.length, 1);
  assert.equal(net.telegram.length, 0);
});

test('both the old and the new invoice paid: one booking, staff told once to refund one', async () => {
  const app = buildApp();
  await request(app, 'POST', callbackPath(), { object_id: 'inv_A' });
  const second = await request(app, 'POST', callbackPath(), { object_id: 'inv_B' });
  assert.equal(second.body.handled, 'already-booked');
  assert.equal(cal.inserts.length, 1, 'never a second appointment');
  assert.equal(net.telegram.length, 1);
  assert.ok(net.telegram[0].includes('давхар төлбөр') && net.telegram[0].includes('inv_B'), net.telegram[0]);
  // QPay retrying the second callback does not alert again.
  await request(app, 'POST', callbackPath(), { object_id: 'inv_B' });
  assert.equal(net.telegram.length, 1);
  assert.equal(cal.inserts.length, 1);
});

test('a booking written under the older per-invoice id is still recognised', async () => {
  cal.events[eventIdForInvoice('inv_old')] = {
    id: eventIdForInvoice('inv_old'), calendarId: OUYNSUREN_CAL, status: 'confirmed',
    description: 'QPay invoice: inv_old', start: { dateTime: '2035-06-04T06:00:00.000Z' }, end: { dateTime: '2035-06-04T07:00:00.000Z' },
  };
  cal.busy = [{ start: '2035-06-04T06:00:00Z', end: '2035-06-04T07:00:00Z' }];
  const { body } = await request(buildApp(), 'POST', callbackPath(), { object_id: 'inv_old' });
  assert.equal(body.handled, 'already-booked');
  assert.equal(cal.inserts.length, 0);
  assert.equal(net.telegram.length, 0);
});

test('a long appointment keeps its signed length when booked late', async () => {
  const { body } = await request(buildApp(), 'POST', callbackPath({ services: 'Оффис колор' }), { object_id: 'inv_11' });
  assert.equal(body.handled, 'booked');
  const ev = cal.inserts[0];
  assert.equal((new Date(ev.end.dateTime) - new Date(ev.start.dateTime)) / 60000, 240);
});

test('production create-payment gives every invoice a signed callback QPay can store', async () => {
  const res = await new Promise((resolve) => {
    createPaymentHandler({
      method: 'POST',
      headers: { host: 'www.matrixecosalon.org' },
      body: {
        amount: '20000', name: 'Сараа', phone: '99112233', staffName: 'Оюунсүрэн',
        customerGender: 'female', depositTermsAccepted: true, depositTermsAcceptedAt: new Date().toISOString(),
        bookingDate: '2035-06-04', selectedServices: 'Энгийн засалт, Хэлбэрт',
        description: 'Matrix Eco: Оюунсүрэн - 2035-06-04 14:00 - Сараа - 99112233',
      },
    }, { status(c) { this.c = c; return this; }, json(b) { resolve({ status: this.c, body: b }); } });
  });
  assert.equal(res.status, 200);
  const invoiceCall = net.calls.find((c) => c.url.endsWith('/invoice'));
  const cb = invoiceCall.body.callback_url;
  assert.ok(cb.startsWith('https://www.matrixecosalon.org/api/qpay/late-payment?b=v1.oyunaa.20350604.1400.f.99112233.'), cb);
  assert.ok(cb.length <= 255, `callback is ${cb.length} chars`);
});
