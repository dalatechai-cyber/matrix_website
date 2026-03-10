'use strict';

const express = require('express');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG } = require('../config/stylists');

const router = express.Router();

// Default appointment duration in minutes (used for all stylists unless overridden in STYLIST_CONFIG)
const DEFAULT_DURATION_MINUTES = 60;
// Mongolia uses Asia/Ulaanbaatar time (UTC+8, no DST)
const SALON_TZ_OFFSET = '+08:00';

// Hardcoded time slots for the manicurist (Г. Мөнхзаяа / Маникюр service).
// The gap between 16:00 and 18:00 is 120 min, so a simple +90-min loop would
// incorrectly produce 17:30 — these exact times must be used instead.
const MANICURE_SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '18:00'];

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
 * GET /api/calendar/available-slots?date=YYYY-MM-DD&stylistId=<id>
 *
 * Returns an array of available slot start times (e.g. ["10:00", "14:00"])
 * for the requested stylist on the requested date.
 * Mon–Sat: 10:00–20:00; Sun: 11:00–19:00.
 * Slot duration is 90 minutes for the manicurist (Г. Мөнхзаяа) and 60 minutes
 * for all other stylists.
 */
router.get('/available-slots', async (req, res) => {
  const { date, stylistId } = req.query;

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

  const { workStartHour, workEndHour } = getWorkHours(date);
  const durationMinutes = stylist.durationMinutes || DEFAULT_DURATION_MINUTES;
  const lastSlotStartHour = workEndHour - durationMinutes / 60;
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

    // Build the list of candidate slot times.
    // For the manicurist (Маникюр) use the hardcoded array; for all other
    // stylists generate on-the-hour slots from the normal business hours loop.
    const candidateSlots = (stylist.level === 'Маникюр')
      ? MANICURE_SLOTS
      : (() => {
          const slots = [];
          for (let h = workStartHour; h <= lastSlotStartHour; h++) {
            slots.push(`${String(h).padStart(2, '0')}:00`);
          }
          return slots;
        })();

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

    return res.status(200).json({ date, stylistId, availableSlots });
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
 * Appointment duration is 90 minutes for the manicurist (Г. Мөнхзаяа) and
 * 60 minutes for all other stylists.
 * This route contains the raw calendar insertion logic and will eventually
 * be triggered from the QPay payment webhook.
 *
 * Expected JSON body:
 *   { stylistId, startTime, customerName, customerPhone, customerEmail, serviceName }
 */
router.post('/book', async (req, res) => {
  const { stylistId, startTime, customerName, customerPhone, customerEmail, serviceName } = req.body || {};

  if (!stylistId || !startTime) {
    return res.status(400).json({ error: 'stylistId and startTime are required' });
  }

  const stylist = STYLIST_CONFIG[stylistId];
  if (!stylist) {
    return res.status(400).json({ error: `Unknown stylistId "${stylistId}"` });
  }

  try {
    const calendar = await getCalendarClient();

    const start = new Date(startTime);
    const durationMinutes = stylist.durationMinutes || DEFAULT_DURATION_MINUTES;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    const descriptionParts = [];
    if (customerPhone) descriptionParts.push(`Phone: ${customerPhone}`);
    if (customerEmail) descriptionParts.push(`Email: ${customerEmail}`);
    descriptionParts.push(`Price: ${stylist.price} MNT (${stylist.level})`);

    const summary = customerPhone
      ? `${customerPhone} - ${customerName || 'Customer'}`
      : (customerName || 'Customer');

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

    console.log('Calendar booking created:', response.data.id, 'for stylist', stylistId);
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
