'use strict';

/**
 * Salon-wide closure periods (holidays, maintenance, etc).
 *
 * A closure blocks every booking whose APPOINTMENT date falls inside
 * [start, end] — both inclusive, both plain YYYY-MM-DD dates in salon-local
 * time (Asia/Ulaanbaatar, UTC+8, no DST). `end` is the LAST closed day; the
 * salon reopens the following morning (see `reopenDate`).
 *
 * Availability is otherwise derived purely from each stylist's Google Calendar,
 * which knows nothing about the salon being shut — so a closure has to be
 * enforced here, in one place, for every stylist at once.
 *
 * ## Configuring a future closure without a code change
 *
 * Set these environment variables (Vercel -> Project -> Settings -> Environment
 * Variables, then redeploy so the functions pick them up):
 *
 *   SALON_CLOSURE_START    YYYY-MM-DD  first closed day (inclusive)
 *   SALON_CLOSURE_END      YYYY-MM-DD  last closed day (inclusive)
 *   SALON_CLOSURE_TITLE    optional    headline shown to customers
 *   SALON_CLOSURE_MESSAGE  optional    one-sentence explanation
 *
 * Setting SALON_CLOSURE_START=none disables closures entirely.
 * When no closure applies, every booking and payment path behaves exactly as
 * it does with this file absent.
 *
 * A closure whose `end` is in the past is inert: it can never match a bookable
 * date, so leaving an old one configured costs nothing.
 */

/** Mongolia is UTC+8 year-round (no daylight saving). */
const SALON_UTC_OFFSET_MINUTES = 8 * 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Closures that ship with the code. Used when no SALON_CLOSURE_* env vars are
 * set, so the salon is protected on deploy without any dashboard setup.
 */
const DEFAULT_CLOSURES = [
  {
    start: '2026-07-11',
    end: '2026-07-17',
    title: 'Наадмын амралт',
    message: 'Үндэсний их баяр наадмыг тохиолдуулан салон түр амарч байна.',
  },
];

/**
 * Today's date in the salon's own timezone, as YYYY-MM-DD.
 * Uses UTC+8 rather than the server's clock, which on Vercel is UTC.
 *
 * @param {Date} [now]
 * @returns {string}
 */
function salonToday(now = new Date()) {
  return new Date(now.getTime() + SALON_UTC_OFFSET_MINUTES * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The salon-local calendar date of an instant, as YYYY-MM-DD.
 * Accepts anything `new Date()` understands, e.g. "2026-07-15T10:00:00+08:00".
 *
 * @param {string|Date} instant
 * @returns {string|null} null when the input is not a valid date
 */
function salonDateOf(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return salonToday(d);
}

/**
 * Add whole days to a YYYY-MM-DD date, returning YYYY-MM-DD.
 * Pure calendar arithmetic — no timezone involved.
 *
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Whether a string is a real calendar date, not merely YYYY-MM-DD shaped.
 * "2026-02-31" matches the pattern but does not exist; round-tripping it
 * through the calendar catches that, so a typo cannot become a closure
 * silently covering days nobody intended.
 *
 * @param {string} dateStr
 * @returns {boolean}
 */
function isRealDate(dateStr) {
  return DATE_RE.test(dateStr || '') && addDays(dateStr, 0) === dateStr;
}

/**
 * Normalise a raw closure into the shape the rest of the app consumes,
 * or return null when it is unusable.
 *
 * @param {{start: string, end: string, title?: string, message?: string}} raw
 * @param {string} source  where it came from, for the warning message
 * @returns {{start, end, title, message, reopenDate}|null}
 */
function normaliseClosure(raw, source) {
  if (!raw || !isRealDate(raw.start) || !isRealDate(raw.end)) {
    console.warn(`Ignoring ${source} closure: start and end must both be real YYYY-MM-DD dates`, raw);
    return null;
  }
  if (raw.start > raw.end) {
    console.warn(`Ignoring ${source} closure: start "${raw.start}" is after end "${raw.end}"`);
    return null;
  }
  return {
    start: raw.start,
    end: raw.end,
    title: raw.title || 'Салон түр хаалттай',
    message: raw.message || 'Энэ өдрүүдэд салон амарч байна.',
    // The first day bookings are possible again.
    reopenDate: addDays(raw.end, 1),
  };
}

/**
 * The closure periods currently in force.
 * Env vars win over DEFAULT_CLOSURES; a malformed env closure is ignored with a
 * warning and the defaults apply, so a typo can never silently shut booking down.
 *
 * @returns {Array<{start, end, title, message, reopenDate}>}
 */
function getClosures() {
  const envStart = (process.env.SALON_CLOSURE_START || '').trim();
  const envEnd = (process.env.SALON_CLOSURE_END || '').trim();

  if (envStart.toLowerCase() === 'none') return [];

  if (envStart || envEnd) {
    const fromEnv = normaliseClosure(
      {
        start: envStart,
        end: envEnd,
        title: (process.env.SALON_CLOSURE_TITLE || '').trim() || undefined,
        message: (process.env.SALON_CLOSURE_MESSAGE || '').trim() || undefined,
      },
      'SALON_CLOSURE_START/END',
    );
    if (fromEnv) return [fromEnv];
  }

  return DEFAULT_CLOSURES.map((c) => normaliseClosure(c, 'default')).filter(Boolean);
}

/**
 * The closure covering the given salon-local date, if any.
 *
 * ISO dates compare correctly as plain strings, which keeps this free of
 * timezone arithmetic entirely.
 *
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {{start, end, title, message, reopenDate}|null}
 */
function findClosure(dateStr) {
  if (!DATE_RE.test(dateStr || '')) return null;
  return getClosures().find((c) => dateStr >= c.start && dateStr <= c.end) || null;
}

/**
 * Whether any configured closure still covers today or a future date.
 *
 * Payment endpoints use this to decide how strict to be about a request that
 * carries no readable appointment date: while a closure is live it is not safe
 * to assume such a request is for an open day, but once every closure has
 * passed there is nothing to protect and behaviour returns to normal.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
function hasPendingClosure(now = new Date()) {
  const today = salonToday(now);
  return getClosures().some((c) => c.end >= today);
}

module.exports = {
  DEFAULT_CLOSURES,
  getClosures,
  findClosure,
  hasPendingClosure,
  salonToday,
  salonDateOf,
  addDays,
};
