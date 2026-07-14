'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const express = require('express');

// ---------------------------------------------------------------------------
// Stub axios before loading any QPay modules so no real invoice is ever created.
// ---------------------------------------------------------------------------
const axiosStub = { _calls: [], reset() { this._calls = []; } };

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'axios') {
    return {
      post: async (url, body, opts) => {
        axiosStub._calls.push({ url, body, opts });
        if (String(url).includes('/auth/token')) return { data: { access_token: 'tok_test' } };
        return { data: { invoice_id: 'inv_test', qr_image: 'BASE64', urls: [] } };
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

process.env.QPAY_USERNAME = 'test_user';
process.env.QPAY_PASSWORD = 'test_pass';
process.env.BASE_URL = 'https://test.example.com';
process.env.QPAY_MERCHANT_ID = 'TEST_MERCHANT_ID';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';

const { findClosure, hasPendingClosure, salonDateOf, addDays, getClosures } = require('../config/closures');
const { checkPaymentRequest, bookingDateFromRequest } = require('../services/closureGuard');
const calendarRouter = require('../routes/calendar');
const qpayRouter = require('../routes/qpay');
const webhooksRouter = require('../routes/webhooks');
// The handler vercel.json actually serves for POST /api/qpay/create-payment.
const createPaymentHandler = require('../api/qpay/create-payment');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const CLOSURE_ENV_KEYS = [
  'SALON_CLOSURE_START',
  'SALON_CLOSURE_END',
  'SALON_CLOSURE_TITLE',
  'SALON_CLOSURE_MESSAGE',
];

/** Run fn with the closure env vars set to `vars`, restoring them afterwards. */
function withEnv(vars, fn) {
  const saved = {};
  CLOSURE_ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.entries(vars).forEach(([k, v]) => { process.env[k] = v; });
  const restore = () => {
    CLOSURE_ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  };
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (v) => { restore(); return v; },
      (err) => { restore(); throw err; },
    );
  }
  restore();
  return result;
}

/** Closures far enough out that these tests never depend on the current date. */
const FUTURE = { SALON_CLOSURE_START: '2099-01-01', SALON_CLOSURE_END: '2099-01-05' };
const PAST = { SALON_CLOSURE_START: '2000-01-01', SALON_CLOSURE_END: '2000-01-05' };
const OFF = { SALON_CLOSURE_START: 'none' };

function buildApp(mountPath, router) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data ? Buffer.byteLength(data) : 0,
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          });
        },
      );
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// config/closures.js — the shipped default (the Naadam holiday)
// ---------------------------------------------------------------------------
test('default closure: covers the Naadam week and reopens 18 July 2026', () => {
  withEnv({}, () => {
    assert.ok(findClosure('2026-07-11'), 'first closed day is closed');
    assert.ok(findClosure('2026-07-14'), 'mid-closure day is closed');
    assert.ok(findClosure('2026-07-17'), 'last closed day is closed');
    assert.equal(findClosure('2026-07-15').reopenDate, '2026-07-18');
  });
});

test('default closure: the day before and the reopening day are open', () => {
  withEnv({}, () => {
    assert.equal(findClosure('2026-07-10'), null);
    assert.equal(findClosure('2026-07-18'), null, '18 July is when booking resumes');
    assert.equal(findClosure('2026-07-19'), null);
  });
});

test('findClosure: ignores malformed dates rather than throwing', () => {
  withEnv({}, () => {
    assert.equal(findClosure('15-07-2026'), null);
    assert.equal(findClosure(''), null);
    assert.equal(findClosure(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// config/closures.js — configuring a closure without a code change
// ---------------------------------------------------------------------------
test('env closure: SALON_CLOSURE_START/END replace the shipped default', () => {
  withEnv(FUTURE, () => {
    assert.ok(findClosure('2099-01-03'), 'the env closure applies');
    assert.equal(findClosure('2026-07-15'), null, 'the shipped default no longer applies');
  });
});

test('env closure: boundaries are inclusive and reopenDate is the day after end', () => {
  withEnv(FUTURE, () => {
    assert.ok(findClosure('2099-01-01'));
    assert.ok(findClosure('2099-01-05'));
    assert.equal(findClosure('2099-01-06'), null);
    assert.equal(findClosure('2099-01-01').reopenDate, '2099-01-06');
  });
});

test('env closure: title and message are configurable', () => {
  withEnv({ ...FUTURE, SALON_CLOSURE_TITLE: 'Цагаан сар', SALON_CLOSURE_MESSAGE: 'Салон амарна.' }, () => {
    const c = findClosure('2099-01-02');
    assert.equal(c.title, 'Цагаан сар');
    assert.equal(c.message, 'Салон амарна.');
  });
});

test('env closure: SALON_CLOSURE_START=none disables closures entirely', () => {
  withEnv(OFF, () => {
    assert.deepEqual(getClosures(), []);
    assert.equal(findClosure('2026-07-15'), null);
    assert.equal(hasPendingClosure(), false);
  });
});

test('env closure: a malformed range is ignored and the default still applies', () => {
  withEnv({ SALON_CLOSURE_START: '2099-01-09', SALON_CLOSURE_END: '2099-01-01' }, () => {
    assert.equal(findClosure('2099-01-03'), null, 'the reversed range is not honoured');
    assert.ok(findClosure('2026-07-15'), 'falls back to the shipped default');
  });
  withEnv({ SALON_CLOSURE_START: '09/01/2099', SALON_CLOSURE_END: '11/01/2099' }, () => {
    assert.ok(findClosure('2026-07-15'), 'a bad date format falls back to the default');
  });
});

test('hasPendingClosure: true for a future closure, false once it has passed', () => {
  withEnv(FUTURE, () => assert.equal(hasPendingClosure(), true));
  withEnv(PAST, () => assert.equal(hasPendingClosure(), false));
});

// ---------------------------------------------------------------------------
// config/closures.js — date helpers
// ---------------------------------------------------------------------------
test('addDays: rolls over month and year boundaries', () => {
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap year');
});

test('salonDateOf: resolves an instant to the salon-local (UTC+8) date', () => {
  assert.equal(salonDateOf('2026-07-15T10:00:00+08:00'), '2026-07-15');
  // 17:00 UTC is already the next day in Ulaanbaatar.
  assert.equal(salonDateOf('2026-07-15T17:00:00Z'), '2026-07-16');
  // 15:59 UTC is still the same day there.
  assert.equal(salonDateOf('2026-07-15T15:59:00Z'), '2026-07-15');
  assert.equal(salonDateOf('not-a-date'), null);
});

// ---------------------------------------------------------------------------
// services/closureGuard.js — the payment gate
// ---------------------------------------------------------------------------
test('guard: refuses an explicit bookingDate inside a closure', () => {
  withEnv(FUTURE, () => {
    const r = checkPaymentRequest({ bookingDate: '2099-01-03' });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'salon-closed');
    assert.equal(r.closure.reopenDate, '2099-01-06');
  });
});

test('guard: allows a bookingDate outside the closure', () => {
  withEnv(FUTURE, () => {
    assert.equal(checkPaymentRequest({ bookingDate: '2099-01-06' }).allowed, true);
  });
});

test('guard: reads the date out of the description (older cached script.js)', () => {
  withEnv(FUTURE, () => {
    const body = { description: 'Matrix Eco: Уянга - 2099-01-03 14:00 - Тест - 99000000' };
    assert.equal(bookingDateFromRequest(body), '2099-01-03');
    const r = checkPaymentRequest(body);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'salon-closed');
  });
});

test('guard: allows a description-carried date outside the closure', () => {
  withEnv(FUTURE, () => {
    const body = { description: 'Matrix Eco: Уянга - 2099-02-01 14:00 - Тест - 99000000' };
    assert.equal(checkPaymentRequest(body).allowed, true);
  });
});

test('guard: an explicit bookingDate wins over the description', () => {
  withEnv(FUTURE, () => {
    const body = {
      bookingDate: '2099-01-03',
      description: 'Matrix Eco: Уянга - 2099-02-01 14:00 - Тест - 99000000',
    };
    assert.equal(checkPaymentRequest(body).allowed, false);
  });
});

test('guard: refuses when the two dates disagree and either one is closed', () => {
  withEnv(FUTURE, () => {
    // The description is what gets stored and later parsed into the calendar
    // event, so an open bookingDate must not smuggle a closed one past.
    const smuggled = {
      bookingDate: '2099-02-01',
      description: 'Matrix Eco: Уянга - 2099-01-03 14:00 - Тест - 99000000',
    };
    const r = checkPaymentRequest(smuggled);
    assert.equal(r.allowed, false);
    assert.equal(r.date, '2099-01-03', 'reports the closed date, not the open one');

    // Both open still passes.
    assert.equal(
      checkPaymentRequest({
        bookingDate: '2099-02-01',
        description: 'Matrix Eco: Уянга - 2099-02-02 14:00 - Тест - 99000000',
      }).allowed,
      true,
    );
  });
});

test('guard: refuses an unreadable date while a closure is pending', () => {
  withEnv(FUTURE, () => {
    const r = checkPaymentRequest({ description: 'нэр - утас' });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'indeterminate-date');
  });
});

test('guard: allows an unreadable date when no closure is configured', () => {
  withEnv(OFF, () => {
    const r = checkPaymentRequest({ description: 'нэр - утас' });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, 'no-closure-configured');
  });
  withEnv(PAST, () => {
    assert.equal(checkPaymentRequest({}).allowed, true, 'a closure that has passed protects nothing');
  });
});

// ---------------------------------------------------------------------------
// routes/calendar.js
// ---------------------------------------------------------------------------
test('GET /api/calendar/closures: reports the closures in force', async () => {
  const app = buildApp('/api/calendar', calendarRouter);
  await withEnv(FUTURE, async () => {
    const { status, body } = await request(app, 'GET', '/api/calendar/closures');
    assert.equal(status, 200);
    assert.equal(body.closures.length, 1);
    assert.equal(body.closures[0].start, '2099-01-01');
    assert.equal(body.closures[0].reopenDate, '2099-01-06');
  });
});

test('available-slots: a closed date offers no times and explains why', async () => {
  const app = buildApp('/api/calendar', calendarRouter);
  await withEnv(FUTURE, async () => {
    const { status, body } = await request(
      app,
      'GET',
      '/api/calendar/available-slots?date=2099-01-03&stylistId=' + encodeURIComponent('Ананд'),
    );
    // 200, not an error: the booking UI falls back to full business hours when
    // this endpoint fails, which would put the closed day back on offer.
    assert.equal(status, 200);
    assert.deepEqual(body.availableSlots, []);
    assert.equal(body.closure.reopenDate, '2099-01-06');
  });
});

test('available-slots: closes the day for every stylist, not just blocked calendars', async () => {
  const app = buildApp('/api/calendar', calendarRouter);
  await withEnv(FUTURE, async () => {
    for (const stylist of ['Ананд', 'Бадамцэцэг', 'Уянга', 'Отгонжаргал', 'Г. Мөнхзаяа']) {
      const { status, body } = await request(
        app,
        'GET',
        '/api/calendar/available-slots?date=2099-01-03&stylistId=' + encodeURIComponent(stylist),
      );
      assert.equal(status, 200, stylist);
      assert.deepEqual(body.availableSlots, [], `${stylist} must offer nothing on a closed day`);
    }
  });
});

test('POST /api/calendar/book: refuses to put an appointment on a closed day', async () => {
  const app = buildApp('/api/calendar', calendarRouter);
  await withEnv(FUTURE, async () => {
    const { status, body } = await request(app, 'POST', '/api/calendar/book', {
      stylistId: 'Ананд',
      startTime: '2099-01-03T10:00:00+08:00',
      customerName: 'Тест',
      customerPhone: '99000000',
    });
    assert.equal(status, 409);
    assert.equal(body.closure.reopenDate, '2099-01-06');
  });
});

// ---------------------------------------------------------------------------
// routes/qpay.js — no invoice for a closed day
// ---------------------------------------------------------------------------
test('create-payment: refuses to invoice for a closed day, and calls QPay not at all', async () => {
  const app = buildApp('/api/qpay', qpayRouter);
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', {
      name: 'Тест',
      phone: '99000000',
      amount: '20000',
      description: 'Matrix Eco: Ананд - 2099-01-03 10:00 - Тест - 99000000',
      staffName: 'Ананд',
    });
    assert.equal(status, 409);
    assert.equal(body.reason, 'salon-closed');
    assert.equal(axiosStub._calls.length, 0, 'no QPay invoice may be created');
  });
});

test('create-payment: an open date still creates an invoice as before', async () => {
  const app = buildApp('/api/qpay', qpayRouter);
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', {
      name: 'Тест',
      phone: '99000000',
      amount: '20000',
      description: 'Matrix Eco: Ананд - 2099-02-01 10:00 - Тест - 99000000',
      staffName: 'Ананд',
    });
    assert.equal(status, 200);
    assert.equal(body.invoice_id, 'inv_test');
    assert.ok(axiosStub._calls.length > 0, 'QPay is still called for an open date');
  });
});

test('create-payment: a missing description still reports the missing field', async () => {
  const app = buildApp('/api/qpay', qpayRouter);
  await withEnv(FUTURE, async () => {
    const { status, body } = await request(app, 'POST', '/api/qpay/create-payment', {
      name: 'Тест',
      phone: '99000000',
      amount: '20000',
    });
    assert.equal(status, 400, 'field validation runs before the closure gate');
    assert.match(body.error, /required/);
  });
});

// ---------------------------------------------------------------------------
// api/qpay/create-payment.js — the handler production actually serves
//
// vercel.json rewrites POST /api/qpay/create-payment to this standalone
// function, NOT to routes/qpay.js. Gating only the Express route would leave
// every real customer ungated, so the production handler is tested directly.
// ---------------------------------------------------------------------------
function invoke(handler, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ method: 'POST', body }, res);
  });
}

test('production create-payment: refuses a closed date and never calls QPay', async () => {
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    const { status, body } = await invoke(createPaymentHandler, {
      amount: '20000',
      name: 'Тест',
      phone: '99000000',
      staffName: 'Ананд',
      bookingDate: '2099-01-03',
      description: 'Matrix Eco: Ананд - 2099-01-03 10:00 - Тест - 99000000',
    });
    assert.equal(status, 409);
    assert.equal(body.reason, 'salon-closed');
    assert.equal(axiosStub._calls.length, 0, 'no QPay token or invoice call may be made');
  });
});

test('production create-payment: refuses a closed date sent by older cached script.js', async () => {
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    // No bookingDate — the date is only inside the description, as older
    // browser-cached builds of script.js send it.
    const { status, body } = await invoke(createPaymentHandler, {
      amount: '20000',
      name: 'Тест',
      phone: '99000000',
      staffName: 'Ананд',
      description: 'Matrix Eco: Ананд - 2099-01-03 10:00 - Тест - 99000000',
    });
    assert.equal(status, 409);
    assert.equal(body.reason, 'salon-closed');
    assert.equal(axiosStub._calls.length, 0);
  });
});

test('production create-payment: refuses a request with no readable date while closed', async () => {
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    const { status, body } = await invoke(createPaymentHandler, {
      amount: '20000', name: 'Тест', phone: '99000000', staffName: 'Ананд',
      description: 'Тест - 99000000',
    });
    assert.equal(status, 409);
    assert.equal(body.reason, 'indeterminate-date');
    assert.equal(axiosStub._calls.length, 0);
  });
});

test('production create-payment: an open date still reaches QPay', async () => {
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    const { status } = await invoke(createPaymentHandler, {
      amount: '20000',
      name: 'Тест',
      phone: '99000000',
      staffName: 'Ананд',
      bookingDate: '2099-02-01',
      description: 'Matrix Eco: Ананд - 2099-02-01 10:00 - Тест - 99000000',
    });
    assert.equal(status, 200);
    assert.ok(axiosStub._calls.length > 0, 'QPay is still called for an open date');
  });
});

test('production create-payment: with no closure configured, nothing is blocked', async () => {
  await withEnv(OFF, async () => {
    axiosStub.reset();
    const { status } = await invoke(createPaymentHandler, {
      amount: '20000', name: 'Тест', phone: '99000000', staffName: 'Ананд',
      bookingDate: '2026-07-15',
      description: 'Matrix Eco: Ананд - 2026-07-15 10:00 - Тест - 99000000',
    });
    assert.equal(status, 200, 'the Naadam default must not apply once disabled');
  });
});

// ---------------------------------------------------------------------------
// routes/webhooks.js — no calendar event on a closed day
// ---------------------------------------------------------------------------
test('payment-success webhook: refuses to book an appointment on a closed day', async () => {
  const app = buildApp('/api/webhooks', webhooksRouter);
  await withEnv(FUTURE, async () => {
    const { status, body } = await request(app, 'POST', '/api/webhooks/payment-success', {
      paymentStatus: 'PAID',
      customerName: 'Тест',
      customerEmail: 'test@example.com',
      customerPhone: '99000000',
      stylistId: 'Ананд',
      appointmentStartTime: '2099-01-03T10:00:00+08:00',
      appointmentEndTime: '2099-01-03T11:00:00+08:00',
      serviceName: 'Энгийн засалт',
    });
    assert.equal(status, 409);
    assert.equal(body.closure.reopenDate, '2099-01-06');
  });
});

test('create-payment: routes the deposit to the right account on an open date', async () => {
  const app = buildApp('/api/qpay', qpayRouter);
  await withEnv(FUTURE, async () => {
    axiosStub.reset();
    await request(app, 'POST', '/api/qpay/create-payment', {
      name: 'Тест',
      phone: '99000000',
      amount: '20000',
      description: 'Matrix Eco: Г. Мөнхзаяа - 2099-02-01 10:00 - Тест - 99000000',
      staffName: 'Г. Мөнхзаяа',
    });
    const invoiceCall = axiosStub._calls.find((c) => String(c.url).includes('/invoice'));
    assert.equal(invoiceCall.body.bank_accounts[0].account_number, '5042384162');
  });
});
