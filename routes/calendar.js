'use strict';

const express = require('express');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG } = require('../config/stylists');

const router = express.Router();

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 19;
const SLOT_DURATION_HOURS = 1;
// Last bookable slot starts at 18:00 and ends at 19:00 (WORK_END_HOUR)
const LAST_SLOT_START_HOUR = WORK_END_HOUR - SLOT_DURATION_HOURS;

/**
 * GET /api/calendar/available-slots?date=YYYY-MM-DD&stylistId=<id>
 *
 * Returns an array of available 1-hour slot start times (e.g. ["09:00", "14:00"])
 * for the requested stylist on the requested date, between 09:00 and 19:00.
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

  const timeMin = `${date}T${String(WORK_START_HOUR).padStart(2, '0')}:00:00Z`;
  const timeMax = `${date}T${String(WORK_END_HOUR).padStart(2, '0')}:00:00Z`;

  try {
    const calendar = await getCalendarClient();
    const freebusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: stylist.calendarId }],
      },
    });

    const busySlots = (freebusyResponse.data.calendars[stylist.calendarId] || {}).busy || [];

    // Build all possible 1-hour slot start hours (09, 10, …, 18)
    const availableSlots = [];
    for (let h = WORK_START_HOUR; h <= LAST_SLOT_START_HOUR; h++) {
      const slotStart = new Date(`${date}T${String(h).padStart(2, '0')}:00:00Z`);
      const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_HOURS * 60 * 60 * 1000);

      const isBusy = busySlots.some((busy) => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        // Overlap: slot starts before busy ends AND slot ends after busy starts
        return slotStart < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        availableSlots.push(`${String(h).padStart(2, '0')}:00`);
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
 * Creates a 1-hour Google Calendar event for the specified stylist.
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
    const end = new Date(start.getTime() + SLOT_DURATION_HOURS * 60 * 60 * 1000);

    const descriptionParts = [];
    if (customerPhone) descriptionParts.push(`Phone: ${customerPhone}`);
    if (customerEmail) descriptionParts.push(`Email: ${customerEmail}`);
    descriptionParts.push(`Price: ${stylist.price} MNT (${stylist.level})`);

    const event = {
      summary: `${serviceName || 'Appointment'} – ${customerName || 'Customer'}`,
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
