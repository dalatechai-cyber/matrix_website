'use strict';

const crypto = require('crypto');
const { STYLIST_CONFIG, personOf, asciiOf } = require('../config/stylists');
const catalogue = require('../data/serviceDurations.json');
const { normalizeServiceName, parseServices, totalDurationFor } = require('../config/serviceDurations');
const { normalizeCustomerGender } = require('./bookingRules');

/**
 * The booking a QPay invoice is for, carried on the invoice's own callback URL.
 *
 * QPay calls that URL when the customer pays — even if they paid long after
 * the QR appeared, or closed the page. The site has no database, so the
 * callback URL itself is where the booking lives: a short, HMAC-signed token
 * written when the invoice is created. Only this server can mint one, so a
 * callback can be trusted to describe the booking the customer asked for.
 * Payment is still confirmed with QPay before anything is booked.
 *
 * Token: v1.<stylist>.<YYYYMMDD>.<HHMM>.<f|m|x>.<phone>.<services>.<minutes>.<agreedAt>.<amount>.<r|t>
 * (the last field: t = a test booking made through the BOOKING_TEST_TOKEN link)
 * — ASCII only, so the URL stays short (QPay stores it with the invoice).
 */

const VERSION = 'v1';
const SERVICE_NAMES = (catalogue.services || []).map((e) => e && e.name).filter(Boolean);
const SERVICE_INDEX = new Map();
(catalogue.services || []).forEach((entry, i) => {
  if (!entry || !entry.name) return;
  SERVICE_INDEX.set(normalizeServiceName(entry.name), i);
  for (const alias of entry.aliases || []) SERVICE_INDEX.set(normalizeServiceName(alias), i);
});

function signingKey() {
  const base = process.env.BOOKING_CALLBACK_SECRET || process.env.QPAY_PASSWORD;
  if (!base) return null;
  return crypto.createHash('sha256').update('matrix-late-booking:' + base).digest();
}

function sign(token, key) {
  return crypto.createHmac('sha256', key).update(token).digest('hex').slice(0, 32);
}

/** ASCII id of a stylist (config/stylists.js keeps one per hairdresser). */
function asciiIdFor(stylistId) {
  return asciiOf(stylistId);
}

/**
 * The display name for an ASCII id — including a former name's ASCII form
 * («oyunsuren»), so a callback signed before the rename reaches the same person.
 */
function displayIdFor(asciiId) {
  return STYLIST_CONFIG[asciiId] ? personOf(asciiId) : null;
}

/**
 * Build the signed callback URL for an invoice, or null when it cannot be
 * built (no signing key, unknown stylist, unreadable date) — the invoice is
 * then created exactly as before, with no callback.
 *
 * @param {string} baseUrl  e.g. https://www.matrixecosalon.org
 * @param {{ stylistId, date, time, customerGender, customerPhone, services, agreedAt, amount, test }} b
 */
function callbackUrlFor(baseUrl, b) {
  const key = signingKey();
  const ascii = asciiIdFor(b.stylistId);
  if (!key || !ascii || !baseUrl) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !/^\d{2}:\d{2}$/.test(b.time || '')) return null;

  const names = parseServices(b.services);
  let mask = 0n;
  for (const n of names) {
    const i = SERVICE_INDEX.get(normalizeServiceName(n));
    if (i != null) mask |= 1n << BigInt(i);
  }
  const resolved = totalDurationFor(names);
  const minutes = resolved.resolved ? resolved.minutes : 60;
  const g = { female: 'f', male: 'm' }[normalizeCustomerGender(b.customerGender)] || 'x';
  const phone = String(b.customerPhone || '').replace(/\D/g, '').slice(0, 15);
  const agreed = b.agreedAt instanceof Date && !Number.isNaN(b.agreedAt.getTime())
    ? Math.floor(b.agreedAt.getTime() / 1000) : 0;
  const amount = Math.max(0, Math.floor(Number(b.amount) || 0));

  const token = [VERSION, ascii, b.date.replace(/-/g, ''), b.time.replace(':', ''), g, phone,
    mask.toString(16), minutes, agreed, amount, b.test ? 't' : 'r'].join('.');
  return `${baseUrl.replace(/\/+$/, '')}/api/qpay/late-payment?b=${token}&h=${sign(token, key)}`;
}

/**
 * Verify and decode a callback's token. Returns null for anything not minted
 * by this server.
 */
function decodeCallback(b, h) {
  const key = signingKey();
  if (!key || typeof b !== 'string' || typeof h !== 'string' || b.length > 200) return null;
  const expected = Buffer.from(sign(b, key));
  const given = Buffer.from(h);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  const p = b.split('.');
  if (p.length !== 11 || p[0] !== VERSION) return null;
  const [, ascii, ymd, hm, g, phone, maskHex, minutes, agreed, amount, kind] = p;
  const stylistId = displayIdFor(ascii);
  if (!stylistId || !/^\d{8}$/.test(ymd) || !/^\d{4}$/.test(hm)) return null;

  let mask = 0n;
  try { mask = BigInt('0x' + (maskHex || '0')); } catch (_) { return null; }
  const services = SERVICE_NAMES.filter((_, i) => (mask >> BigInt(i)) & 1n);
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`;
  const time = `${hm.slice(0, 2)}:${hm.slice(2)}`;
  return {
    stylistId,
    date,
    time,
    start: new Date(`${date}T${time}:00+08:00`),
    customerGender: { f: 'female', m: 'male' }[g] || null,
    customerPhone: phone,
    services,
    durationMinutes: Math.max(15, Math.min(12 * 60, Number(minutes) || 60)),
    depositTermsAcceptedAt: Number(agreed) > 0 ? new Date(Number(agreed) * 1000) : null,
    amount: Number(amount) || null,
    test: kind === 't',
  };
}

/**
 * The booking description the site sends with every payment (assets/booking.js):
 *   "Matrix Eco: {stylistId} - {date} {time} - {name} - {phone}"
 */
function parseBookingDescription(description) {
  const m = /^Matrix Eco:\s*(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+-\s+(.+?)\s+-\s+(.+)$/.exec(description || '');
  if (!m) return null;
  return { stylistId: m[1], date: m[2], time: m[3], customerName: m[4], customerPhone: m[5] };
}

/**
 * Callback URL for a create-payment request, built from what the page sent.
 * `baseUrl` is this deployment's public origin.
 */
function callbackUrlForPayment(baseUrl, body, { agreedAt, amount, test = false }) {
  const parsed = parseBookingDescription(body && body.description);
  if (!parsed) return null;
  return callbackUrlFor(baseUrl, {
    stylistId: body.staffName || parsed.stylistId,
    date: parsed.date,
    time: parsed.time,
    customerGender: body.customerGender,
    customerPhone: body.phone || parsed.customerPhone,
    services: body.selectedServices,
    agreedAt,
    amount,
    test,
  });
}

/** Public origin of this deployment, for callbacks QPay must reach. */
function publicOrigin(req) {
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `https://${host}`;
  return process.env.BASE_URL || null;
}

module.exports = {
  callbackUrlFor,
  callbackUrlForPayment,
  decodeCallback,
  parseBookingDescription,
  publicOrigin,
  asciiIdFor,
  displayIdFor,
};
