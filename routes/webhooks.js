'use strict';

const express = require('express');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CALENDAR_MAP } = require('../config/stylists');

const router = express.Router();

// Required fields in the webhook payload
const REQUIRED_FIELDS = [
  'paymentStatus',
  'customerName',
  'customerEmail',
  'customerPhone',
  'stylistId',
  'appointmentStartTime',
  'appointmentEndTime',
  'serviceName',
];

/**
 * POST /api/webhooks/payment-success
 *
 * Receives a payment success notification from the payment gateway (e.g. QPay)
 * and creates a Google Calendar event for the relevant stylist.
 */
router.post('/payment-success', async (req, res) => {
  const body = req.body;

  // Validate that all required fields are present
  const missingFields = REQUIRED_FIELDS.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missingFields.length > 0) {
    console.warn('Payment webhook: missing fields', missingFields);
    return res.status(400).json({
      error: 'Bad payload: missing required fields',
      missingFields,
    });
  }

  // Validate payment status
  if (body.paymentStatus !== 'PAID') {
    console.warn('Payment webhook: unexpected paymentStatus', body.paymentStatus);
    return res.status(400).json({
      error: `Bad payload: paymentStatus must be "PAID", received "${body.paymentStatus}"`,
    });
  }

  // Validate stylistId
  const calendarId = STYLIST_CALENDAR_MAP[body.stylistId];
  if (!calendarId) {
    console.warn('Payment webhook: unknown stylistId', body.stylistId);
    return res.status(400).json({
      error: `Bad payload: unknown stylistId "${body.stylistId}"`,
    });
  }

  try {
    const calendar = await getCalendarClient();

    const event = {
      summary: `${body.serviceName} - ${body.customerName}`,
      description: `Customer phone: ${body.customerPhone}\nCustomer email: ${body.customerEmail}`,
      start: {
        dateTime: body.appointmentStartTime,
      },
      end: {
        dateTime: body.appointmentEndTime,
      },
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });

    console.log('Calendar event created:', response.data.id, 'for stylist', body.stylistId);
    return res.status(200).json({
      message: 'Booking event created successfully',
      eventId: response.data.id,
    });
  } catch (err) {
    console.error('Failed to create calendar event:', err.message || err);
    return res.status(500).json({
      error: 'Failed to create calendar event',
      details: err.message || String(err),
    });
  }
});

module.exports = router;
