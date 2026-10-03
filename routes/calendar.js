'use strict';

const express = require('express');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG } = require('../config/stylists');
const { getClosures, findClosure, salonDateOf } = require('../config/closures');
const { totalDurationFor } = require('../config/serviceDurations');
const { normalizeCustomerGender, checkGenderMatch } = require('../services/bookingRules');
const { ensurePaidBooking, alertBookingFailure } = require('../services/bookingWriter');
const { sweepExpiredHolds } = require('../services/bookingHold');

const { blockedByMaintenance, MAINTENANCE_MESSAGE, isTestRequest } = require('../config/siteMode');
const { branchOfStylist, branchReadiness, workHoursFor, normalizeBranchId } = require('../config/branches');

const router = express.Router();

// Fallback appointment length in minutes, used only when the request names no
// services at all (an older client, or a direct call). Real bookings resolve
// their length from config/serviceDurations.js instead.
const DEFAULT_DURATION_MINUTES = 60;
// Mongolia uses Asia/Ulaanbaatar time (UTC+8, no DST)
const SALON_TZ_OFFSET = '+08:00';

/**
 * Returns the salon's opening and closing hour for the given YYYY-MM-DD date.
 * Mon–Sat: 10:00–20:00  (last bookable slot starts at 19:00)
 * Sun:     11:00–19:00  (last bookable slot starts at 18:00)
 *
 * @param {string} dateStr  YYYY-MM-DD in salon local time (Ulaanbaatar, UTC+8)
 * @returns {{ workStartHour: number, workEndHour: number }}
 */
function getWorkHours(dateStr) {
  // Use noon Ulaanbaatar time so the UTC equivalent stays on the same calendar
  // date (midnight UTC+8 = previous day 16:00 UTC, which would give the wrong
  // weekday when calling getUTCDay() on a UTC server).
  const dayOfWeek = new Date(`${dateStr}T12:00:00${SALON_TZ_OFFSET}`).getUTCDay();
  if (dayOfWeek === 0) {
    // Sunday
    return { workStartHour: 11, workEndHour: 19 };
  }
  // Monday–Saturday
  return { workStartHour: 10, workEndHour: 20 };
}

/**
 * How long this appointment will occupy the chair, in minutes.
 *
 * The customer's selected services decide it, resolved here from
 * config/serviceDurations.js. A duration sent by the browser is deliberately
 * NOT trusted: it is the figure that decides how much of a stylist's day gets
 * blocked, so an unverified number would let anyone reserve a whole day, and
 * a short one would re-open a slot the salon cannot actually honour. A service
 * missing from the catalogue is charged the default and reported, never zero.
 *
 * `fallbackMinutes` is used only when no services are named at all.
 *
 * @param {{ services?: string|string[], fallbackMinutes: number }} args
 * @returns {{ minutes: number, unknown: string[], source: 'services'|'fallback' }}
 */
function resolveDurationMinutes({ services, fallbackMinutes }) {
  const resolved = totalDurationFor(services);
  if (!resolved.resolved) {
    return { minutes: fallbackMinutes, unknown: [], source: 'fallback' };
  }
  return { minutes: resolved.minutes, unknown: resolved.unknown, source: 'services' };
}

/**
 * GET /api/calendar/closures
 *
 * Returns the salon-wide closure periods currently in force, so the booking UI
 * can mark closed days before the customer picks one. Purely informational:
 * every booking and payment path enforces closures independently of this.
 *
 * Returns: { closures: [ { start, end, title, message, reopenDate }, ... ] }
 */
router.get('/closures', (_req, res) => {
  return res.status(200).json({ closures: getClosures() });
});

/**
 * GET /api/calendar/available-slots?date=YYYY-MM-DD&stylistId=<id>&services=A,B,C
 *
 * Returns the start times the stylist can actually honour on that date —
 * i.e. the times where the customer's whole appointment fits.
 *
 * `services` is the customer's current selection; its total length (see
 * config/serviceDurations.js) decides two things:
 *   1. how late the last start can be — a 4-hour service cannot start at 18:00
 *      on a day the salon closes at 20:00, so those starts are not offered; and
 *   2. how far ahead a conflict counts — a 4-hour appointment starting at 14:00
 *      collides with an existing 17:00 booking.
 * Omitting `services` keeps the previous behaviour (the stylist's slot length).
 *
 * Start times are offered on the hour.
 * Mon–Sat: 10:00–20:00; Sun: 11:00–19:00.
 * A date inside a salon closure returns no slots at all, plus the `closure`
 * that covers it, regardless of what the stylist's calendar says.
 */
router.get('/available-slots', async (req, res) => {
  const { date, stylistId, services } = req.query;

  // Maintenance: offer no times (the pages already show the notice; this
  // covers a tab opened before it was switched on).
  if (blockedByMaintenance(req)) {
    return res.status(503).json({ error: MAINTENANCE_MESSAGE, maintenance: true });
  }

  if (!date || !stylistId) {
    return res.status(400).json({ error: 'date and stylistId query parameters are required' });
  }

  // Basic ISO-date format validation (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  const stylist = STYLIST_CONFIG[stylistId];
  if (!stylist) {
    return res.status(400).json({ error: `Unknown stylistId "${stylistId}"` });
  }

  // Times are offered only at the hairdresser's own branch, and only once
  // that branch takes online bookings (config/branches.js).
  const branch = branchOfStylist(stylistId);
  if (req.query.branch != null && req.query.branch !== '' && normalizeBranchId(req.query.branch) !== branch) {
    return res.status(400).json({ error: 'Hairdresser does not work at this branch' });
  }
  const readiness = branchReadiness(branch);
  if (!readiness.ready) {
    return res.status(409).json({ error: 'Branch is not taking online bookings yet', reason: readiness.reason });
  }
  // A retired hairdresser, or one whose calendar is not connected yet, offers
  // no times (config/stylists.js).
  if (stylist.retired || !stylist.calendarId) {
    return res.status(409).json({ error: 'Hairdresser is not taking online bookings', reason: stylist.retired ? 'stylist-retired' : 'stylist-not-connected' });
  }

  // The salon is shut salon-wide on this date: offer nothing, whatever the
  // stylist's calendar happens to say. This is deliberately a 200 with an empty
  // list rather than an error — the booking UI falls back to showing full
  // business hours when this endpoint fails, which would re-expose the closed day.
  const closure = findClosure(date);
  if (closure) {
    return res.status(200).json({ date, stylistId, availableSlots: [], closure });
  }

  // The branch's own opening hours; Яармаг's are the ones getWorkHours has
  // always used.
  const { workStartHour, workEndHour } = workHoursFor(branch, date) || getWorkHours(date);
  const { minutes: durationMinutes, unknown } = resolveDurationMinutes({
    services,
    // No services named: keep the stylist's usual slot length, so an older
    // client that asks without a selection sees exactly what it always saw.
    fallbackMinutes: stylist.durationMinutes || DEFAULT_DURATION_MINUTES,
  });
  if (unknown.length > 0) {
    // Not fatal — an unknown name is charged the default — but it means the
    // booking UI and data/serviceDurations.json have drifted apart.
    console.warn('available-slots: no duration configured for service(s):', unknown.join(', '));
  }
  const timeMin = `${date}T${String(workStartHour).padStart(2, '0')}:00:00${SALON_TZ_OFFSET}`;
  const timeMax = `${date}T${String(workEndHour).padStart(2, '0')}:00:00${SALON_TZ_OFFSET}`;

  try {
    const calendar = await getCalendarClient();
    // A website hold whose QR ran out is free: delete it before reading busy
    // time, so the time is offered again at once (services/bookingHold.js).
    try {
      await sweepExpiredHolds(calendar, [stylist.calendarId], { from: new Date(timeMin), to: new Date(timeMax) });
    } catch (err) {
      console.warn('available-slots: could not clear expired holds', err.message || err);
    }
    const freebusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: stylist.calendarId }],
      },
    });

    const calendarResult = (freebusyResponse.data.calendars || {})[stylist.calendarId] || {};
    if (calendarResult.errors && calendarResult.errors.length > 0) {
      const reasons = calendarResult.errors.map((e) => e.reason).join(', ');
      throw new Error(`Calendar access error for "${stylistId}": ${reasons}`);
    }
    const busySlots = calendarResult.busy || [];

    // Candidate start times: on the hour, but never later than a start whose
    // appointment would still be running at closing time. This is what stops an
    // 18:00 start being offered for a 4-hour service on a day the salon shuts at
    // 20:00; with a 1-hour service the last start is 19:00 as before.
    const stepMinutes = 60;
    const openMinutes = workStartHour * 60;
    const closeMinutes = workEndHour * 60;
    const lastStartMinutes = closeMinutes - durationMinutes;

    const candidateSlots = [];
    for (let t = openMinutes; t <= lastStartMinutes; t += stepMinutes) {
      const h = Math.floor(t / 60);
      const m = t % 60;
      candidateSlots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }

    const now = new Date();
    const availableSlots = [];
    for (const slotStr of candidateSlots) {
      const [slotHour, slotMinute] = slotStr.split(':').map(Number);
      const slotStart = new Date(
        `${date}T${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}:00${SALON_TZ_OFFSET}`
      );

      // Skip slots that have already started
      if (slotStart < now) continue;

      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

      // A conflict is anything overlapping the WHOLE appointment, not just its
      // first hour: a 4-hour booking at 14:00 collides with an existing 17:00 one.
      const isBusy = busySlots.some((busy) => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        // Overlap: slot starts before busy ends AND slot ends after busy starts
        return slotStart < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        availableSlots.push(slotStr);
      }
    }

    return res.status(200).json({ date, stylistId, availableSlots, durationMinutes });
  } catch (err) {
    console.error('Failed to check calendar availability:', err.message || err);
    return res.status(500).json({
      error: 'Failed to check calendar availability',
      details: err.message || String(err),
    });
  }
});

/**
 * GET /api/calendar/sweep-holds
 *
 * Deletes website holds whose QR has run out, on every connected calendar
 * (every hold written in the last three days, whatever its day). Run daily by Vercel Cron
 * (vercel.json); expired holds are also cleared whenever a day's times are
 * read, so this is housekeeping, not what frees a time. When CRON_SECRET is
 * set, only a request carrying it (Vercel Cron sends it) is served.
 */
router.get('/sweep-holds', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const calendarIds = [...new Set(Object.values(STYLIST_CONFIG).map((c) => c.calendarId).filter(Boolean))];
  const now = new Date();
  try {
    const calendar = await getCalendarClient();
    const deleted = await sweepExpiredHolds(calendar, calendarIds, { updatedSince: new Date(now.getTime() - 3 * 86400000), now });
    console.log('sweep-holds: deleted', deleted, 'expired hold(s) on', calendarIds.length, 'calendar(s)');
    return res.status(200).json({ deleted, calendars: calendarIds.length });
  } catch (err) {
    console.error('sweep-holds failed:', err.message || err);
    return res.status(500).json({ error: 'sweep failed' });
  }
});

/**
 * POST /api/calendar/book
 *
 * Creates a Google Calendar event for the specified stylist.
 *
 * The event's length is the real length of the services booked, for EVERY
 * stylist — not a flat hour. This matters beyond the one appointment: the event
 * is what /available-slots reads back as busy time, so a 4-hour colour written
 * as a 1-hour event would leave the following three hours bookable by someone
 * else. Duration is resolved server-side from `selectedServices`; the client's
 * `totalDuration` is accepted only where it is longer (see resolveDurationMinutes).
 *
 * The event also records, for the owner, the customer's gender and when they
 * agreed that the deposit is not refunded for a cancellation or no-show — the
 * record to show if a customer later disputes it.
 *
 * This runs AFTER the deposit is paid, so it refuses as little as possible: a
 * request with no gender or no agreement (a tab still on an older script.js)
 * is booked and marked as such rather than leaving a paid customer with no
 * appointment. Only an explicit gender mismatch is refused — create-payment
 * already refuses one, so no genuine payment can lead here with it.
 *
 * Expected JSON body:
 *   { stylistId, startTime, customerName, customerPhone, customerEmail, serviceName, selectedServices, totalDuration,
 *     customerGender, depositTermsAccepted, depositTermsAcceptedAt, invoiceId }
 */
router.post('/book', async (req, res) => {
  const {
    stylistId, startTime, customerName, customerPhone, customerEmail, serviceName, selectedServices,
    customerGender, depositTermsAccepted, depositTermsAcceptedAt, invoiceId,
  } = req.body || {};

  if (!stylistId || !startTime) {
    return res.status(400).json({ error: 'stylistId and startTime are required' });
  }

  const stylist = STYLIST_CONFIG[stylistId];
  if (!stylist) {
    return res.status(400).json({ error: `Unknown stylistId "${stylistId}"` });
  }

  // Never put an appointment on the calendar for a day the salon is shut.
  const bookingDate = salonDateOf(startTime);
  const closure = bookingDate && findClosure(bookingDate);
  if (closure) {
    return res.status(409).json({
      error: 'Salon is closed on the requested date',
      closure,
    });
  }

  // The calendar is the hairdresser's, so the booking lands at their branch
  // whatever the page said; a disagreement is logged for a person to look at.
  const stylistBranch = branchOfStylist(stylistId);
  if (req.body.branch && normalizeBranchId(req.body.branch) !== stylistBranch) {
    console.error('book: page named branch', req.body.branch, 'but', stylistId, 'works at', stylistBranch);
  }
  // A branch not taking online bookings has issued no invoice from this site,
  // so no browser can legitimately arrive here for it. (A payment QPay
  // confirms is still booked by /api/qpay/late-payment.)
  const readiness = branchReadiness(stylistBranch);
  if (!readiness.ready) {
    console.error('book: refused, branch not taking online bookings', stylistBranch, readiness.reason, stylistId);
    return res.status(409).json({ error: 'Branch is not taking online bookings yet', reason: readiness.reason });
  }

  const gender = normalizeCustomerGender(customerGender);
  if (gender) {
    const genderCheck = checkGenderMatch({ stylistId, customerGender: gender });
    if (!genderCheck.allowed && genderCheck.reason === 'gender-mismatch') {
      console.error('book: refused gender mismatch', stylistId, gender);
      return res.status(422).json({ error: 'Hairdresser does not serve this customer', reason: genderCheck.reason });
    }
  } else {
    console.warn('book: no customer gender recorded for booking with', stylistId);
  }

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'startTime is not a valid date' });
  }
  const booking = {
    stylistId,
    start,
    services: selectedServices || serviceName || '',
    customerName,
    customerPhone,
    customerEmail,
    customerGender: gender,
    depositTermsAccepted,
    depositTermsAcceptedAt,
    invoiceId,
    // Made from the tester's browser (signed test cookie): marked «ТЕСТ».
    test: isTestRequest(req),
  };

  try {
    const calendar = await getCalendarClient();
    // The deposit is the stylist's tier price (the same figure the page charged).
    const result = await ensurePaidBooking(calendar, booking, { amount: stylist.price });
    if (result.status === 'conflict') {
      // The customer has paid, but the slot went to someone else in the
      // meantime. Staff have been alerted to arrange a time; tell the browser
      // so the customer is not shown a confirmation for a slot they lack.
      return res.status(409).json({ error: 'Slot no longer free', conflict: true });
    }
    return res.status(200).json({
      message: 'Booking created successfully',
      eventId: result.eventId,
      alreadyBooked: result.status === 'already-booked',
    });
  } catch (err) {
    console.error('Failed to create calendar booking:', err.message || err);
    // Only a paid customer's browser gets here; they now hold a receipt and no
    // appointment. Make sure a person knows.
    await alertBookingFailure({ ...booking, amount: stylist.price, error: err.message || err });
    return res.status(500).json({
      error: 'Failed to create calendar booking',
      details: err.message || String(err),
    });
  }
});

module.exports = router;
