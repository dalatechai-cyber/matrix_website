'use strict';

const crypto = require('crypto');
const { STYLIST_CONFIG } = require('./stylists');

/**
 * Two switches, both OFF unless set in Vercel (then Redeploy):
 *
 *   SITE_MAINTENANCE=on       Every page shows the maintenance notice; no
 *                             availability, no new payments.
 *   BOOKING_TEST_TOKEN=<16+>  Opening any page with ?test=<token> gives that
 *                             browser a signed test cookie: it bypasses
 *                             maintenance and its deposits cost 100₮, and its
 *                             bookings are marked «ТЕСТ». Unset = no test mode.
 *
 * Money already paid is never blocked: /api/calendar/book, check-payment and
 * QPay's late-payment callback work in maintenance too, so a customer who paid
 * just before it was switched on still gets their booking.
 */

const MAINTENANCE_MESSAGE =
  'Вэбсайт түр засвартай байна. Цаг захиалах бол Messenger-ээр бичих эсвэл 76001888, 91005498 дугаарт залгана уу.';
const MESSENGER_URL = 'https://m.me/100067872726164';
const TEST_COOKIE = 'mx_test';
const TEST_DEPOSIT_MNT = 100;

function isMaintenance() {
  return /^(on|true|1|yes)$/i.test(String(process.env.SITE_MAINTENANCE || '').trim());
}

function testToken() {
  const t = String(process.env.BOOKING_TEST_TOKEN || '').trim();
  return t.length >= 16 ? t : null; // a short token is treated as unset
}

/** Cookie value proving the browser opened the test link. */
function testCookieValue() {
  const t = testToken();
  return t ? crypto.createHmac('sha256', t).update('matrix-test-cookie-v1').digest('hex') : null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Whether `candidate` is the configured test token. */
function isTestToken(candidate) {
  const t = testToken();
  return !!(t && candidate && safeEqual(candidate, t));
}

function readCookie(req, name) {
  const header = (req && req.headers && req.headers.cookie) || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Whether this request comes from the tester's browser. */
function isTestRequest(req) {
  const expected = testCookieValue();
  const got = readCookie(req, TEST_COOKIE);
  return !!(expected && got && safeEqual(got, expected));
}

/** Whether this request is blocked by maintenance (the tester never is). */
function blockedByMaintenance(req) {
  return isMaintenance() && !isTestRequest(req);
}

/**
 * The deposit to invoice, decided here and never by the browser: the
 * stylist's tier price, or 100₮ only for the tester's signed cookie.
 * null when the stylist is unknown.
 */
function depositFor(req, stylistId) {
  const stylist = STYLIST_CONFIG[stylistId];
  if (!stylist || !(stylist.price > 0)) return null;
  return isTestRequest(req) ? TEST_DEPOSIT_MNT : stylist.price;
}

function testCookieHeader() {
  return `${TEST_COOKIE}=${testCookieValue()}; Path=/; Max-Age=${12 * 3600}; HttpOnly; Secure; SameSite=Lax`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The page every URL shows in maintenance. Self-contained: no script, no booking. */
function maintenancePage() {
  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Tara Salon</title>
<link rel="icon" href="/favicon.ico" />
<meta name="theme-color" content="#2b2622" />
<style>
  :root { --stone: #2b2622; --ink: #2b2520; --muted: #5c524a; --line: #d9cec0; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #ebe3d8; color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px 16px; }
  main { max-width: 440px; width: 100%; text-align: center; background: #fbf8f3;
    border: 1px solid var(--line); border-radius: 14px; padding: 0 0 36px; overflow: hidden; }
  /* The silver logo needs a dark ground: it sits on a basalt band. */
  .logo { background: var(--stone); padding: 26px 24px 22px; margin-bottom: 28px; }
  .logo img { width: 150px; height: auto; margin: 0 auto; display: block; }
  p { font-size: 1.05rem; line-height: 1.6; margin: 0 24px 24px; }
  .actions { display: grid; gap: 12px; margin: 0 24px; }
  a { display: flex; align-items: center; justify-content: center; min-height: 48px; border-radius: 999px;
    font-weight: 600; text-decoration: none; font-size: 1rem; }
  .primary { background: var(--stone); color: #f3ede4; }
  .secondary { border: 1.5px solid var(--stone); color: var(--stone); }
  a:focus-visible { outline: 3px solid var(--stone); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <div class="logo"><img src="/brand/tara-salon-logo-480.png" alt="Tara Salon" width="480" height="259" /></div>
  <p>${escapeHtml(MAINTENANCE_MESSAGE)}</p>
  <div class="actions">
    <a class="primary" href="${MESSENGER_URL}" rel="noopener noreferrer">Messenger</a>
    <a class="secondary" href="tel:+97676001888">7600 1888</a>
    <a class="secondary" href="tel:+97691005498">9100 5498</a>
  </div>
</main>
</body>
</html>`;
}

module.exports = {
  MAINTENANCE_MESSAGE,
  MESSENGER_URL,
  TEST_COOKIE,
  TEST_DEPOSIT_MNT,
  isMaintenance,
  isTestToken,
  isTestRequest,
  blockedByMaintenance,
  depositFor,
  testCookieHeader,
  maintenancePage,
};
