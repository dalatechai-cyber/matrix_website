'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
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

// Load route and service utilities after stubs are in place
const calendarRouter = require('../routes/calendar');
const { normalisePrivateKey } = require('../services/googleCalendar');
const { STYLIST_CONFIG, MUNKHZAYA_CALENDAR_ID, OTGONZARGAL_CALENDAR_ID } = require('../config/stylists');

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

// Manicurist stylist IDs and her dedicated calendar ID (MUNKHZAYA_CALENDAR_ID imported above)
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
// Manicurist (Г. Мөнхзаяа) calendar routing
// ---------------------------------------------------------------------------
test('STYLIST_CONFIG: Г. Мөнхзаяа uses her dedicated calendar ID', () => {
  assert.equal(
    STYLIST_CONFIG[MUNKHZAYA_STYLIST_ID_MN].calendarId,
    MUNKHZAYA_CALENDAR_ID,
    'Mongolian key should map to the manicurist calendar',
  );
});

test('STYLIST_CONFIG: g.munkhzaya (Latin alias) uses the same dedicated calendar ID', () => {
  assert.equal(
    STYLIST_CONFIG[MUNKHZAYA_STYLIST_ID_LATIN].calendarId,
    MUNKHZAYA_CALENDAR_ID,
    'Latin alias should map to the manicurist calendar',
  );
});

test('book: 200 booking for Г. Мөнхзаяа routes to her calendar', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'munkhzaya_booking_001' } };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
    startTime: '2035-06-05T10:00:00+08:00',
    customerName: 'Test Customer',
    serviceName: 'Маникюр',
  });
  assert.equal(status, 200);
  assert.equal(body.eventId, 'munkhzaya_booking_001');
  assert.ok(body.message.includes('success'));
});

test('available-slots: 200 for Г. Мөнхзаяа routes to her calendar', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [MUNKHZAYA_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
  });
  assert.equal(status, 200);
  assert.equal(body.stylistId, MUNKHZAYA_STYLIST_ID_LATIN);
  // VALID_DATE is Monday → 30-min manicure slots: 10:00–19:30 → 20 slots
  assert.equal(body.availableSlots.length, 20);
  assert.ok(body.availableSlots.includes('10:00'));
  assert.ok(body.availableSlots.includes('10:30'));
  assert.ok(body.availableSlots.includes('19:30'));
  assert.ok(!body.availableSlots.includes('20:00'), '20:00 is past the last manicure slot');
});

test('available-slots: 200 Sunday hours for Г. Мөнхзаяа uses Sunday-specific slots', async () => {
  calendarStub._freebusyError = null;
  calendarStub._freebusyResult = {
    data: { calendars: { [MUNKHZAYA_CALENDAR_ID]: { busy: [] } } },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE_SUNDAY,
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
  });
  assert.equal(status, 200);
  // VALID_DATE_SUNDAY is Sunday → 30-min manicure slots: 11:00–18:30 → 16 slots
  assert.equal(body.availableSlots.length, 16);
  assert.ok(!body.availableSlots.includes('10:00'), '10:00 is not a Sunday manicure slot');
  assert.ok(body.availableSlots.includes('11:00'));
  assert.ok(body.availableSlots.includes('11:30'));
  assert.ok(body.availableSlots.includes('14:00'));
  assert.ok(body.availableSlots.includes('18:00'));
  assert.ok(body.availableSlots.includes('18:30'));
  assert.ok(!body.availableSlots.includes('19:00'), '19:00 is past the last Sunday manicure slot');
});

// ---------------------------------------------------------------------------
// Manicurist (Г. Мөнхзаяа) dynamic appointment duration via totalDuration
// ---------------------------------------------------------------------------
test('STYLIST_CONFIG: Г. Мөнхзаяа has durationMinutes of 30 (minimum slot interval)', () => {
  assert.equal(
    STYLIST_CONFIG[MUNKHZAYA_STYLIST_ID_MN].durationMinutes,
    30,
    'Mongolian key should have 30-minute slot duration',
  );
  assert.equal(
    STYLIST_CONFIG[MUNKHZAYA_STYLIST_ID_LATIN].durationMinutes,
    30,
    'Latin alias should also have 30-minute slot duration',
  );
});

test('book: Г. Мөнхзаяа booking with totalDuration=90 creates a 90-minute event', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'munkhzaya_duration_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
    startTime: '2035-06-05T13:00:00+08:00',
    customerName: 'Test Customer',
    serviceName: 'Маникюр',
    totalDuration: 90,
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const startMs = new Date(start.dateTime).getTime();
  const endMs = new Date(end.dateTime).getTime();
  const diffMinutes = (endMs - startMs) / (60 * 1000);
  assert.equal(diffMinutes, 90, 'totalDuration=90 should create a 90-minute event');
});

test('book: Г. Мөнхзаяа booking with totalDuration=180 creates a 180-minute event', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'munkhzaya_long_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
    startTime: '2035-06-05T10:00:00+08:00',
    customerName: 'Test Customer',
    totalDuration: 180,
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const diffMinutes = (new Date(end.dateTime) - new Date(start.dateTime)) / (60 * 1000);
  assert.equal(diffMinutes, 180, 'totalDuration=180 should create a 180-minute event');
});

test('book: Г. Мөнхзаяа booking without totalDuration falls back to 60 minutes', async () => {
  calendarStub._insertError = null;
  calendarStub._insertResult = { data: { id: 'munkhzaya_fallback_test' } };
  calendarStub._lastInsertArg = null;
  const app = buildApp();
  const { status } = await request(app, 'POST', '/api/calendar/book', {
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
    startTime: '2035-06-05T13:00:00+08:00',
    customerName: 'Test Customer',
  });
  assert.equal(status, 200);
  const { start, end } = calendarStub._lastInsertArg.requestBody;
  const diffMinutes = (new Date(end.dateTime) - new Date(start.dateTime)) / (60 * 1000);
  assert.equal(diffMinutes, 60, 'Munkhzaya booking without totalDuration should fall back to 60 minutes');
});

test('book: regular hairdresser booking ignores totalDuration and uses fixed 60 minutes', async () => {
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

test('available-slots: busy booking at 13:00–14:30 blocks the overlapping 30-min manicure slots', async () => {
  calendarStub._freebusyError = null;
  // Simulate a 90-minute busy block: 13:00–14:30 Ulaanbaatar (UTC+8) = 05:00–06:30 UTC
  calendarStub._freebusyResult = {
    data: {
      calendars: {
        [MUNKHZAYA_CALENDAR_ID]: {
          busy: [
            { start: `${VALID_DATE}T05:00:00Z`, end: `${VALID_DATE}T06:30:00Z` },
          ],
        },
      },
    },
  };
  const app = buildApp();
  const { status, body } = await request(app, 'GET', '/api/calendar/available-slots', {
    date: VALID_DATE,
    stylistId: MUNKHZAYA_STYLIST_ID_LATIN,
  });
  assert.equal(status, 200);
  // 13:00 slot is busy (directly booked)
  assert.ok(!body.availableSlots.includes('13:00'), '13:00 should be busy (booked)');
  // 13:30 and 14:00 overlap with the busy period 13:00–14:30
  assert.ok(!body.availableSlots.includes('13:30'), '13:30 should be busy (overlaps with 13:00–14:30)');
  assert.ok(!body.availableSlots.includes('14:00'), '14:00 should be busy (overlaps with 13:00–14:30)');
  // 12:30 ends at 13:00 — no strict overlap (slotEnd > busyStart requires 13:00 > 13:00 which is false)
  assert.ok(body.availableSlots.includes('12:30'), '12:30 should be free (ends exactly at busy start)');
  // 14:30 starts at 14:30 — no strict overlap (slotStart < busyEnd requires 14:30 < 14:30 which is false)
  assert.ok(body.availableSlots.includes('14:30'), '14:30 should be free (starts exactly at busy end)');
  // 12:00 is also free (ends at 12:30, no overlap)
  assert.ok(body.availableSlots.includes('12:00'), '12:00 should be free (ends at 12:30, no overlap)');
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
