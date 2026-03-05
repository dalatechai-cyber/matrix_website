'use strict';

const express = require('express');
const { createInvoice, checkPayment } = require('../services/qpay');
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
 * Create a Google Calendar event for a paid invoice, if not already created.
 * Idempotent: does nothing if the event was already created or description is missing.
 *
 * @param {string} invoiceId
 */
async function createCalendarEventForInvoice(invoiceId) {
  const entry = paymentStatuses[invoiceId];
  if (!entry || entry.calendarEventCreated) return;

  const parsed = entry.description ? parseDescription(entry.description) : null;
  if (!parsed) return;

  const stylist = STYLIST_CONFIG[parsed.stylistId];
  if (!stylist) {
    console.warn('createCalendarEventForInvoice: unknown stylistId in description:', parsed.stylistId);
    return;
  }

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

  entry.calendarEventCreated = true;
  console.log('Calendar event created for invoice:', invoiceId, 'stylist:', parsed.stylistId);
}

/**
 * POST /api/qpay/create-payment
 *
 * Creates a QPay invoice for a booking payment.
 * Expects JSON body: { name, phone, amount, description }
 *   - name: customer's full name
 *   - phone: customer's phone number
 *   - amount: payment amount in MNT (20000 or 10000 depending on hairdresser degree)
 *   - description: full booking description used internally for calendar event creation
 *     (e.g. "Matrix Eco: {stylistId} - {date} {time} - {name} - {phone}")
 * Returns: { invoice_id: string, qr_image: <Base64 string>, urls: [ { name, link }, ... ] }
 */
router.post('/create-payment', async (req, res) => {
  const { name, phone, amount, description, staffName } = req.body || {};

  if (!name || !phone || !amount || !description) {
    return res.status(400).json({
      error: 'name, phone, amount, and description are required',
    });
  }

  try {
    const callbackUrl = `${process.env.BASE_URL || 'https://mydomain.com'}/api/qpay/webhook`;
    // Sanitize amount: strip any non-numeric characters (e.g. "20,000 ₮" → 20000).
    // Amounts in MNT are always whole numbers so decimal points are not expected.
    const cleanAmount = Number(String(amount).replace(/[^0-9]/g, ''));
    if (!cleanAmount || isNaN(cleanAmount)) {
      return res.status(400).json({ error: 'amount must be a valid positive number' });
    }
    // The QPay invoice description shows only the customer name and phone.
    // The full booking description (with stylist/date/time) is stored internally
    // so the webhook can use it to create the Google Calendar event.
    // QPay enforces a 255-character limit on the description field.
    const cleanDescription = `${name || 'Үйлчлүүлэгч'} - ${phone || 'Утасгүй'}`.substring(0, 255);

    // Determine bank account based on selected staff member.
    // Payments for Г. Мөнхзаяа (manicurist) are routed to her personal account.
    let bankAccountsPayload;
    if (staffName && (staffName.includes('Мөнхзаяа') || staffName.includes('Маникюр'))) {
      bankAccountsPayload = [{
        account_bank_code: '050000',
        account_number: '5042384162',
        account_name: 'Ганбат Мөнхзаяа',
        is_default: true,
      }];
    } else {
      bankAccountsPayload = [{
        account_bank_code: '040000',
        account_number: '416055415',
        account_name: 'Эрхэмбаатар Оюунсүрэн',
        is_default: true,
      }];
    }

    const result = await createInvoice({ amount: cleanAmount, description: cleanDescription, callbackUrl, bankAccounts: bankAccountsPayload });

    // Track this invoice as PENDING so the polling endpoint can report its status.
    // Store the full booking description for calendar event creation on payment.
    if (result.invoice_id) {
      paymentStatuses[result.invoice_id] = {
        status: 'PENDING',
        description,
        calendarEventCreated: false,
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
    paymentStatuses[invoiceId] = { status: 'PAID', description: null, calendarEventCreated: false, createdAt: Date.now() };
  }

  // Attempt to create a Google Calendar event from the stored description
  try {
    await createCalendarEventForInvoice(invoiceId);
  } catch (calErr) {
    console.error('Failed to create calendar event from QPay webhook:', calErr.message || calErr);
    // Do not fail the webhook response — QPay must receive 200 to stop retrying
  }

  return res.status(200).json({ received: true, invoiceId });
});

/**
 * POST /api/qpay/check-payment
 *
 * Polling endpoint: checks the real-time QPay payment status for the given invoice.
 * Falls back to the in-memory store if QPay API is unreachable.
 * Triggers Google Calendar event creation when payment is confirmed as PAID.
 *
 * Expects JSON body: { invoice_id: string }
 * Returns: { invoice_status: 'PAID' | 'PENDING' | 'UNKNOWN' }
 */
router.post('/check-payment', async (req, res) => {
  const { invoice_id } = req.body || {};

  if (!invoice_id) {
    return res.status(400).json({ error: 'invoice_id is required' });
  }

  const entry = paymentStatuses[invoice_id];

  // If already confirmed PAID in memory, return immediately and ensure calendar event is created
  if (entry && entry.status === 'PAID') {
    try {
      await createCalendarEventForInvoice(invoice_id);
    } catch (calErr) {
      console.error('Failed to create calendar event on check-payment (already PAID):', calErr.message || calErr);
    }
    return res.status(200).json({ invoice_status: 'PAID' });
  }

  // Call QPay API directly to get real-time payment status
  try {
    const qpayData = await checkPayment(invoice_id);
    const invoiceStatus = qpayData.invoice_status;

    if (invoiceStatus === 'PAID') {
      // Mark as PAID in the in-memory store
      if (paymentStatuses[invoice_id]) {
        paymentStatuses[invoice_id].status = 'PAID';
      } else {
        paymentStatuses[invoice_id] = { status: 'PAID', description: null, calendarEventCreated: false, createdAt: Date.now() };
      }
      // Trigger Google Calendar booking as a fallback in case the webhook did not fire
      try {
        await createCalendarEventForInvoice(invoice_id);
      } catch (calErr) {
        console.error('Failed to create calendar event on check-payment (QPay PAID):', calErr.message || calErr);
      }
    }

    return res.status(200).json({ invoice_status: invoiceStatus || 'UNKNOWN' });
  } catch (err) {
    console.error('QPay check-payment error:', err.response?.data || err.message);
    // Fall back to in-memory status so the client is not left without a response
    const fallbackStatus = entry ? entry.status : 'UNKNOWN';
    return res.status(200).json({ invoice_status: fallbackStatus });
  }
});

module.exports = router;
module.exports.paymentStatuses = paymentStatuses;
