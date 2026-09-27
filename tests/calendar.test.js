'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const http = require('node:http');
const express = require('express');

// ---------------------------------------------------------------------------
// Set required environment variables before loading any calendar modules.
// ---------------------------------------------------------------------------
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';

// ---------------------------------------------------------------------------
// Stub googleapis before loading any calendar modules.
// The stub exposes configurable return values / errors for freebusy.query
// and events.insert.
// ---------------------------------------------------------------------------
const calendarStub = {
  _freebusyResult: null,
  _freebusyError: null,
  _insertResult: null,
  _insertError: null,
  _lastInsertArg: null,
  // Events already on the calendar, by id (for the per-invoice idempotency check).
  _events: {},
};

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'googleapis') {
    return {
      google: {
        auth: {
          GoogleAuth: class {
            constructor() {}
            async getClient() { return {}; }
          },
          JWT: class {
            constructor() {}
            async authorize() { return {}; }
          },
        },
        calendar: () => ({
          freebusy: {
            query: async () => {
              if (calendarStub._freebusyError) throw calendarStub._freebusyError;
              return calendarStub._freebusyResult;
            },
          },
          events: {
            get: async ({ eventId }) => {
              if (calendarStub._events[eventId]) return { data: calendarStub._events[eventId] };
              const err = new Error('Not Found'); err.code = 404; throw err;
            },
            insert: async (arg) => {
              calendarStub._lastInsertArg = arg;
              if (calendarStub._insertError) throw calendarStub._insertError;
              return calendarStub._insertResult;
            },
          },
        }),
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Each test starts with an empty calendar: no busy periods, no events.
beforeEach(() => {
  calendarStub._freebusyResult = null;
  calendarStub._freebusyError = null;
  calendarStub._events = {};
});

// Load route and service utilities after stubs are in place
const calendarRouter = require('../routes/calendar');
const { normalisePrivateKey } = require('../services/googleCalendar');
const { STYLIST_CONFIG, OTGONZARGAL_CALENDAR_ID } = require('../config/stylists');

// ---------------------------------------------------------------------------
// normalisePrivateKey unit tests
// ---------------------------------------------------------------------------
test('normalisePrivateKey: replaces literal \\n with real newlines', () => {
  const raw = '-----BEGIN PRIVATE KEY-----\\nMIItest\\n-----END PRIVATE KEY-----\\n';
  const result = normalisePrivateKey(raw);
  assert.ok(result.includes('\n'), 'should contain real newlines');
  assert.ok(!result.includes('\\n'), 'should not contain literal \\n');
});

test('normalisePrivateKey: strips surrounding double-quotes', () => {
  const raw = '"-----BEGIN PRIVATE KEY-----\\nMIItest\\n-----END PRIVATE KEY-----\\n"';
  const result = normalisePrivateKey(raw);
  assert.ok(!result.startsWith('"'), 'should not start with double-quote');
  assert.ok(!result.endsWith('"'), 'should not end with double-quote');
  assert.ok(result.startsWith('-----BEGIN'), 'should start with PEM header');
});

test('normalisePrivateKey: strips surrounding single-quotes', () => {
  const raw = "'-----BEGIN PRIVATE KEY-----\\nMIItest\\n-----END PRIVATE KEY-----\\n'";
  const result = normalisePrivateKey(raw);
  assert.ok(!result.startsWith("'"), 'should not start with single-quote');
  assert.ok(result.startsWith('-----BEGIN'), 'should start with PEM header');
});

test('normalisePrivateKey: leaves real newlines intact', () => {
  const raw = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';
  const result = normalisePrivateKey(raw);
  assert.equal(result, raw, 'should be unchanged when newlines are already real');
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/calendar', calendarRouter);
  return app;
}

function request(app, method, path, bodyOrQuery) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const isGet = method === 'GET';
      const url = isGet && bodyOrQuery
        ? `${path}?${new URLSearchParams(bodyOrQuery).toString()}`
        : path;
      const data = !isGet && bodyOrQuery ? JSON.stringify(bodyOrQuery) : null;
      const options = {
        hostname: '127.0.0.1',
        port,
        path: url,
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

// Known stylist used across tests (still employed)
const VALID_STYLIST_ID = 'anand';
const VALID_CALENDAR_ID = 'c_2af068656b60e27cd9063a78b04dffbe24f1aab4543e50c2875f132dc4b12e17@group.calendar.google.com';
const VALID_DATE = '2035-06-04';        // Monday  (UTC+8) → Mon–Sat hours: 10:00–20:00
const VALID_DATE_SUNDAY = '2035-06-03'; // Sunday  (UTC+8) → Sun hours:     11:00–19:00

// The former manicurist. The salon no longer offers manicure, so these ids
// must not resolve to anything bookable.
const MUNKHZAYA_STYLIST_ID_MN = 'Г. Мөнхзаяа';
const MUNKHZAYA_STYLIST_ID_LATIN = 'g.munkhzaya';

// Hairdresser Отгонжаргал IDs and her dedicated calendar ID (OTGONZARGAL_CALENDAR_ID imported above)
const OTGONZARGAL_STYLIST_ID_MN = 'Отгонжаргал';
const OTGONZARGAL_STYLIST_ID_LATIN = 'otgonzargal';

// ---------------------------------------------------------------------------
// GET /api/calendar/available-slots
// ---------------------------------------------------------------------------
test('available-slots: 400 when date is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { stylistId: VALID_STYLIST_ID });
  assert.equal(status, 400);
  assert.ok(body.error.includes('date'));
});

test('available-slots: 400 when stylistId is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE });
  assert.equal(status, 400);
  assert.ok(body.error.includes('stylistId'));
});

test('available-slots: 400 when date format is invalid', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: '10-03-2026', stylistId: VALID_STYLIST_ID });
  assert.equal(status, 400);
  assert.ok(body.error.toLowerCase().includes('yyyy-mm-dd'));
});

test('available-slots: 400 when stylistId is unknown', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE, stylistId: 'altangerel' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('stylistId'));
});

test('available-slots: 200 with all slots free when no busy periods', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE, stylistId: VALID_STYLIST_ID });
  assert.equal(status, 200);
  assert.equal(body.date, VALID_DATE);
  assert.equal(body.stylistId, VALID_STYLIST_ID);
  // VALID_DATE is Monday → Mon–Sat hours: slots 10:00–19:00 → 10 slots
  assert.equal(body.availableSlots.length, 10);
  assert.ok(body.availableSlots.includes('10:00'));
  assert.ok(body.availableSlots.includes('19:00'));
});

test('available-slots: 200 with busy slot removed', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: {
      calendars: {
        [VALID_CALENDAR_ID]: {
          busy: [
            // 10:00 Ulaanbaatar (UTC+8) = 02:00 UTC
            { start: `${VALID_DATE}T02:00:00Z`, end: `${VALID_DATE}T03:00:00Z` },
          ],
        },
      },
    },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE, stylistId: VALID_STYLIST_ID });
  assert.equal(status, 200);
  assert.ok(!body.availableSlots.includes('10:00'), '10:00 should be busy');
  assert.ok(body.availableSlots.includes('11:00'));
  assert.ok(body.availableSlots.includes('19:00'));
});

test('available-slots: 200 Sunday hours (11:00–19:00) with all slots free', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE_SUNDAY, stylistId: VALID_STYLIST_ID });
  assert.equal(status, 200);
  assert.equal(body.date, VALID_DATE_SUNDAY);
  // VALID_DATE_SUNDAY is Sunday → Sun hours: slots 11:00–18:00 → 8 slots
  assert.equal(body.availableSlots.length, 8);
  assert.ok(!body.availableSlots.includes('10:00'), '10:00 is before Sunday opening');
  assert.ok(body.availableSlots.includes('11:00'));
  assert.ok(body.availableSlots.includes('18:00'));
  assert.ok(!body.availableSlots.includes('19:00'), '19:00 is after last Sunday slot');
});

test('available-slots: 200 with a fully past date returns empty slots (past-slot filter)', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: '2020-01-06', stylistId: VALID_STYLIST_ID });
  assert.equal(status, 200);
  // 2020-01-06 is in the past; all slots should be filtered out
  assert.equal(body.availableSlots.length, 0);
});

test('available-slots: 500 when Google Calendar API throws', async () => {
  calendarStub._freebusyError = new Error('Google API unavailable');
  calendarStub._freebusyResult = null;
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE, stylistId: VALID_STYLIST_ID });
  assert.equal(status, 500);
  assert.ok(body.error.includes('availability'));
  calendarStub._freebusyError = null;
});

test('available-slots: 500 when calendar returns per-calendar access error', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: {
      calendars: {
        [VALID_CALENDAR_ID]: {
          errors: [{ domain: 'calendar', reason: 'notFound' }],
        },
      },
    },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE, stylistId: VALID_STYLIST_ID });
  assert.equal(status, 500);
  assert.ok(body.error.includes('availability'));
  assert.ok(body.details.includes('notFound'));
});

// ---------------------------------------------------------------------------
// POST /api/calendar/book
// ---------------------------------------------------------------------------
test('book: 400 when stylistId is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', { startTime: '2026-03-10T10:00:00Z' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('stylistId'));
});

test('book: 400 when startTime is missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', { stylistId: VALID_STYLIST_ID });
  assert.equal(status, 400);
  assert.ok(body.error.includes('startTime'));
});

test('book: 400 when stylistId is unknown', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', { stylistId: 'altangerel', startTime: '2026-03-10T10:00:00Z' });
  assert.equal(status, 400);
  assert.ok(body.error.includes('stylistId'));
});

test('book: 200 when calendar event is created successfully', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'booking_xyz' } };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2026-03-10T10:00:00Z',
    customerName: 'Test Customer',
    customerPhone: '+97699112233',
    customerEmail: 'test@example.com',
    serviceName: 'Haircut',
  });
  assert.equal(status, 200);
  assert.equal(body.eventId, 'booking_xyz');
  assert.ok(body.message.includes('success'));
});

test('book: 500 when Google Calendar API throws', async () => {
  calendarStub._insertError = new Error('Insert failed');
  calendarStub._insertResult = null;
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2026-03-10T10:00:00Z',
  });
  assert.equal(status, 500);
  assert.ok(body.error.includes('booking'));
  calendarStub._insertError = null;
});

// ---------------------------------------------------------------------------
// Manicure is no longer offered
// ---------------------------------------------------------------------------
test('STYLIST_CONFIG: the former manicurist is not a bookable stylist', () => {
  assert.equal(STYLIST_CONFIG[MUNKHZAYA_STYLIST_ID_MN], undefined);
  assert.equal(STYLIST_CONFIG[MUNKHZAYA_STYLIST_ID_LATIN], undefined);
  for (const [id, cfg] of Object.entries(STYLIST_CONFIG)) {
    assert.notEqual(cfg.level, 'Маникюр', `${id} must not be a manicure stylist`);
  }
});

test('available-slots: 400 for the former manicurist', async () => {
  const app = buildApp();
  for (const stylistId of [MUNKHZAYA_STYLIST_ID_MN, MUNKHZAYA_STYLIST_ID_LATIN]) {
    const { status } = await request(app, 'GET', '/api/calendar/available-slots', { date: VALID_DATE, stylistId });
    assert.equal(status, 400, stylistId);
  }
});

test('book: 400 for the former manicurist, and nothing is written', async () => {
  calendarStub._insertError = null;
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: MUNKHZAYA_STYLIST_ID_MN,
    startTime: '2035-06-05T10:00:00+08:00',
    customerName: 'Test Customer',
    selectedServices: 'Гелэн будалт',
  });
  assert.equal(status, 400);
  assert.equal(calendarStub._lastInsertArg, null);
});

test('STYLIST_CONFIG: every hairdresser has a recorded gender', () => {
  for (const [id, cfg] of Object.entries(STYLIST_CONFIG)) {
    assert.ok(cfg.gender === 'female' || cfg.gender === 'male', `${id} has no gender`);
  }
  assert.equal(STYLIST_CONFIG['Ананд'].gender, 'male');
  assert.equal(STYLIST_CONFIG['Оюунсүрэн'].gender, 'female');
});

test('book: a client-supplied totalDuration cannot inflate the booking', async () => {
  // The browser's number is never trusted on its own: it decides how much of a
  // stylist's day is blocked, so anyone could otherwise squat a whole day.
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'inflate_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-05T10:00:00+08:00',
    customerName: 'Test Customer',
    selectedServices: 'Энгийн засалт',
    totalDuration: 600,
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const diffMinutes = (new Date(end.dateTime) - new Date(start.dateTime)) / (60 * 1000);
  assert.equal(diffMinutes, 60, 'the configured 60 minutes wins over the claimed 600');
});

test('book: a hairdresser booking ignores a bare totalDuration', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'hairdresser_ignore_duration_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-04T13:00:00+08:00',
    customerName: 'Test Customer',
    totalDuration: 999,
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const diffMinutes = (new Date(end.dateTime) - new Date(start.dateTime)) / (60 * 1000);
  assert.equal(diffMinutes, 60, 'Regular hairdresser should always use 60 minutes regardless of totalDuration');
});

test('book: regular hairdresser booking creates a 60-minute event (end = start + 60 min)', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'regular_duration_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-04T13:00:00+08:00',
    customerName: 'Test Customer',
    serviceName: 'Haircut',
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const startMs = new Date(start.dateTime).getTime();
  const endMs = new Date(end.dateTime).getTime();
  const diffMinutes = (endMs - startMs) / (60 * 1000);
  assert.equal(diffMinutes, 60, 'Regular hairdresser booking should last exactly 60 minutes');
});

// ---------------------------------------------------------------------------
// Customer gender and the non-refundable deposit, recorded on the booking
// ---------------------------------------------------------------------------
test('book: refuses a female customer with a male hairdresser, writing nothing', async () => {
  calendarStub._insertError = null;
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Ананд',
    startTime: '2035-06-04T13:00:00+08:00',
    customerName: 'Test',
    customerGender: 'female',
    depositTermsAccepted: true,
  });
  assert.equal(status, 422);
  assert.equal(body.reason, 'gender-mismatch');
  assert.equal(calendarStub._lastInsertArg, null);
});

test('book: records the customer and when they agreed the deposit terms', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'consent_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const acceptedAt = new Date(Date.now() - 2 * 60 * 1000);
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Оюунсүрэн',
    startTime: '2035-06-04T13:00:00+08:00',
    customerName: 'Test',
    customerPhone: '99001122',
    selectedServices: 'Энгийн засалт',
    customerGender: 'female',
    depositTermsAccepted: true,
    depositTermsAcceptedAt: acceptedAt.toISOString(),
    invoiceId: 'inv_123',
  });
  assert.equal(status, 200);
  const { description } = calendarStub._lastInsertArg.requestBody;
  const local = new Date(acceptedAt.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  assert.ok(description.includes('Customer: Эмэгтэй (female)'), description);
  assert.ok(description.includes(`Deposit terms accepted: ${local} (UTC+8)`), description);
  assert.ok(description.includes('буцаан олгогдохгүй гэдгийг ойлгож, зөвшөөрч байна.'), description);
  assert.ok(description.includes('QPay invoice: inv_123'), description);
});

test('book: an implausible agreement time is replaced by the server time, and says so', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'consent_time_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Ананд',
    startTime: '2035-06-04T13:00:00+08:00',
    customerGender: 'male',
    depositTermsAccepted: true,
    depositTermsAcceptedAt: '2001-01-01T00:00:00Z',
  });
  assert.equal(status, 200);
  const { description } = calendarStub._lastInsertArg.requestBody;
  assert.ok(description.includes('(time recorded at booking)'), description);
  assert.ok(!description.includes('2001-01-01'), description);
});

test('book: a paid booking from an older page is still created, marked as unrecorded', async () => {
  // Refusing here would leave a customer who has already paid with no
  // appointment; create-payment is where the rules are enforced.
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'legacy_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: 'Ананд',
    startTime: '2035-06-04T13:00:00+08:00',
    customerName: 'Test',
  });
  assert.equal(status, 200);
  const { description } = calendarStub._lastInsertArg.requestBody;
  assert.ok(description.includes('Customer: not recorded'), description);
  assert.ok(description.includes('Deposit terms accepted: NOT RECORDED'), description);
});

// ---------------------------------------------------------------------------
// Hairdresser (Отгонжаргал) calendar routing
// ---------------------------------------------------------------------------
test('STYLIST_CONFIG: Отгонжаргал uses her dedicated calendar ID', () => {
  assert.equal(
    STYLIST_CONFIG[OTGONZARGAL_STYLIST_ID_MN].calendarId,
    OTGONZARGAL_CALENDAR_ID,
    'Mongolian key should map to the hairdresser calendar',
  );
});

test('STYLIST_CONFIG: otgonzargal (Latin alias) uses the same dedicated calendar ID', () => {
  assert.equal(
    STYLIST_CONFIG[OTGONZARGAL_STYLIST_ID_LATIN].calendarId,
    OTGONZARGAL_CALENDAR_ID,
    'Latin alias should map to the hairdresser calendar',
  );
});

test('book: 200 booking for Отгонжаргал routes to her calendar', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'otgonzargal_booking_001' } };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: OTGONZARGAL_STYLIST_ID_LATIN,
    startTime: '2035-06-05T10:00:00+08:00',
    customerName: 'Test Customer',
    serviceName: '1-р зэргийн үсчин',
  });
  assert.equal(status, 200);
  assert.equal(body.eventId, 'otgonzargal_booking_001');
  assert.ok(body.message.includes('success'));
});

test('STYLIST_CONFIG: Отгонжаргал price is 10000 (1-р зэргийн үсчин tier)', () => {
  assert.equal(STYLIST_CONFIG[OTGONZARGAL_STYLIST_ID_MN].price, 10000);
  assert.equal(STYLIST_CONFIG[OTGONZARGAL_STYLIST_ID_LATIN].price, 10000);
});

test('available-slots: 200 for Отгонжаргал routes to her calendar', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [OTGONZARGAL_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: OTGONZARGAL_STYLIST_ID_LATIN,
  });
  assert.equal(status, 200);
  assert.equal(body.stylistId, OTGONZARGAL_STYLIST_ID_LATIN);
  assert.equal(body.availableSlots.length, 10);
});

// ---------------------------------------------------------------------------
// Event summary format: phone - selectedServices
// ---------------------------------------------------------------------------
test('book: event summary uses format "phone - selectedServices" when both are provided', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'summary_test_001' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-04T10:00:00+08:00',
    customerName: 'Ganaa',
    customerPhone: '91915498',
    selectedServices: 'Том хүн, Будаг (Уг)',
  });
  assert.equal(status, 200);
  const { summary, description } = calendarStub._lastInsertArg.requestBody;
  assert.ok(summary.includes('91915498'), 'summary should contain the phone number');
  assert.ok(summary.includes('Том хүн, Будаг (Уг)'), 'summary should contain selected services');
  assert.ok(!summary.includes('Ganaa'), 'customer name should not appear in summary');
  assert.ok(description.includes('Ganaa'), 'customer name should appear in description');
});

test('book: event summary uses services when no phone is provided', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'summary_test_002' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-04T10:00:00+08:00',
    customerName: 'Ganaa',
    selectedServices: 'Хусалт',
  });
  assert.equal(status, 200);
  const { summary, description } = calendarStub._lastInsertArg.requestBody;
  assert.ok(summary.includes('Хусалт'), 'summary should contain the selected service');
  assert.ok(!summary.includes('undefined'), 'summary should not contain "undefined"');
  assert.ok(description.includes('Ganaa'), 'customer name should appear in description');
});

test('book: event summary falls back to serviceName when selectedServices not provided', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'summary_test_003' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-04T10:00:00+08:00',
    customerName: 'Ganaa',
    customerPhone: '91915498',
    serviceName: 'Haircut',
  });
  assert.equal(status, 200);
  const summary = calendarStub._lastInsertArg.requestBody.summary;
  assert.ok(summary.includes('91915498'), 'summary should contain the phone number');
  assert.ok(summary.includes('Haircut'), 'summary should fall back to serviceName');
});

// ---------------------------------------------------------------------------
// Service-duration-aware availability
//
// The salon's complaint: booking offered 18:00 for a 4-hour service on a day
// that closes at 20:00, so the customer arrived for a slot nobody could honour.
// These pin both halves of that — how late a start may be, and how far ahead a
// conflict counts.
// ---------------------------------------------------------------------------

test('available-slots: a 4-hour service hides every late-afternoon start', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  // VALID_DATE is a Monday: 10:00–20:00. "Оффис колор" takes 240 minutes, so
  // the last honourable start is 16:00.
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: VALID_STYLIST_ID,
    services: 'Оффис колор',
  });
  assert.equal(status, 200);
  assert.equal(body.durationMinutes, 240);
  assert.ok(body.availableSlots.includes('10:00'), 'a morning start still fits');
  assert.ok(body.availableSlots.includes('16:00'), '16:00 + 4h ends exactly at closing');
  assert.ok(!body.availableSlots.includes('17:00'), '17:00 would run past closing');
  assert.ok(!body.availableSlots.includes('18:00'), 'the reported bug: 18:00 must not be offered');
  assert.ok(!body.availableSlots.includes('19:00'), '19:00 would run three hours past closing');
  assert.equal(body.availableSlots.length, 7); // 10:00 … 16:00
});

test('available-slots: a 1-hour service is unaffected (still 10:00–19:00)', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: VALID_STYLIST_ID,
    services: 'Энгийн засалт',
  });
  assert.equal(status, 200);
  assert.equal(body.durationMinutes, 60);
  assert.equal(body.availableSlots.length, 10);
  assert.ok(body.availableSlots.includes('19:00'));
});

test('available-slots: selected services add up', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  // Угаалт (30) + Энгийн засалт (60) + Эмчилгээний хими (120) = 210 minutes.
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: VALID_STYLIST_ID,
    services: 'Угаалт,Энгийн засалт,Эмчилгээний хими',
  });
  assert.equal(status, 200);
  assert.equal(body.durationMinutes, 210);
  // Last start whose 3h30 finishes by 20:00, on the hour, is 16:00.
  assert.ok(body.availableSlots.includes('16:00'));
  assert.ok(!body.availableSlots.includes('17:00'));
});

test('available-slots: a long service conflicts with a booking hours later', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: {
      calendars: {
        [VALID_CALENDAR_ID]: {
          busy: [
            // 15:00–16:00 Ulaanbaatar (UTC+8) = 07:00–08:00 UTC
            { start: `${VALID_DATE}T07:00:00Z`, end: `${VALID_DATE}T08:00:00Z` },
          ],
        },
      },
    },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: VALID_STYLIST_ID,
    services: 'Оффис колор',
  });
  assert.equal(status, 200);
  // A 4-hour appointment starting at 12:00 runs to 16:00 and swallows the 15:00
  // booking — the old one-hour overlap window would have offered it.
  assert.ok(!body.availableSlots.includes('12:00'), '12:00–16:00 overlaps the 15:00 booking');
  assert.ok(!body.availableSlots.includes('13:00'));
  assert.ok(!body.availableSlots.includes('14:00'));
  assert.ok(!body.availableSlots.includes('15:00'));
  assert.ok(body.availableSlots.includes('11:00'), '11:00–15:00 ends as the booking starts');
  assert.ok(body.availableSlots.includes('16:00'), '16:00 starts as the booking ends');
});

test('available-slots: an unknown service name is charged the default, not zero', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: VALID_STYLIST_ID,
    services: 'Ийм үйлчилгээ байхгүй',
  });
  assert.equal(status, 200);
  assert.equal(body.durationMinutes, 60, 'unknown names must never shorten an appointment');
});

test('available-slots: names differing only in punctuation or ё/е still resolve', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  // "Оффис колор/Сор" is a retired label — the price list used to run the two
  // separate services together under it. It is kept as an alias of "Оффис колор"
  // because the string still arrives (a cached script.js, or staff quoting the
  // salon's own spelling), and both must mean 240 minutes.
  const { body: viaAlias } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Оффис колор/Сор',
  });
  assert.equal(viaAlias.durationMinutes, 240);

  const { body: viaYo } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Чёлк тайралт',
  });
  assert.equal(viaYo.durationMinutes, 15);

  // "Хими / Sika" is the label the booking list used before the salon confirmed
  // the service is «Эмчилгээний хими». A browser still holding the old script.js
  // posts it, so it must keep resolving to the same 2 hours.
  const { body: viaOldPerm } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Хими / Sika',
  });
  assert.equal(viaOldPerm.durationMinutes, 120);

  const { body: viaNewPerm } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Эмчилгээний хими',
  });
  assert.equal(viaNewPerm.durationMinutes, 120);
});

test('available-slots: Сор and Оффис колор are separate services, not one', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  // The salon runs plain Сор and Оффис колор (three dyes combined) as different
  // services at different lengths. A customer who ticks Сор must not have four
  // hours of the stylist's day taken, and one who ticks Оффис колор must not be
  // offered a start that only fits three.
  const { body: sor } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Сор',
  });
  assert.equal(sor.durationMinutes, 180);

  const { body: office } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Оффис колор',
  });
  assert.equal(office.durationMinutes, 240);
});

test('available-slots: a service too long for the day offers nothing at all', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [VALID_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  // Омбре (300) + Цайруулалт (300) = 10 hours; the Monday window is 10 hours,
  // so only a 10:00 start fits. Add a wash and nothing fits.
  const { body: exact } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Омбре / Колор,Цайруулалт',
  });
  assert.deepEqual(exact.availableSlots, ['10:00']);

  const { body: tooLong } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE, stylistId: VALID_STYLIST_ID, services: 'Омбре / Колор,Цайруулалт,Угаалт',
  });
  assert.deepEqual(tooLong.availableSlots, [], 'no start can honour an 10h30 appointment');
});

test('book: a 4-hour service is written to the calendar as 4 hours', async () => {
  // The event IS the busy record every later availability check reads back, so
  // recording a colour as one hour is what lets a second customer book over it.
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'office_color_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: VALID_STYLIST_ID,
    startTime: '2035-06-04T12:00:00+08:00',
    customerName: 'Test Customer',
    selectedServices: 'Оффис колор',
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const diffMinutes = (new Date(end.dateTime) - new Date(start.dateTime)) / (60 * 1000);
  assert.equal(diffMinutes, 240, 'a hairdresser booking must honour the real duration');
});
