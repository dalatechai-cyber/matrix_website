'use strict';

/**
 * CANONICAL_HOST (config/canonicalHost.js): tarasalon.org as the main address.
 * Off, nothing changes. On, old-host PAGES answer 301 to the same page on the
 * canonical host, /api/* is never redirected, and every self-made link
 * (canonical, og:url, sitemap, QPay callback_url) names the canonical host —
 * except on preview and local hosts, which keep their own.
 */

const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const http = require('node:http');

process.env.QPAY_USERNAME = 'u';
process.env.QPAY_PASSWORD = 'p';
process.env.QPAY_MERCHANT_ID = 'm';
process.env.SALON_CLOSURE_START = 'none';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'a@b.c';
process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIItest\n-----END PRIVATE KEY-----\n';
delete process.env.SITE_MAINTENANCE;

const app = require('../server');
const { publicOrigin } = require('../services/lateBooking');
const { redirectTarget, canonicalHost } = require('../config/canonicalHost');

const server = http.createServer(app);
const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());

async function get(path, host, { method = 'GET', body } = {}) {
  await ready;
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https', ...(body ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

beforeEach(() => { delete process.env.CANONICAL_HOST; });

test('off: every page and link follows the request host, as before', async () => {
  const r = await get('/services.html', 'www.matrixecosalon.org');
  assert.equal(r.status, 200);
  assert.match(r.body, /<link rel="canonical" href="https:\/\/www\.matrixecosalon\.org\/services\.html"/);
  assert.doesNotMatch(r.body, /tarasalon/);
  assert.equal(publicOrigin({ headers: { host: 'www.matrixecosalon.org' } }), 'https://www.matrixecosalon.org');
});

test('on: an old-host page answers 301 to the same path and query on the canonical host', async () => {
  process.env.CANONICAL_HOST = 'www.tarasalon.org';
  for (const host of ['www.matrixecosalon.org', 'matrixecosalon.org', 'tarasalon.org']) {
    for (const path of ['/', '/booking.html?branch=parkod', '/services.html', '/zurag.html', '/robots.txt']) {
      const r = await get(path, host);
      assert.equal(r.status, 301, `${host}${path}`);
      assert.equal(r.headers.location, `https://www.tarasalon.org${path}`, `${host}${path}`);
      assert.equal(r.headers['cache-control'], 'public, max-age=3600', `${host}${path}`);
    }
  }
});

test('on: the test link on the old host is carried, not consumed, so the cookie lands on the new host', async () => {
  process.env.CANONICAL_HOST = 'www.tarasalon.org';
  const r = await get('/?test=abc', 'www.matrixecosalon.org');
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, 'https://www.tarasalon.org/?test=abc');
  assert.equal(r.headers['set-cookie'], undefined);
});

test('on: /api/* on the old host is answered there, never redirected (any method)', async () => {
  process.env.CANONICAL_HOST = 'www.tarasalon.org';
  const a = await get('/api/site-mode', 'www.matrixecosalon.org');
  assert.equal(a.status, 200);
  const b = await get('/api/branches', 'matrixecosalon.org');
  assert.equal(b.status, 200);
  const c = await get('/api/qpay/late-payment?b=x&h=y', 'www.matrixecosalon.org', { method: 'POST', body: {} });
  assert.notEqual(c.status, 301);
  assert.notEqual(c.status, 308);
  assert.equal(redirectTarget({ method: 'POST', path: '/booking.html', originalUrl: '/booking.html', headers: { host: 'matrixecosalon.org' } }), null);
});

test('on: the canonical host serves pages whose links name it', async () => {
  process.env.CANONICAL_HOST = 'www.tarasalon.org';
  const r = await get('/booking.html', 'www.tarasalon.org');
  assert.equal(r.status, 200);
  assert.match(r.body, /<link rel="canonical" href="https:\/\/www\.tarasalon\.org\/booking\.html"/);
  assert.doesNotMatch(r.body, /matrixecosalon/);
  const s = await get('/sitemap.xml', 'www.tarasalon.org');
  assert.equal(s.status, 200);
  assert.match(s.body, /<loc>https:\/\/www\.tarasalon\.org\/<\/loc>/);
  assert.match(s.body, /<loc>https:\/\/www\.tarasalon\.org\/booking\.html<\/loc>/);
  assert.doesNotMatch(s.body, /matrixecosalon/);
  const t = await get('/robots.txt', 'www.tarasalon.org');
  assert.equal(t.status, 200);
  assert.match(t.body, /Sitemap: https:\/\/www\.tarasalon\.org\/sitemap\.xml/);
});

test('on: QPay callbacks of new invoices name the canonical host, even from an old-host request', () => {
  process.env.CANONICAL_HOST = 'www.tarasalon.org';
  assert.equal(publicOrigin({ headers: { host: 'www.matrixecosalon.org' } }), 'https://www.tarasalon.org');
  assert.equal(publicOrigin({ headers: { 'x-forwarded-host': 'tarasalon.org' } }), 'https://www.tarasalon.org');
});

test('on: preview and local hosts are never redirected and keep their own links and callbacks', async () => {
  process.env.CANONICAL_HOST = 'www.tarasalon.org';
  const host = 'matrix-website-git-x-team.vercel.app';
  const r = await get('/services.html', host);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`href="https://${host.replace(/\./g, '\\.')}/services\\.html"`));
  assert.equal(publicOrigin({ headers: { host } }), `https://${host}`);
  assert.equal(redirectTarget({ method: 'GET', path: '/', originalUrl: '/', headers: { host: 'localhost:3000' } }), null);
});

test('a malformed CANONICAL_HOST is ignored: links follow the request host', async () => {
  for (const bad of ['https://www.tarasalon.org', 'www.tarasalon.org/', 'tarasalon', 'www tarasalon.org']) {
    process.env.CANONICAL_HOST = bad;
    assert.equal(canonicalHost(), null, bad);
    const r = await get('/', 'www.matrixecosalon.org');
    assert.equal(r.status, 200, bad);
  }
  process.env.CANONICAL_HOST = '  WWW.TaraSalon.org ';
  assert.equal(canonicalHost(), 'www.tarasalon.org');
});
