'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const express = require('express');

// Set required environment variables before loading any calendar modules.
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';

// Stub googleapis so tests don't need real credentials
const googleStub = {
  _insertResult: null,
  _insertError: null,
};

// Patch require to intercept 'googleapis' before loading the route
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'googleapis') {
    return {
      google: {
        auth: {
          JWT: class {
            constructor() {}
            async authorize() { return {}; }
          },
        },
        calendar: () => ({
          events: {
            insert: async () => {
              if (googleStub._insertError) throw googleStub._insertError;
              return googleStub._insertResult;
            },
          },
        }),
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Now load the route (it will use our stubs)
const webhookRouter = require('../routes/webhooks');

// Helper: build a lightweight Express app
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhookRouter);
  return app;
}

// Helper: make a request and collect the full response
function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : null;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
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

const validPayload = {
  paymentStatus: 'PAID',
  customerName: 'Test Customer',
  customerEmail: 'test@example.com',
  customerPhone: '+97699112233',
  stylistId: 'Ананд',
  appointmentStartTime: '2026-03-01T10:00:00+08:00',
  appointmentEndTime: '2026-03-01T11:00:00+08:00',
  serviceName: 'Haircut',
};

test('400 when required fields are missing', async () => {
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/webhooks/payment-success', { paymentStatus: 'PAID' });
  assert.equal(status, 400);
  assert.ok(body.missingFields && body.missingFields.length > 0);
});

test('400 when paymentStatus is not PAID', async () => {
  const app = buildApp();
  const payload = { ...validPayload, paymentStatus: 'PENDING' };
  const { status, body } = await request(app, 'POST', '/api/webhooks/payment-success', payload);
  assert.equal(status, 400);
  assert.ok(body.error.includes('PAID'));
});

test('400 when stylistId is unknown', async () => {
  const app = buildApp();
  const payload = { ...validPayload, stylistId: 'stylist_unknown' };
  const { status, body } = await request(app, 'POST', '/api/webhooks/payment-success', payload);
  assert.equal(status, 400);
  assert.ok(body.error.includes('stylistId'));
});

test('200 when calendar event is created successfully', async () => {
  googleStub._insertError = null;
  googleStub._insertResult = { data: { id: 'event_abc123' } };
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/webhooks/payment-success', validPayload);
  assert.equal(status, 200);
  assert.equal(body.eventId, 'event_abc123');
});

test('500 when Google Calendar API fails', async () => {
  googleStub._insertError = new Error('Google API error');
  googleStub._insertResult = null;
  const app = buildApp();
  const { status, body } = await request(app, 'POST', '/api/webhooks/payment-success', validPayload);
  assert.equal(status, 500);
  assert.ok(body.error.includes('calendar event'));
  googleStub._insertError = null;
});
