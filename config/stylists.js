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
 *   Ахлах стилист      – 10 000 MNT
 *   1-р зэргийн үсчин  – 10 000 MNT
 *   Маникюр            – 20 000 MNT
 */

// Dedicated calendar ID for manicurist Г. Мөнхзаяа
const MUNKHZAYA_CALENDAR_ID = 'c_943dac8f8417fcc6c7bf84a6c8f0f84529b9800f5ade551573b2f637830d14b5@group.calendar.google.com';

// Dedicated calendar ID for hairdresser Отгонжаргал
const OTGONZARGAL_CALENDAR_ID = 'c_1f0f02975a17088e3a939396200de8fb1b624fc4633c66f4e9a330576e24b27e@group.calendar.google.com';

const STYLIST_CONFIG = {
  'Ананд': {
    calendarId: 'c_2af068656b60e27cd9063a78b04dffbe24f1aab4543e50c2875f132dc4b12e17@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
  },
  'anand': {
    calendarId: 'c_2af068656b60e27cd9063a78b04dffbe24f1aab4543e50c2875f132dc4b12e17@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
  },
  'Бадамцэцэг': {
    calendarId: 'c_7d47cf135b4ef24b9b4e920f8e981096087b236eb4f7d92a7ad8ce7a1d407529@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'badamtsetseg': {
    calendarId: 'c_7d47cf135b4ef24b9b4e920f8e981096087b236eb4f7d92a7ad8ce7a1d407529@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'Батзаяа': {
    calendarId: 'c_2979833247c0886af6789e6fbf205b66477105ceac615a07597ba4f6af975f63@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'batzaya': {
    calendarId: 'c_2979833247c0886af6789e6fbf205b66477105ceac615a07597ba4f6af975f63@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'Мухлай': {
    calendarId: 'c_6efae8dadb0660afc266a939e8bfbd85af95bfc5ed498055ccd11175d181bbaf@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'muhlai': {
    calendarId: 'c_6efae8dadb0660afc266a939e8bfbd85af95bfc5ed498055ccd11175d181bbaf@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'Оюунсүрэн': {
    calendarId: 'c_46dc5625ec21ce8c17b61ed2f1c28b4328279cec168b982c49f218cd4452a4b3@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
  },
  'oyunsuren': {
    calendarId: 'c_46dc5625ec21ce8c17b61ed2f1c28b4328279cec168b982c49f218cd4452a4b3@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
  },
  'Тэргэл': {
    calendarId: 'c_1d339159e8bc7a5059cc20d52c7b2b1cda07442336f2c2a5b7880c00d6b442f9@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'tergel': {
    calendarId: 'c_1d339159e8bc7a5059cc20d52c7b2b1cda07442336f2c2a5b7880c00d6b442f9@group.calendar.google.com',
    price: 10000,
    level: 'Ахлах стилист',
  },
  'Уянга': {
    calendarId: 'c_27de9527ce91e22bc5255af2dd51bc1db5c700d167d5aaad77062990bfe4875f@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
  },
  'uyanga': {
    calendarId: 'c_27de9527ce91e22bc5255af2dd51bc1db5c700d167d5aaad77062990bfe4875f@group.calendar.google.com',
    price: 20000,
    level: 'Мастер үсчин',
  },
  'Г. Мөнхзаяа': {
    calendarId: MUNKHZAYA_CALENDAR_ID,
    price: 20000,
    level: 'Маникюр',
  },
  'g.munkhzaya': {
    // Latin transliteration alias — mirrors the Mongolian entry above (see file-level comment)
    calendarId: MUNKHZAYA_CALENDAR_ID,
    price: 20000,
    level: 'Маникюр',
  },
  'Отгонжаргал': {
    calendarId: OTGONZARGAL_CALENDAR_ID,
    price: 10000,
    level: '1-р зэргийн үсчин',
  },
  'otgonzargal': {
    // Latin transliteration alias — mirrors the Mongolian entry above (see file-level comment)
    calendarId: OTGONZARGAL_CALENDAR_ID,
    price: 10000,
    level: '1-р зэргийн үсчин',
  },
};

/**
 * Convenience map of stylistId → calendarId, for use where only the
 * calendar ID is needed (e.g. the payment-success webhook).
 */
const STYLIST_CALENDAR_MAP = Object.fromEntries(
  Object.entries(STYLIST_CONFIG).map(([id, cfg]) => [id, cfg.calendarId]),
);

module.exports = { STYLIST_CONFIG, STYLIST_CALENDAR_MAP, MUNKHZAYA_CALENDAR_ID, OTGONZARGAL_CALENDAR_ID };
