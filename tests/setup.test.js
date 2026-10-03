'use strict';

/**
 * The preview-only setup check (routes/setup.js): it names the service
 * account calendars must be shared with, reports each hairdresser's calendar,
 * and proves on a Парк Од calendar that a written event lands there and takes
 * its hour out of the free times — then deletes it. Never on Production.
 */

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const http = require('node:http');
const express = require('express');

process.env.QPAY_USERNAME = 'u';
process.env.QPAY_PASSWORD = 'p';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'site@tara-test.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';
process.env.SALON_CLOSURE_START = 'none';
process.env.TELEGRAM_CHAT_ID = '-100yaarmag';

const SARAA_CAL = 'saraa-cal@group.calendar.google.com';
// A calendar that remembers events, answers freebusy from them, and knows
// which calendars the service account was given.
const store = { events: new Map(), shared: new Set([SARAA_CAL]), deleted: [] };
let nextId = 1;
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'googleapis') {
    const notFound = () => { const e = new Error('Not Found'); e.code = 404; e.response = { status: 404 }; return e; };
    return {
      google: {
        auth: { JWT: class { async authorize() { return {}; } } },
        calendar: () => ({
          calendars: {
            get: async ({ calendarId }) => {
              if (!store.shared.has(calendarId)) throw notFound();
              return { data: { summary: 'Saraa', timeZone: 'Asia/Ulaanbaatar' } };
            },
          },
          freebusy: {
            query: async ({ requestBody }) => {
              const id = requestBody.items[0].id;
              const busy = [...store.events.values()].filter((e) => e.calendarId === id)
                .map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }));
              return { data: { calendars: { [id]: { busy } } } };
            },
          },
          events: {
            insert: async ({ calendarId, requestBody }) => {
              const id = `ev${nextId++}`;
              store.events.set(id, { ...requestBody, id, calendarId });
              return { data: { ...requestBody, id } };
            },
            get: async ({ calendarId, eventId }) => {
              const e = store.events.get(eventId);
              if (!e || e.calendarId !== calendarId) throw notFound();
              return { data: e };
            },
            delete: async ({ calendarId, eventId }) => {
              const e = store.events.get(eventId);
              if (!e || e.calendarId !== calendarId) throw notFound();
              store.events.delete(eventId);
              store.deleted.push(eventId);
              return { data: {} };
            },
            list: async ({ calendarId }) => ({ data: { items: [...store.events.values()].filter((e) => e.calendarId === calendarId) } }),
          },
        }),
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

const calendarRouter = require('../routes/calendar');
const setupRouter = require('../routes/setup');

const PARKOD_ENV = {
  PARKOD_QPAY_BANK_CODE: '050000',
  PARKOD_QPAY_ACCOUNT_NUMBER: '5000123456',
  PARKOD_QPAY_ACCOUNT_NAME: 'Парк Од эзэмшигч',
  PARKOD_TELEGRAM_CHAT_ID: '-100founder',
  PARKOD_CALENDAR_SARAA: SARAA_CAL,
};

beforeEach(() => {
  Object.assign(process.env, PARKOD_ENV);
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  store.events.clear();
  store.deleted = [];
});

function get(path) {
  const app = express();
  app.use('/api/calendar', calendarRouter);
  app.use('/api/setup', setupRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({ port: server.address().port, path }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('check: names the service account and each hairdresser\'s calendar variable', async () => {
  const r = await get('/api/setup/check');
  assert.equal(r.status, 200);
  assert.equal(r.body.serviceAccount, 'site@tara-test.iam.gserviceaccount.com');
  assert.match(r.body.shareWith, /Make changes to events/);
  const parkod = r.body.branches.parkod;
  assert.deepEqual(parkod.stylists.map((s) => s.variable), [
    'PARKOD_CALENDAR_BOLOROO', 'PARKOD_CALENDAR_SARAA', 'PARKOD_CALENDAR_TOMOO', 'PARKOD_CALENDAR_BULGAA',
    'PARKOD_CALENDAR_ENHUUSH', 'PARKOD_CALENDAR_CHIMEGEE', 'PARKOD_CALENDAR_TUCHKU',
  ]);
  const saraa = parkod.stylists.find((s) => s.name === 'Saraa');
  assert.deepEqual([saraa.set, saraa.readable], [true, true]);
  const boloroo = parkod.stylists.find((s) => s.name === 'Boloroo');
  assert.deepEqual([boloroo.set, boloroo.readable], [false, false]);
  assert.deepEqual(parkod.readiness, { ready: true, reason: 'ok' });
  assert.equal(parkod.calendarsDistinct, true);
  assert.equal(saraa.timeZone, 'Asia/Ulaanbaatar');
  process.env.PARKOD_CALENDAR_TOMOO = SARAA_CAL;
  assert.equal((await get('/api/setup/check')).body.branches.parkod.calendarsDistinct, false, 'two hairdressers on one calendar');
  delete process.env.PARKOD_CALENDAR_TOMOO;
  assert.equal(r.body.branches.yaarmag.stylists.length, 7);
  assert.ok(r.body.branches.yaarmag.stylists.every((s) => s.variable === null && s.set), 'Яармаг keeps its fixed calendars');
  assert.ok(!JSON.stringify(r.body).includes('@group.calendar.google.com'), 'no calendar ids are shown');
});

test('prove: a test event lands in her calendar, takes its hour, and is deleted', async () => {
  const r = await get('/api/setup/prove?stylist=Saraa&date=2035-06-04');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.landedInHerCalendar, true);
  assert.equal(r.body.hourNoLongerOffered, true);
  assert.equal(r.body.testEventDeleted, true);
  assert.ok(r.body.slotsBefore.availableSlots.includes(r.body.testEvent.time));
  assert.equal(store.events.size, 0, 'nothing left in the calendar');
  assert.equal(store.deleted.length, 1);
});

test('prove: only Парк Од hairdressers by name, never Яармаг\'s live calendars', async () => {
  for (const s of ['Oyunaa', 'Anand', 'saraa', 'Сараа', 'nobody']) {
    const r = await get(`/api/setup/prove?stylist=${encodeURIComponent(s)}`);
    assert.equal(r.status, 400, s);
  }
  delete process.env.PARKOD_CALENDAR_SARAA;
  assert.equal((await get('/api/setup/prove?stylist=Saraa')).status, 409);
  assert.equal(store.events.size, 0);
});

test('Production: every setup route is 404', async () => {
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  assert.equal((await get('/api/setup/check')).status, 404);
  assert.equal((await get('/api/setup/prove?stylist=Saraa')).status, 404);
  process.env.VERCEL_ENV = 'preview';
  assert.equal((await get('/api/setup/check')).status, 200);
});

test('cleanup-test: removes only the test link\'s booking, nothing else', async () => {
  const at = (h) => ({ dateTime: new Date(`2035-06-04T${h}:00:00+08:00`).toISOString() });
  store.events.set('qbtest1', { id: 'qbtest1', calendarId: SARAA_CAL, summary: 'ТЕСТ – 99112233 - Тест', start: at(14), end: at(15) });
  store.events.set('qbreal1', { id: 'qbreal1', calendarId: SARAA_CAL, summary: '99887766 - Бат', start: at(16), end: at(17) });
  store.events.set('own1', { id: 'own1', calendarId: SARAA_CAL, summary: 'ТЕСТ – written by hand', start: at(11), end: at(12) });
  const r = await get('/api/setup/cleanup-test?stylist=Saraa&date=2035-06-04');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.removed.map((e) => e.summary), ['ТЕСТ – 99112233 - Тест']);
  assert.ok(store.events.has('qbreal1') && store.events.has('own1'), 'a real booking and a hand-made event stay');
  assert.equal((await get('/api/setup/cleanup-test?stylist=saraa&date=2035-06-04')).status, 400);
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  assert.equal((await get('/api/setup/cleanup-test?stylist=Saraa&date=2035-06-04')).status, 404);
});

test('test-cookie: gives the signed 100₮ test cookie on a preview, never on Production', async () => {
  const { isTestRequest, depositFor } = require('../config/siteMode');
  delete process.env.BOOKING_TEST_TOKEN;
  assert.equal((await get('/api/setup/test-cookie')).status, 409, 'no token, no cookie');
  process.env.BOOKING_TEST_TOKEN = 'preview-test-token-0123456789';
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  const r = await get('/api/setup/test-cookie');
  assert.equal(r.status, 200);
  const cookie = r.headers['set-cookie'].find((c) => c.startsWith('mx_test='));
  assert.ok(cookie, 'sets mx_test');
  const req = { headers: { cookie: cookie.split(';')[0] } };
  assert.equal(isTestRequest(req), true);
  assert.equal(depositFor(req, 'Saraa'), 100);
  assert.equal(depositFor({ headers: {} }, 'Saraa'), 20000);
  process.env.VERCEL_ENV = 'production';
  const prod = await get('/api/setup/test-cookie');
  assert.equal(prod.status, 404);
  assert.equal(prod.headers['set-cookie'], undefined);
  delete process.env.BOOKING_TEST_TOKEN;
});
