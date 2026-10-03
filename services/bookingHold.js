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
 *   id      'wh' + sha256(calendarId|startISO|phoneDigits)[0..40]
 *           — one per booking, so a renewed QR («Шинэ QR код авах») extends
 *           the same hold instead of adding a second one;
 *   private { taraHold: '1', holdExpiresAt: <ISO> }
 *
 * Then it looks at the window again. If anything else now overlaps (a booking,
 * a chat hold, another website hold), the hold is given back and no QR is made
 * — except a hold created strictly AFTER ours: that one sees ours and yields.
 * So two customers can never both reach a QR for one time.
 *
 * Paid: services/bookingWriter.js writes the `qb…` booking and deletes the
 * hold. Unpaid: the hold expires with the QR. Expired holds are deleted when
 * anyone next looks at that day's times, by create-payment, and by the daily
 * sweep (GET /api/calendar/sweep-holds); dala-ai treats an expired `wh` hold as
 * free. A late payment after expiry is still booked if the time is free, or
 * alerted if not (unchanged).
 *
 * The site has no database: the calendar event IS the hold.
 */

const HOLD_PREFIX = 'wh';
const HOLD_FLAG = 'taraHold';
// The QR's life on the booking page (assets/booking.js QPAY_QR_VALID_MS),
// plus a margin: the hold is placed a moment BEFORE the invoice, so without it
// the hold would end a second or two before the QR does.
const HOLD_MINUTES = 5;
const HOLD_GRACE_SECONDS = 30;
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
  return priv[HOLD_FLAG] === '1' || /^(wh|dh)/.test(String((e && e.id) || ''));
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

function holdBody({ id, stylistId, start, end, phone, services, expiresAt, test }) {
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
    extendedProperties: { private: { [HOLD_FLAG]: '1', holdExpiresAt: expiresAt.toISOString() } },
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
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60 * 1000 + HOLD_GRACE_SECONDS * 1000);
  // The customer's own booking for this time (paid on an earlier QR) is theirs.
  const { eventIdForBooking } = require('./bookingWriter');
  const ownIds = [id, eventIdForBooking(calendarId, start, phone)].filter(Boolean);

  if ((await othersOverlapping(calendar, calendarId, start, end, ownIds, now)).length > 0) {
    return { ok: false, reason: 'slot-taken' };
  }

  const body = holdBody({ id, stylistId, start, end, phone: String(phone).replace(/\D/g, ''), services, expiresAt, test });
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
  const ourCreated = new Date((mine && mine.created) || now);

  // Look again: someone may have taken an overlapping time meanwhile.
  const others = await othersOverlapping(calendar, calendarId, start, end, ownIds, now);
  const winners = others.filter((e) => !(isHoldEvent(e) && new Date(e.created || 0) > ourCreated));
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
    const items = await listWindow(calendar, calendarId, from, to, extra);
    for (const e of items) {
      if (isExpiredWebsiteHold(e, now) && await deleteQuietly(calendar, calendarId, e.id)) deleted += 1;
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
async function holdForPaymentRequest(body, { test = false } = {}) {
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
  return {
    ok: true,
    holdId: result.holdId,
    expiresAt: result.expiresAt,
    release: () => releaseHold(calendar, { stylistId, start, phone }),
  };
}

module.exports = {
  SLOT_TAKEN_MESSAGE,
  HOLD_UNAVAILABLE_MESSAGE,
  holdForPaymentRequest,
  HOLD_MINUTES,
  HOLD_PREFIX,
  holdIdFor,
  placeHold,
  releaseHold,
  findOwnHold,
  othersOverlapping,
  sweepExpiredHolds,
  isExpiredWebsiteHold,
};
