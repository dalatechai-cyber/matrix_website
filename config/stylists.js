'use strict';

/**
 * Stylist configuration mapping stylist identifiers to their Google Calendar ID
 * and service price in MNT.
 *
 * Both Mongolian display names and Latin transliterations are accepted as keys
 * so that bookings submitted with either form resolve to the correct calendar.
 *
 * Pricing tiers:
 *   Мастер үсчин       – 20 000 MNT
 *   1-р зэргийн үсчин  – 10 000 MNT
 *
 * `gender` is the hairdresser's own, as the team page groups them
 * («Эмэгтэй үсчид» / «Эрэгтэй үсчид»). The salon's rule is that a female
 * customer is served by a female hairdresser and a male customer by a male one;
 * services/bookingRules.js enforces it from this field. A new hairdresser
 * without a gender cannot be paid for at all, so add it with the entry.
 *
 * `branch` is the Tara Salon branch the hairdresser works at (config/branches.js);
 * a booking only ever reaches the calendar and QPay account of that branch.
 * Парк Од has no hairdressers yet: add them below the Яармаг ones with
 * `branch: 'parkod'` (and a Latin alias, like the others) once the branch
 * sends each person's calendar id, price tier and gender.
 * `photo` is optional; the booking page shows initials without one.
 *
 * The salon no longer offers manicure. The manicurist's calendar still holds
 * her past appointments; it is simply no longer referenced here, so nothing
 * can be booked or paid for on it.
 */

// Dedicated calendar ID for hairdresser Отгонжаргал
const OTGONZARGAL_CALENDAR_ID = 'c_1f0f02975a17088e3a939396200de8fb1b624fc4633c66f4e9a330576e24b27e@group.calendar.google.com';

const STYLIST_CONFIG = {
  'Ананд': {
    calendarId: 'c_2af068656b60e27cd9063a78b04dffbe24f1aab4543e50c2875f132dc4b12e17@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
    gender: 'male',
    branch: 'yaarmag',
    photo: '/img/stylists/anand.webp',
  },
  'anand': {
    calendarId: 'c_2af068656b60e27cd9063a78b04dffbe24f1aab4543e50c2875f132dc4b12e17@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
    gender: 'male',
    branch: 'yaarmag',
  },
  'Бадамцэцэг': {
    calendarId: 'c_7d47cf135b4ef24b9b4e920f8e981096087b236eb4f7d92a7ad8ce7a1d407529@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
    gender: 'female',
    branch: 'yaarmag',
    photo: '/img/stylists/badamtsetseg.webp',
  },
  'badamtsetseg': {
    calendarId: 'c_7d47cf135b4ef24b9b4e920f8e981096087b236eb4f7d92a7ad8ce7a1d407529@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
  'Батзаяа': {
    calendarId: 'c_2979833247c0886af6789e6fbf205b66477105ceac615a07597ba4f6af975f63@group.calendar.google.com',
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
    photo: '/img/stylists/batzaya.webp',
  },
  'batzaya': {
    calendarId: 'c_2979833247c0886af6789e6fbf205b66477105ceac615a07597ba4f6af975f63@group.calendar.google.com',
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
  'Уранчимэг': {
    calendarId: 'c_6efae8dadb0660afc266a939e8bfbd85af95bfc5ed498055ccd11175d181bbaf@group.calendar.google.com',
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
  'uranchimeg': {
    calendarId: 'c_6efae8dadb0660afc266a939e8bfbd85af95bfc5ed498055ccd11175d181bbaf@group.calendar.google.com',
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
  'Оюунсүрэн': {
    calendarId: 'c_46dc5625ec21ce8c17b61ed2f1c28b4328279cec168b982c49f218cd4452a4b3@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
    gender: 'female',
    branch: 'yaarmag',
    photo: '/img/stylists/oyunsuren.webp',
  },
  'oyunsuren': {
    calendarId: 'c_46dc5625ec21ce8c17b61ed2f1c28b4328279cec168b982c49f218cd4452a4b3@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
  'Уянга': {
    calendarId: 'c_27de9527ce91e22bc5255af2dd51bc1db5c700d167d5aaad77062990bfe4875f@group.calendar.google.com',
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
    photo: '/img/stylists/uyanga.webp',
  },
  'uyanga': {
    calendarId: 'c_27de9527ce91e22bc5255af2dd51bc1db5c700d167d5aaad77062990bfe4875f@group.calendar.google.com',
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
  'Отгонжаргал': {
    calendarId: OTGONZARGAL_CALENDAR_ID,
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
    photo: '/img/stylists/otgonjargal.webp',
  },
  'otgonzargal': {
    // Latin transliteration alias — mirrors the Mongolian entry above (see file-level comment)
    calendarId: OTGONZARGAL_CALENDAR_ID,
    price: 10000,
    level: '1-р зэргийн үсчин',
    gender: 'female',
    branch: 'yaarmag',
  },
};

/**
 * Convenience map of stylistId → calendarId, for use where only the
 * calendar ID is needed (e.g. the payment-success webhook).
 */
const STYLIST_CALENDAR_MAP = Object.fromEntries(
  Object.entries(STYLIST_CONFIG).map(([id, cfg]) => [id, cfg.calendarId]),
);

module.exports = { STYLIST_CONFIG, STYLIST_CALENDAR_MAP, OTGONZARGAL_CALENDAR_ID };
