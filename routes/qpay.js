'use strict';

const express = require('express');
const { createInvoice } = require('../services/qpay');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG } = require('../config/stylists');

const router = express.Router();

/**
 * In-memory invoice status store.
 * Keys are QPay invoice IDs; values are { status, description, createdAt }.
 * Exported so that other route modules (e.g. webhooks) can share the same store.
 */
const paymentStatuses = {};

/**
 * Parse a QPay description string of the form:
 *   "Matrix Eco: {stylistId} - {date} {time} - {customerName} - {customerPhone}"
 *
 * @param {string} description
 * @returns {{ stylistId, date, time, customerName, customerPhone } | null}
 */
function parseDescription(description) {
  const match = /^Matrix Eco:\s*(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+-\s+(.+?)\s+-\s+(.+)$/.exec(
    description || '',
  );
  if (!match) return null;
  return {
    stylistId: match[1],
    date: match[2],
    time: match[3],
    customerName: match[4],
    customerPhone: match[5],
  };
}

/**
 * POST /api/qpay/create-payment
 *
 * Creates a QPay invoice for a booking payment.
 * Expects JSON body: { merchantId, amount, description }
 * Returns: { invoice_id: string, qr_image: <Base64 string>, urls: [ { name, link }, ... ] }
 */
router.post('/create-payment', async (req, res) => {
  const { merchantId, amount, description } = req.body || {};

  if (!merchantId || !amount || !description) {
    return res.status(400).json({
      error: 'merchantId, amount, and description are required',
    });
  }

  try {
    const callbackUrl = `${process.env.BASE_URL || 'https://mydomain.com'}/api/qpay/webhook`;
    const result = await createInvoice({ merchantId, amount, description, callbackUrl });

    // Track this invoice as PENDING so the polling endpoint can report its status
    if (result.invoice_id) {
      paymentStatuses[result.invoice_id] = {
        status: 'PENDING',
        description,
        createdAt: Date.now(),
      };
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('QPay API Error Details:', err.response?.data || err.message);
    return res.status(502).json({
      error: 'Failed to create QPay invoice',
      details: err.message || String(err),
    });
  }
});

/**
 * GET /api/qpay/check-payment/:invoiceId
 *
 * Polling endpoint: returns the current payment status for the given invoice.
 * Returns { status: 'PENDING' | 'PAID' | 'UNKNOWN' }.
 */
router.get('/check-payment/:invoiceId', (req, res) => {
  const { invoiceId } = req.params;
  const entry = paymentStatuses[invoiceId];
  if (!entry) {
    return res.status(200).json({ status: 'UNKNOWN' });
  }
  return res.status(200).json({ status: entry.status });
});

/**
 * POST /api/qpay/webhook
 *
 * Receives QPay's server-to-server payment callback.
 * Marks the invoice as PAID and creates a Google Calendar event from the
 * description embedded in the original invoice.
 */
router.post('/webhook', async (req, res) => {
  const payload = req.body || {};
  const invoiceId = payload.invoice_id || payload.id;

  if (!invoiceId) {
    console.warn('QPay webhook: missing invoice_id in payload', payload);
    return res.status(400).json({ error: 'Missing invoice_id in QPay callback payload' });
  }

  console.log('QPay webhook received for invoice:', invoiceId);

  // Mark as PAID in the in-memory store
  if (paymentStatuses[invoiceId]) {
    paymentStatuses[invoiceId].status = 'PAID';
  } else {
    paymentStatuses[invoiceId] = { status: 'PAID', description: null, createdAt: Date.now() };
  }

  // Attempt to create a Google Calendar event from the stored description
  const entry = paymentStatuses[invoiceId];
  const parsed = entry.description ? parseDescription(entry.description) : null;

  if (parsed) {
    const stylist = STYLIST_CONFIG[parsed.stylistId];
    if (stylist) {
      try {
        const calendar = await getCalendarClient();
        const startDateTime = new Date(`${parsed.date}T${parsed.time}:00+08:00`);
        const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

        await calendar.events.insert({
          calendarId: stylist.calendarId,
          requestBody: {
            summary: `Matrix Eco – ${parsed.customerName}`,
            description: `Phone: ${parsed.customerPhone}\nStylist: ${parsed.stylistId}`,
            start: { dateTime: startDateTime.toISOString() },
            end: { dateTime: endDateTime.toISOString() },
          },
        });

        console.log('Calendar event created for invoice:', invoiceId, 'stylist:', parsed.stylistId);
      } catch (calErr) {
        console.error('Failed to create calendar event from QPay webhook:', calErr.message || calErr);
        // Do not fail the webhook response — QPay must receive 200 to stop retrying
      }
    } else {
      console.warn('QPay webhook: unknown stylistId in description:', parsed.stylistId);
    }
  } else {
    console.warn('QPay webhook: could not parse description for invoice', invoiceId);
  }

  return res.status(200).json({ received: true, invoiceId });
});

module.exports = router;
module.exports.paymentStatuses = paymentStatuses;
