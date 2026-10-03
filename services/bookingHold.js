'use strict';

const crypto = require('crypto');
const { STYLIST_CONFIG, personOf } = require('../config/stylists');

/**
 * The website's 5-minute hold: while a customer looks at the QPay QR, their
 * time is taken everywhere — on this site and in Messenger (dala-ai's in-chat
 * booking reads the same calendars and holds its own times as `dh…` events).
 *
 * Before an invoice is created, both create-payment handlers put an opaque
 * (busy) event on the hairdresser's calendar covering the WHOLE appointment:
 *
 *   id      'sh' + sha256(calendarId|startISO|phoneDigits)[0..40]
 *           (Google event ids allow only a–v and 0–9, so «sh», never «wh»)
 *           — one per booking, so a renewed QR («Шинэ QR код авах») extends
 *           the same hold instead of adding a second one;
 *   private { taraHold: '1', holdExpiresAt, holdPlacedAt, holdPhone }
 *
 * Then it looks at the window again. If anything else now overlaps (a booking,
 * a chat hold, another website hold), the hold is given back and no QR is made
 * — except a hold PLACED strictly after ours (holdPlacedAt, rewritten on every
 * renewal; a chat `dh` hold's own creation time): that one sees ours and
 * yields. A customer's earlier hold is never released by a newer one: its QR
 * may still be paid (a parent booking two times, two tabs); it simply expires.
 * So two customers can never both reach a QR for one time.
 *
 * Paid: services/bookingWriter.js writes the `qb…` booking and deletes the
 * hold. Unpaid: the hold expires with the QR and the request that placed it
 * deletes it then (`releaseWhenExpired`, kept alive past the response by
 * Vercel's waitUntil), so no schedule is needed. If that is ever cut short,
 * an expired hold is still free everywhere: this site deletes it whenever
 * anyone looks at that day's times and before any new hold, dala-ai reads an
 * expired `sh` hold as free, and the daily sweep
 * (GET /api/calendar/sweep-holds, Production only) removes what is left. A late payment after expiry is still booked if the time is free, or
 * alerted if not (unchanged).
 *
 * The site has no database: the calendar event IS the hold.
 */

const HOLD_PREFIX = 'sh';
// dala-ai's in-chat holds carry dalaBookingState 'hold'. The id is no guide:
// a paid chat booking keeps its `dh…` id and becomes state 'booking', and a
// booking must never be treated as a hold that yields.
const CHAT_HOLD_STATE = 'hold';
const HOLD_FLAG = 'taraHold';
// The QR's life on the booking page (assets/booking.js QPAY_QR_VALID_MS),
// plus a margin: the hold is placed a moment BEFORE the invoice, so without it
// the hold would end a second or two before the QR does. The request that
// placed the hold deletes it at expiry, so the payment functions run up to
// 400 s (maxDuration in api/qpay/create-payment.mjs and server.mjs; Pro plan).
const HOLD_SECONDS = 300;
const HOLD_GRACE_SECONDS = 30;
// Leave the function this much of its 400 s for the release itself.
const FUNCTION_BUDGET_MS = 392 * 1000;
const SALON_TZ_OFFSET = '+08:00';

function holdIdFor(calendarId, start, phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!calendarId || !digits || !(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  return HOLD_PREFIX + crypto.createHash('sha256').update(`${calendarId}|${start.toISOString()}|${digits}`).digest('hex').slice(0, 40);
}

function statusOf(err) {
  return err && (err.code || (err.response && err.response.status));
}

function isHoldEvent(e) {
  const priv = (e && e.extendedProperties && e.extendedProperties.private) || {};
  return (priv[HOLD_FLAG] === '1' && String((e && e.id) || '').startsWith(HOLD_PREFIX))
    || priv.dalaBookingState === CHAT_HOLD_STATE;
}

/** When a hold was (last) placed: a website hold's holdPlacedAt, else its creation. */
function placedAtOf(e) {
  const priv = (e && e.extendedProperties && e.extendedProperties.private) || {};
  const t = new Date(priv.holdPlacedAt || (e && e.created) || 0);
  return Number.isNaN(t.getTime()) ? new Date(0) : t;
}

/** A website hold whose QR has run out: free, and safe to delete. */
function isExpiredWebsiteHold(e, now = new Date()) {
  const priv = (e && e.extendedProperties && e.extendedProperties.private) || {};
  if (priv[HOLD_FLAG] !== '1' || !String(e.id || '').startsWith(HOLD_PREFIX)) return false;
  const exp = new Date(priv.holdExpiresAt || 0);
  return !Number.isNaN(exp.getTime()) && exp <= now;
}

/** [start, end) of an event; all-day events cover whole salon days. */
function spanOf(e) {
  const s = e.start || {};
  const en = e.end || {};
  const start = s.dateTime ? new Date(s.dateTime) : (s.date ? new Date(`${s.date}T00:00:00${SALON_TZ_OFFSET}`) : null);
  const end = en.dateTime ? new Date(en.dateTime) : (en.date ? new Date(`${en.date}T00:00:00${SALON_TZ_OFFSET}`) : null);
  return start && end ? { start, end } : null;
}

async function listWindow(calendar, calendarId, start, end, extra = {}) {
  const items = [];
  let pageToken;
  do {
    const r = await calendar.events.list({
      calendarId,
      ...(start ? { timeMin: start.toISOString() } : {}),
      ...(end ? { timeMax: end.toISOString() } : {}),
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      pageToken,
      ...extra,
    });
    items.push(...((r && r.data && r.data.items) || []));
    pageToken = r && r.data && r.data.nextPageToken;
  } while (pageToken);
  return items;
}

async function deleteQuietly(calendar, calendarId, eventId) {
  try {
    await calendar.events.delete({ calendarId, eventId });
    return true;
  } catch (err) {
    const code = statusOf(err);
    if (code === 404 || code === 410) return true;
    console.warn('hold: could not delete', eventId, err.message || err);
    return false;
  }
}

/**
 * Events other than `ownIds` that make [start, end) busy. Expired website
 * holds are not busy: they are deleted on the way.
 */
async function othersOverlapping(calendar, calendarId, start, end, ownIds, now = new Date()) {
  const items = await listWindow(calendar, calendarId, start, end);
  const blocking = [];
  for (const e of items) {
    if (!e || e.status === 'cancelled' || e.transparency === 'transparent' || ownIds.includes(e.id)) continue;
    const span = spanOf(e);
    if (!span || !(start < span.end && end > span.start)) continue;
    if (isExpiredWebsiteHold(e, now)) {
      await deleteQuietly(calendar, calendarId, e.id);
      continue;
    }
    blocking.push(e);
  }
  return blocking;
}

async function getEvent(calendar, calendarId, eventId) {
  try {
    const r = await calendar.events.get({ calendarId, eventId });
    return (r && r.data) || null;
  } catch (err) {
    const code = statusOf(err);
    if (code === 404 || code === 410) return null;
    throw err;
  }
}

function holdBody({ id, stylistId, start, end, phone, services, expiresAt, placedAt, test }) {
  const serviceText = Array.isArray(services) ? services.join(', ') : (services || '');
  return {
    id,
    summary: `${test ? 'ТЕСТ – ' : ''}⏳ Түр хадгалсан (төлбөр хүлээж байна) – ${phone}`,
    description: [
      'Website hold: the customer is looking at the QPay QR for this time.',
      `Expires: ${expiresAt.toISOString()} unless paid. Do not book over it.`,
      `Hairdresser: ${personOf(stylistId) || stylistId}`,
      serviceText ? `Services: ${serviceText}` : null,
    ].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    transparency: 'opaque',
    status: 'confirmed',
    extendedProperties: { private: { [HOLD_FLAG]: '1', holdExpiresAt: expiresAt.toISOString(), holdPlacedAt: placedAt.toISOString(), holdPhone: phone } },
  };
}

/**
 * Hold [start, start + minutes) for this customer before their QR is made.
 *
 * @returns {Promise<{ ok: true, holdId: string, expiresAt: Date } | { ok: false, reason: 'slot-taken'|'no-phone'|'no-calendar' }>}
 *   Throws when Google Calendar fails: the caller refuses the invoice (no
 *   hold, no QR), so a time is never sold that nobody could check.
 */
async function placeHold(calendar, { stylistId, start, minutes, phone, services, test = false, now = new Date() }) {
  const stylist = STYLIST_CONFIG[stylistId];
  const calendarId = stylist && stylist.calendarId;
  if (!calendarId) return { ok: false, reason: 'no-calendar' };
  const id = holdIdFor(calendarId, start, phone);
  if (!id) return { ok: false, reason: 'no-phone' };
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  const expiresAt = new Date(now.getTime() + (HOLD_SECONDS + HOLD_GRACE_SECONDS) * 1000);
  // The customer's own booking for this time (paid on an earlier QR) is theirs.
  const { eventIdForBooking } = require('./bookingWriter');
  const ownIds = [id, eventIdForBooking(calendarId, start, phone)].filter(Boolean);

  if ((await othersOverlapping(calendar, calendarId, start, end, ownIds, now)).length > 0) {
    return { ok: false, reason: 'slot-taken' };
  }

  const digits = String(phone).replace(/\D/g, '');
  const placedAt = new Date();
  const body = holdBody({ id, stylistId, start, end, phone: digits, services, expiresAt, placedAt, test });
  let mine;
  try {
    mine = (await calendar.events.insert({ calendarId, requestBody: body })).data;
  } catch (err) {
    if (statusOf(err) !== 409) throw err;
    // This booking's hold already exists (a renewed QR, or a cancelled one):
    // extend it and bring it back.
    const { id: _id, ...patch } = body;
    mine = (await calendar.events.patch({ calendarId, eventId: id, requestBody: patch })).data;
  }
  const ourPlaced = placedAtOf(mine && mine.extendedProperties ? mine : { extendedProperties: { private: { holdPlacedAt: placedAt.toISOString() } } });

  // Look again: someone may have taken an overlapping time meanwhile. A hold
  // placed after ours yields to ours (it sees ours when it looks again).
  const others = await othersOverlapping(calendar, calendarId, start, end, ownIds, now);
  const winners = others.filter((e) => !(isHoldEvent(e) && placedAtOf(e) > ourPlaced));
  if (winners.length > 0) {
    await deleteQuietly(calendar, calendarId, id);
    return { ok: false, reason: 'slot-taken' };
  }
  return { ok: true, holdId: id, expiresAt };
}

/** Give a hold back (invoice failed, or the booking is written). */
async function releaseHold(calendar, { stylistId, start, phone }) {
  const stylist = STYLIST_CONFIG[stylistId];
  const id = stylist && holdIdFor(stylist.calendarId, start, phone);
  if (!id) return false;
  return deleteQuietly(calendar, stylist.calendarId, id);
}

// Delete a moment after the hold's own expiry, so the check below never sees
// it a moment early.
const RELEASE_LAG_MS = 2 * 1000;
// unref: a test run or a local server never waits on it; on Vercel, waitUntil
// keeps the function alive for it.
const sleepMs = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t.unref) t.unref(); });

/**
 * Wait until this hold has expired, then delete it — unless it is gone (paid:
 * the booking writer removed it) or was renewed (a new QR moved its expiry;
 * that request waits for the new time). Never waits past `deadline` (the
 * function's own time limit). Never throws.
 * @returns {Promise<'deleted'|'gone'|'renewed'|'failed'>}
 */
async function releaseWhenExpired(calendar, calendarId, holdId, expiresAt, { sleep = sleepMs, now = () => new Date(), deadline = null } = {}) {
  try {
    let until = expiresAt.getTime() + RELEASE_LAG_MS;
    if (deadline && until > deadline.getTime()) {
      console.warn('hold release: expiry is past the function\'s time limit; left to the read-time cleanup', holdId);
      until = deadline.getTime();
    }
    const wait = until - now().getTime();
    if (wait > 0) await sleep(wait);
    const ev = await getEvent(calendar, calendarId, holdId);
    let outcome;
    if (!ev || ev.status === 'cancelled') outcome = 'gone';
    else if (!isExpiredWebsiteHold(ev, now())) outcome = 'renewed';
    else outcome = (await deleteQuietly(calendar, calendarId, holdId)) ? 'deleted' : 'failed';
    console.log('hold release:', outcome, holdId);
    return outcome;
  } catch (err) {
    console.warn('hold release failed', holdId, err.message || err);
    return 'failed';
  }
}

/**
 * Keep the serverless function alive after its response until the hold is
 * released (Vercel waitUntil; maxDuration 400 in the .mjs entries covers the
 * 5½ minutes). Off Vercel the timer simply runs in the process.
 */
function releaseAfterResponse(promise) {
  try {
    require('@vercel/functions').waitUntil(promise);
  } catch (err) {
    console.warn('hold release: waitUntil unavailable', err.message || err);
  }
  return promise;
}

/** This booking's own hold, if one is on the calendar (expired or not). */
async function findOwnHold(calendar, { calendarId, start, phone }) {
  const id = holdIdFor(calendarId, start, phone);
  if (!id) return null;
  const ev = await getEvent(calendar, calendarId, id);
  return ev && ev.status !== 'cancelled' ? ev : null;
}

/**
 * Delete expired website holds on these calendars. Either within an
 * appointment window (`from`, `to`), or — for the daily sweep — every hold
 * written since `updatedSince`, whatever day its appointment is on (a hold is
 * written minutes before it expires, so a few days back covers every one).
 * Best effort: returns the number deleted.
 */
async function sweepExpiredHolds(calendar, calendarIds, { from = null, to = null, updatedSince = null, now = new Date() }) {
  let deleted = 0;
  const extra = { privateExtendedProperty: `${HOLD_FLAG}=1` };
  if (updatedSince) extra.updatedMin = updatedSince.toISOString();
  for (const calendarId of calendarIds) {
    try {
      const items = await listWindow(calendar, calendarId, from, to, extra);
      for (const e of items) {
        // With updatedMin Google also returns deleted events: skip them.
        if (e.status !== 'cancelled' && isExpiredWebsiteHold(e, now) && await deleteQuietly(calendar, calendarId, e.id)) deleted += 1;
      }
    } catch (err) {
      // One calendar not shared yet must not stop the others.
      console.warn('hold sweep: calendar unreadable', calendarId, err.message || err);
    }
  }
  return deleted;
}

const SLOT_TAKEN_MESSAGE = 'Уучлаарай, энэ цаг өөр хүнд захиалагдсан байна. Өөр цаг сонгоно уу.';
// Draft wording, awaiting the founder's approval (docs/COPY_DRAFT.md).
const HOLD_UNAVAILABLE_MESSAGE = 'Уучлаарай, цагийн хуваарийг яг одоо шалгаж чадсангүй. Түр хүлээгээд дахин оролдоно уу.';

/**
 * The hold for a create-payment request, shared by both handlers so they
 * cannot drift. Start time and phone come from the booking description the
 * page sends (the same source as the signed callback); length from the
 * services, never from the browser.
 *
 * @returns {Promise<{ ok: true, release: () => Promise<boolean> } | { ok: false, status: number, payload: object }>}
 */
// A light brake on someone scripting holds to block a day: per client
// address, per server instance (no database). Real customers hold one time,
// renewing it at most every five minutes.
const RATE_WINDOW_MS = 10 * 60 * 1000;
// Only holds actually placed count, and the limit is generous: Mongolian
// mobile carriers put many customers behind one address.
const RATE_MAX = 20;
const recentByClient = new Map();
function recentHolds(client, nowMs = Date.now()) {
  const times = (recentByClient.get(client) || []).filter((t) => nowMs - t < RATE_WINDOW_MS);
  recentByClient.set(client, times);
  return times;
}
function rateLimited(client) {
  return !!client && recentHolds(client).length >= RATE_MAX;
}
function countHold(client) {
  if (!client) return;
  if (recentByClient.size > 5000) recentByClient.clear();
  recentHolds(client).push(Date.now());
}

/** The caller's address as Vercel reports it. */
function clientOf(req) {
  const fwd = req && req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  return fwd ? String(fwd).split(',')[0].trim() : ((req && req.socket && req.socket.remoteAddress) || null);
}

async function holdForPaymentRequest(body, { test = false, client = null, startedAt = new Date() } = {}) {
  if (!test && rateLimited(client)) {
    console.warn('hold: too many holds from one client', client);
    return { ok: false, status: 429, payload: { error: HOLD_UNAVAILABLE_MESSAGE, reason: 'hold-rate-limited' } };
  }
  const { parseBookingDescription } = require('./lateBooking');
  const { totalDurationFor } = require('../config/serviceDurations');
  const { getCalendarClient } = require('./googleCalendar');
  const { REFRESH_MESSAGE } = require('./bookingRules');
  const parsed = parseBookingDescription(body && body.description);
  const stylistId = (body && body.staffName) || (parsed && parsed.stylistId);
  const phone = (body && body.phone) || (parsed && parsed.customerPhone);
  const start = parsed ? new Date(`${parsed.date}T${parsed.time}:00${SALON_TZ_OFFSET}`) : null;
  if (!parsed || !stylistId || !start || Number.isNaN(start.getTime()) || !String(phone || '').replace(/\D/g, '')) {
    return { ok: false, status: 422, payload: { error: REFRESH_MESSAGE, reason: 'hold-unreadable' } };
  }
  const resolved = totalDurationFor(body.selectedServices || body.serviceName || '');
  const minutes = resolved.resolved ? resolved.minutes : 60;
  let calendar;
  let result;
  try {
    calendar = await getCalendarClient();
    result = await placeHold(calendar, { stylistId, start, minutes, phone, services: body.selectedServices, test });
  } catch (err) {
    console.error('hold: calendar unavailable, no invoice made', stylistId, err.message || err);
    return { ok: false, status: 503, payload: { error: HOLD_UNAVAILABLE_MESSAGE, reason: 'hold-unavailable' } };
  }
  if (!result.ok) {
    if (result.reason === 'slot-taken') {
      return { ok: false, status: 409, payload: { error: SLOT_TAKEN_MESSAGE, slotTaken: true, reason: 'slot-taken' } };
    }
    return { ok: false, status: 422, payload: { error: REFRESH_MESSAGE, reason: `hold-${result.reason}` } };
  }
  if (!test) countHold(client);
  const calendarId = STYLIST_CONFIG[stylistId].calendarId;
  return {
    ok: true,
    holdId: result.holdId,
    expiresAt: result.expiresAt,
    release: () => releaseHold(calendar, { stylistId, start, phone }),
    // Call once the QR exists: deletes the hold when it expires unpaid.
    releaseWhenExpired: () => releaseAfterResponse(releaseWhenExpired(calendar, calendarId, result.holdId, result.expiresAt, {
      deadline: new Date(startedAt.getTime() + FUNCTION_BUDGET_MS),
    })),
  };
}

module.exports = {
  clientOf,
  _resetRateLimit: () => recentByClient.clear(),
  SLOT_TAKEN_MESSAGE,
  HOLD_UNAVAILABLE_MESSAGE,
  holdForPaymentRequest,
  HOLD_SECONDS,
  HOLD_GRACE_SECONDS,
  HOLD_PREFIX,
  holdIdFor,
  placeHold,
  releaseHold,
  releaseWhenExpired,
  findOwnHold,
  othersOverlapping,
  sweepExpiredHolds,
  isExpiredWebsiteHold,
};
