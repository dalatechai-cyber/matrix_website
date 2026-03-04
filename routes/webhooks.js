'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { STYLIST_CALENDAR_MAP } = require('../config/stylists');

const router = express.Router();

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

/**
 * Load OAuth2 client and authorise it using the saved token.
 * @returns {google.auth.OAuth2} Authenticated OAuth2 client
 */
async function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

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
    const auth = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

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
      resource: event,
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
