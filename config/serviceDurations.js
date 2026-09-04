'use strict';

/**
 * Service durations — how long each bookable service occupies the chair.
 *
 * The figures live in data/serviceDurations.json so the booking UI can fetch the
 * same file the server reads; this module is the server's alias-aware accessor.
 *
 * Why the salon needs this: availability used to assume every appointment took
 * one hour, so a 4-hour "Оффис колор" could be started at 18:00 on a day the
 * salon closes at 20:00, and the resulting calendar event blocked only one hour
 * — letting a second customer book on top of it. Every duration decision now
 * comes from here.
 *
 * Matching is deliberately forgiving: the booking checkboxes, the price list
 * (data/pricing.json) and the salon's own spelling differ in punctuation and in
 * ё/е, so names are normalised and each service may carry aliases.
 */

const catalogue = require('../data/serviceDurations.json');

const DEFAULT_MINUTES =
  Number.isFinite(catalogue.defaultMinutes) && catalogue.defaultMinutes > 0
    ? catalogue.defaultMinutes
    : 60;

/**
 * Canonicalise a service name for comparison.
 * Mirrors normalizeServiceName() in script.js: case, ё/е and whitespace are not
 * meaningful. Slashes and parentheses are also flattened so "Будаг/угны",
 * "Будаг (Уг)" and "Будаг / угны" all reduce to the same key.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeServiceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е') // ё -> е
    .replace(/[()/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// name (normalised, including aliases) -> minutes
const DURATION_BY_NAME = new Map();
for (const entry of catalogue.services || []) {
  if (!entry || !entry.name || !Number.isFinite(entry.minutes) || entry.minutes <= 0) continue;
  DURATION_BY_NAME.set(normalizeServiceName(entry.name), entry.minutes);
  for (const alias of entry.aliases || []) {
    DURATION_BY_NAME.set(normalizeServiceName(alias), entry.minutes);
  }
}

/**
 * Minutes for a single service, or null when the name is not in the catalogue.
 * Callers decide what an unknown name means — this never silently guesses.
 *
 * @param {string} name
 * @returns {number|null}
 */
function durationForService(name) {
  const key = normalizeServiceName(name);
  if (!key) return null;
  return DURATION_BY_NAME.has(key) ? DURATION_BY_NAME.get(key) : null;
}

/**
 * Split the `services` query/body value into individual service names.
 * Accepts either an array or the comma-separated string the booking UI sends.
 *
 * @param {string|string[]|undefined} value
 * @returns {string[]}
 */
function parseServices(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return list.map((s) => String(s || '').trim()).filter(Boolean);
}

/**
 * Total chair time for a set of selected services.
 *
 * Services are assumed to run back to back (the salon does one thing at a time
 * to one customer), so durations add up. An unrecognised name is charged the
 * default rather than zero — under-booking is what causes the salon to promise
 * a slot it cannot honour, so the safe failure is to reserve too much time, not
 * too little. Unknown names are returned so callers can log them.
 *
 * @param {string|string[]|undefined} services
 * @returns {{ minutes: number, services: string[], unknown: string[], resolved: boolean }}
 *   resolved=false when nothing usable was supplied, so the caller can fall back
 *   to its own default instead of treating this as a real 0-minute answer.
 */
function totalDurationFor(services) {
  const names = parseServices(services);
  if (names.length === 0) {
    return { minutes: 0, services: [], unknown: [], resolved: false };
  }

  const unknown = [];
  let minutes = 0;
  for (const name of names) {
    const known = durationForService(name);
    if (known == null) {
      unknown.push(name);
      minutes += DEFAULT_MINUTES;
    } else {
      minutes += known;
    }
  }

  return { minutes, services: names, unknown, resolved: true };
}

module.exports = {
  DEFAULT_MINUTES,
  normalizeServiceName,
  durationForService,
  parseServices,
  totalDurationFor,
};
