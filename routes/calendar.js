'use strict';

const express = require('express');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG } = require('../config/stylists');
const { getClosures, findClosure, salonDateOf } = require('../config/closures');
const { totalDurationFor } = require('../config/serviceDurations');

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
 * `fallbackMinutes` is used only when no services are named at all — the caller
 * chooses it, because the two callers mean different things by "unknown":
 * availability wants the stylist's usual slot length, a booking wants a whole
 * hour rather than the manicurist's 30-minute slot spacing.
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
 * Start times are still offered on the stylist's usual grid: on the hour for
 * hairdressers, every 30 minutes for the manicurist (Г. Мөнхзаяа).
 * Mon–Sat: 10:00–20:00; Sun: 11:00–19:00.
 * A date inside a salon closure returns no slots at all, plus the `closure`
 * that covers it, regardless of what the stylist's calendar says.
 */
router.get('/available-slots', async (req, res) => {
  const { date, stylistId, services } = req.query;

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

  // The salon is shut salon-wide on this date: offer nothing, whatever the
  // stylist's calendar happens to say. This is deliberately a 200 with an empty
  // list rather than an error — the booking UI falls back to showing full
  // business hours when this endpoint fails, which would re-expose the closed day.
  const closure = findClosure(date);
  if (closure) {
    return res.status(200).json({ date, stylistId, availableSlots: [], closure });
  }

  const { workStartHour, workEndHour } = getWorkHours(date);
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

    // Candidate start times: the stylist's usual grid — every 30 minutes for the
    // manicurist, on the hour for hairdressers — but never later than a start
    // whose appointment would still be running at closing time. This is what
    // stops an 18:00 start being offered for a 4-hour service on a day the salon
    // shuts at 20:00; with a 1-hour service the last start is 19:00 as before.
    const stepMinutes = stylist.level === 'Маникюр' ? 30 : 60;
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
 * Expected JSON body:
 *   { stylistId, startTime, customerName, customerPhone, customerEmail, serviceName, selectedServices, totalDuration }
 */
router.post('/book', async (req, res) => {
  const { stylistId, startTime, customerName, customerPhone, customerEmail, serviceName, selectedServices, totalDuration } = req.body || {};

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

  try {
    const calendar = await getCalendarClient();

    const start = new Date(startTime);
    const { minutes: durationMinutes, unknown } = resolveDurationMinutes({
      services: selectedServices || serviceName,
      // A booking with no identifiable service is given a full hour, not the
      // manicurist's 30-minute slot spacing — that number is a grid step, not
      // an appointment length.
      fallbackMinutes: DEFAULT_DURATION_MINUTES,
    });
    if (unknown.length > 0) {
      console.warn('book: no duration configured for service(s):', unknown.join(', '));
    }
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    const descriptionParts = [];
    if (customerName) descriptionParts.push(`Name: ${customerName}`);
    if (customerPhone) descriptionParts.push(`Phone: ${customerPhone}`);
    if (customerEmail) descriptionParts.push(`Email: ${customerEmail}`);
    descriptionParts.push(`Price: ${stylist.price} MNT (${stylist.level})`);
    // Written out so the stylist can see the length the slot was reserved for,
    // and spot a service whose configured duration does not match reality.
    descriptionParts.push(`Duration: ${durationMinutes} min`);

    const services = selectedServices || serviceName || '';
    const summary = customerPhone
      ? `${customerPhone} - ${services || customerName || 'Appointment'}`
      : (services || customerName || 'Appointment');

    const event = {
      summary,
      description: descriptionParts.join('\n'),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };

    const response = await calendar.events.insert({
      calendarId: stylist.calendarId,
      requestBody: event,
    });

    console.log(
      'Calendar booking created:', response.data.id,
      'for stylist', stylistId,
      `(${durationMinutes} min)`,
    );
    return res.status(200).json({
      message: 'Booking created successfully',
      eventId: response.data.id,
    });
  } catch (err) {
    console.error('Failed to create calendar booking:', err.message || err);
    return res.status(500).json({
      error: 'Failed to create calendar booking',
      details: err.message || String(err),
    });
  }
});

module.exports = router;
