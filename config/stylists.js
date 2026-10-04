'use strict';

/**
 * Tara Salon's hairdressers: who they are, where they work, their level, and
 * the Google Calendar a booking with them is written to.
 *
 * Names. Every hairdresser is shown — on the site, in booking, in alerts and
 * on calendar events — by the short Latin name the salon chose (founder,
 * 2026-10-03), exactly as written here. `ascii` is the lower-case form used
 * where only ASCII fits (the signed QPay callback token, services/lateBooking.js).
 *
 * `formerly` lists the names a hairdresser was booked under before. They stay
 * accepted as STYLIST_CONFIG keys (marked `alias`) so a booking page opened, or
 * a QPay callback signed, before the rename still reaches the same person and
 * calendar. Aliases are never listed or shown.
 *
 * Levels and deposits (founder, 2026-10-03): SPECIAL 20,000₮, Мастер 20,000₮,
 * 1-р зэрэг 10,000₮ (Яармаг only). The deposit is the level's; the server
 * decides it (config/siteMode.js depositFor), never the page.
 *
 * `gender` is the hairdresser's own. Women are served by female hairdressers
 * and men by the branch's male hairdresser (children too: girls by a woman,
 * boys by the man); services/bookingRules.js enforces it from this field. A new
 * hairdresser without a gender cannot be paid for at all. Never guess one.
 *
 * `branch` decides the calendar and the QPay account (config/branches.js).
 *
 * Calendars. Яармаг's are shared with the booking service account. Парк Од's
 * do not exist yet: each comes from PARKOD_CALENDAR_<NAME> (e.g.
 * PARKOD_CALENDAR_SARAA) once that hairdresser's calendar is shared with
 * Парк Од's booking account and the service account. A hairdresser without a
 * calendar is shown on the team section but not offered in booking, and a
 * branch with none is not bookable.
 *
 * Otgonjargal (Отгонжаргал) still works at Яармаг (founder, 2026-10-04): her
 * full name in Latin letters, 1-р зэргийн үсчин, as in the salon's data. The
 * `retired` flag remains for anyone who leaves: not shown or bookable, kept
 * only so a payment signed for them before still reaches their calendar.
 *
 * The salon no longer offers manicure: no manicurist is configured here.
 */

const LEVELS = {
  special: { key: 'special', rank: 0, level: 'SPECIAL үсчин', title: 'SPECIAL Hair Stylist', deposit: 20000 },
  master: { key: 'master', rank: 1, level: 'Мастер үсчин', title: 'Master Hair Stylist', deposit: 20000 },
  // «Hair Stylist» for 1-р зэрэг (founder, 2026-10-04: «Senior» sounded higher
  // than Master).
  first: { key: 'first', rank: 2, level: '1-р зэргийн үсчин', title: 'Hair Stylist', deposit: 10000 },
};

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Photo paths for a hairdresser (4:5 WebP, never upscaled). */
function photoSet(base, has2x = true) {
  return {
    photo: `/img/stylists/${base}-360.webp`,
    photo2x: has2x ? `/img/stylists/${base}-720.webp` : null,
  };
}

// Order within a branch is the team order: owner first, then by level, then
// as listed by the salon.
const PEOPLE = [
  // ── Яармаг салбар ────────────────────────────────────────────────────────
  {
    name: 'Oyunaa', ascii: 'oyunaa', branch: 'yaarmag', level: 'special', gender: 'female', owner: true,
    calendarId: 'c_46dc5625ec21ce8c17b61ed2f1c28b4328279cec168b982c49f218cd4452a4b3@group.calendar.google.com',
    formerly: ['Оюунсүрэн', 'oyunsuren'], ...photoSet('oyunaa'),
  },
  {
    name: 'Badamaa', ascii: 'badamaa', branch: 'yaarmag', level: 'master', gender: 'female',
    calendarId: 'c_7d47cf135b4ef24b9b4e920f8e981096087b236eb4f7d92a7ad8ce7a1d407529@group.calendar.google.com',
    formerly: ['Бадамцэцэг', 'badamtsetseg'], ...photoSet('badamaa'),
  },
  {
    name: 'Anand', ascii: 'anand', branch: 'yaarmag', level: 'master', gender: 'male',
    calendarId: 'c_2af068656b60e27cd9063a78b04dffbe24f1aab4543e50c2875f132dc4b12e17@group.calendar.google.com',
    formerly: ['Ананд'], ...photoSet('anand'),
  },
  {
    name: 'Uyanga', ascii: 'uyanga', branch: 'yaarmag', level: 'first', gender: 'female',
    calendarId: 'c_27de9527ce91e22bc5255af2dd51bc1db5c700d167d5aaad77062990bfe4875f@group.calendar.google.com',
    formerly: ['Уянга'], ...photoSet('uyanga', false),
  },
  {
    name: 'Zaya', ascii: 'zaya', branch: 'yaarmag', level: 'first', gender: 'female',
    calendarId: 'c_2979833247c0886af6789e6fbf205b66477105ceac615a07597ba4f6af975f63@group.calendar.google.com',
    formerly: ['Батзаяа', 'batzaya'], ...photoSet('zaya'),
  },
  {
    name: 'Chimgee', ascii: 'chimgee', branch: 'yaarmag', level: 'first', gender: 'female',
    calendarId: 'c_6efae8dadb0660afc266a939e8bfbd85af95bfc5ed498055ccd11175d181bbaf@group.calendar.google.com',
    formerly: ['Уранчимэг', 'uranchimeg'], photo: null, photo2x: null,
  },
  {
    name: 'Otgonjargal', ascii: 'otgonjargal', branch: 'yaarmag', level: 'first', gender: 'female',
    calendarId: 'c_1f0f02975a17088e3a939396200de8fb1b624fc4633c66f4e9a330576e24b27e@group.calendar.google.com',
    formerly: ['Отгонжаргал', 'otgonzargal'], ...photoSet('otgonjargal'),
  },
  // ── Парк Од салбар (every hairdresser but Boloroo is Мастер) ───────────────
  { name: 'Boloroo', ascii: 'boloroo', branch: 'parkod', level: 'special', gender: 'female', owner: true, calendarEnv: 'PARKOD_CALENDAR_BOLOROO', formerly: [], ...photoSet('boloroo') },
  { name: 'Saraa', ascii: 'saraa', branch: 'parkod', level: 'master', gender: 'female', calendarEnv: 'PARKOD_CALENDAR_SARAA', formerly: [], ...photoSet('saraa') },
  { name: 'Tomoo', ascii: 'tomoo', branch: 'parkod', level: 'master', gender: 'female', calendarEnv: 'PARKOD_CALENDAR_TOMOO', formerly: [], ...photoSet('tomoo') },
  { name: 'Bulgaa', ascii: 'bulgaa', branch: 'parkod', level: 'master', gender: 'female', calendarEnv: 'PARKOD_CALENDAR_BULGAA', formerly: [], ...photoSet('bulgaa') },
  { name: 'Enhuush', ascii: 'enhuush', branch: 'parkod', level: 'master', gender: 'female', calendarEnv: 'PARKOD_CALENDAR_ENHUUSH', formerly: [], ...photoSet('enhuush') },
  { name: 'Chimegee', ascii: 'chimegee', branch: 'parkod', level: 'master', gender: 'female', calendarEnv: 'PARKOD_CALENDAR_CHIMEGEE', formerly: [], ...photoSet('chimegee') },
  { name: 'Tuchku', ascii: 'tuchku', branch: 'parkod', level: 'master', gender: 'male', calendarEnv: 'PARKOD_CALENDAR_TUCHKU', formerly: [], ...photoSet('tuchku') },
];

function entryFor(p, extra) {
  const lv = LEVELS[p.level];
  const entry = {
    person: p.name,
    price: lv.deposit,
    level: lv.level,
    levelKey: lv.key,
    title: lv.title,
    gender: p.gender,
    branch: p.branch,
    photo: p.photo || null,
    photo2x: p.photo2x || null,
    owner: !!p.owner,
    retired: !!p.retired,
    calendarEnv: p.calendarEnv || null,
    ...extra,
  };
  // A calendar from the environment is read when asked for, so connecting a
  // hairdresser is a Vercel variable and a redeploy, never a code change.
  Object.defineProperty(entry, 'calendarId', {
    enumerable: true,
    get: () => (p.calendarEnv ? env(p.calendarEnv) : (p.calendarId || null)),
  });
  return entry;
}

/**
 * Every accepted stylist id → its settings. The display name comes first,
 * then the ASCII form, then former names (aliases). Lookups by any of them
 * reach the same person, calendar and deposit.
 */
const STYLIST_CONFIG = {};
for (const p of PEOPLE) {
  STYLIST_CONFIG[p.name] = entryFor(p, {});
  STYLIST_CONFIG[p.ascii] = entryFor(p, { ascii: true });
  for (const old of p.formerly) STYLIST_CONFIG[old] = entryFor(p, { alias: true, ascii: /^[a-z.]+$/.test(old) });
}

/**
 * Convenience map of stylistId → calendarId, for use where only the
 * calendar ID is needed (e.g. the payment-success webhook).
 */
const STYLIST_CALENDAR_MAP = {};
for (const id of Object.keys(STYLIST_CONFIG)) {
  Object.defineProperty(STYLIST_CALENDAR_MAP, id, { enumerable: true, get: () => STYLIST_CONFIG[id].calendarId });
}

/** The canonical display name for any accepted id, or null. */
function personOf(stylistId) {
  const cfg = STYLIST_CONFIG[stylistId];
  return cfg ? cfg.person : null;
}

/** The ASCII id of a person (for the signed callback token), or null. */
function asciiOf(stylistId) {
  const person = personOf(stylistId);
  const p = PEOPLE.find((x) => x.name === person);
  return p ? p.ascii : null;
}

/** The team as the site shows it: current hairdressers (not retired), in order. */
function teamOf(branchId) {
  return PEOPLE
    .filter((p) => p.branch === branchId && !p.retired)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (Number(!!b.p.owner) - Number(!!a.p.owner)) || (LEVELS[a.p.level].rank - LEVELS[b.p.level].rank) || (a.i - b.i))
    .map(({ p }) => p.name);
}

// Kept for older imports (tests, scripts).
const OTGONZARGAL_CALENDAR_ID = STYLIST_CONFIG.Otgonjargal.calendarId;

module.exports = { STYLIST_CONFIG, STYLIST_CALENDAR_MAP, OTGONZARGAL_CALENDAR_ID, LEVELS, personOf, asciiOf, teamOf };
