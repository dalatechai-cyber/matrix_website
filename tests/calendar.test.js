'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const express = require('express');

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
        },
        calendar: () => ({
          freebusy: {
            query: async () => {
              if (calendarStub._freebusyError) throw calendarStub._freebusyError;
              return calendarStub._freebusyResult;
            },
          },
          events: {
            insert: async () => {
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

// Load route after stubs are in place
const calendarRouter = require('../routes/calendar');

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
const VALID_DATE = '2026-03-10';        // Monday  → Mon–Sat hours: 10:00–20:00
const VALID_DATE_SUNDAY = '2026-03-09'; // Sunday  → Sun hours:     11:00–19:00

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
