'use strict';

const express = require('express');
const { createInvoice, checkPayment, getInvoice, getPayment, isPaidCheck } = require('../services/qpay');
const { getCalendarClient } = require('../services/googleCalendar');
const { STYLIST_CONFIG } = require('../config/stylists');
const { checkPaymentRequest } = require('../services/closureGuard');
const { holdForPaymentRequest } = require('../services/bookingHold');
const { checkPaymentBookingRules, consentTime, REFRESH_MESSAGE } = require('../services/bookingRules');
const { callbackUrlForPayment, publicOrigin, decodeCallback } = require('../services/lateBooking');
const { ensurePaidBooking, alertBookingFailure, hasBookingForPhone } = require('../services/bookingWriter');
const { sendSalonAlert } = require('../services/telegram');
const { findClosure } = require('../config/closures');
const { totalDurationFor } = require('../config/serviceDurations');

const { blockedByMaintenance, MAINTENANCE_MESSAGE, depositFor, isTestRequest } = require('../config/siteMode');
const { resolveBookingBranch, qpayAccountFor, normalizeBranchId, branchOfStylist, DEFAULT_BRANCH } = require('../config/branches');

const BRANCH_NOT_READY_MESSAGE = 'Энэ салбарт онлайн захиалга хараахан нээгдээгүй байна. Салбарын утсаар холбогдоно уу.';

const router = express.Router();

// Used only when an invoice carries no service list (older invoice, or a direct
// call); real bookings resolve their length from config/serviceDurations.js.
const DEFAULT_DURATION_MINUTES = 60;

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

  // create-payment refuses to invoice for a closed date, so an invoice for one
  // should not exist. If it somehow does, the appointment still does not go on
  // the calendar — and it is logged loudly, because it would mean money was
  // taken for a day the salon is shut and someone has to refund it.
  const closure = findClosure(parsed.date);
  if (closure) {
    console.error(
      'PAID invoice for a CLOSED salon date — refusing to book, needs a refund:',
      invoiceId, parsed.date, parsed.customerPhone,
    );
    return;
  }

  const calendar = await getCalendarClient();
  const startDateTime = new Date(`${parsed.date}T${parsed.time}:00+08:00`);
  // Length of the services booked, not a flat hour: this event is read back as
  // busy time by /available-slots, so a 4-hour colour recorded as 1 hour would
  // leave the following three hours bookable by someone else. The services are
  // captured on the invoice at create-payment time (entry.services).
  const resolved = totalDurationFor(entry.services);
  const durationMinutes = resolved.resolved
    ? resolved.minutes
    : (stylist.durationMinutes || DEFAULT_DURATION_MINUTES);
  const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

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
 *   - staffName, customerGender, depositTermsAccepted: required by
 *     services/bookingRules.js — refused with 422 otherwise, before QPay is called
 * Returns: { invoice_id: string, qr_image: <Base64 string>, urls: [ { name, link }, ... ] }
 */
router.post('/create-payment', async (req, res) => {
  const { name, phone, amount, description, staffName, selectedServices, serviceName } = req.body || {};

  // Maintenance: no new invoices (payments already made are still honoured).
  if (blockedByMaintenance(req)) {
    return res.status(503).json({ error: MAINTENANCE_MESSAGE, maintenance: true });
  }

  if (!name || !phone || !amount || !description) {
    return res.status(400).json({
      error: 'name, phone, amount, and description are required',
    });
  }

  // Refuse to invoice for an appointment inside a salon closure. Runs after the
  // required-field check above so a malformed request still reports what is
  // missing. With no closure configured this always passes.
  const closureCheck = checkPaymentRequest(req.body || {});
  if (!closureCheck.allowed) {
    console.warn('Blocked QPay invoice for closed salon date:', closureCheck.date, closureCheck.reason);
    return res.status(409).json({
      error: 'Salon is closed on the requested date',
      reason: closureCheck.reason,
      closure: closureCheck.closure,
    });
  }

  // Same rules as the standalone handler (services/bookingRules.js): the
  // hairdresser must match the customer's gender, and the customer must have
  // agreed the deposit is non-refundable, before any invoice exists.
  const rulesCheck = checkPaymentBookingRules(req.body || {});
  if (!rulesCheck.allowed) {
    console.warn('Blocked QPay invoice by booking rules:', rulesCheck.reason, staffName);
    return res.status(422).json({ error: REFRESH_MESSAGE, reason: rulesCheck.reason });
  }

  // Same as the standalone handler: the hairdresser decides the branch, the
  // branch decides the QPay account; no invoice for a branch not yet connected.
  const branchCheck = resolveBookingBranch({ stylistId: staffName, branch: req.body.branch });
  if (!branchCheck.ok) {
    console.warn('Blocked QPay invoice by branch:', branchCheck.reason, staffName);
    return res.status(409).json({ error: BRANCH_NOT_READY_MESSAGE, reason: branchCheck.reason });
  }
  const account = qpayAccountFor(branchCheck.branch);

  // Same 5-minute hold as the standalone handler (services/bookingHold.js).
  const hold = await holdForPaymentRequest(req.body || {}, { test: isTestRequest(req) });
  if (!hold.ok) {
    console.warn('Blocked QPay invoice by hold:', hold.payload.reason, staffName);
    return res.status(hold.status).json(hold.payload);
  }

  try {
    const consent = consentTime(req.body.depositTermsAcceptedAt);
    // The signed late-payment callback (services/lateBooking.js), as in the
    // standalone handler; the old in-memory webhook only when it cannot be built.
    // The browser still sends an amount; a malformed one is refused, but the
    // amount charged is the server's: the stylist's price, or 100₮ only for
    // the tester's signed cookie (config/siteMode.js).
    const sentAmount = Number(String(amount).replace(/[^0-9]/g, ''));
    if (!sentAmount || isNaN(sentAmount)) {
      await hold.release();
      return res.status(400).json({ error: 'amount must be a valid positive number' });
    }
    const cleanAmount = depositFor(req, staffName);
    if (!cleanAmount) { await hold.release(); return res.status(422).json({ error: 'Unknown stylist' }); }
    const callbackUrl = callbackUrlForPayment(publicOrigin(req), req.body, { agreedAt: consent.at, amount: cleanAmount, test: isTestRequest(req) })
      || `${process.env.BASE_URL || 'https://mydomain.com'}/api/qpay/webhook`;
    // The QPay invoice description shows only the customer name and phone.
    // The full booking description (with stylist/date/time) is stored internally
    // so the webhook can use it to create the Google Calendar event.
    // QPay enforces a 255-character limit on the description field.
    const cleanDescription = `${name || 'Үйлчлүүлэгч'} - ${phone || 'Утасгүй'}`.substring(0, 255);

    const result = await createInvoice({
      amount: cleanAmount, description: cleanDescription, callbackUrl, bankAccounts: account.bankAccounts, account,
    });

    // Track this invoice as PENDING so the polling endpoint can report its status.
    // Store the full booking description for calendar event creation on payment.
    console.log('Deposit terms accepted:', JSON.stringify({
      invoice_id: result.invoice_id,
      branch: branchCheck.branch,
      staffName,
      customerGender: rulesCheck.customerGender,
      bookingDate: req.body.bookingDate,
      acceptedAt: consent.at.toISOString(),
      acceptedAtSource: consent.source,
    }));
    if (result.invoice_id) {
      paymentStatuses[result.invoice_id] = {
        status: 'PENDING',
        description,
        // Kept so the calendar event created on payment can be as long as the
        // services actually booked. The description format carries no services.
        services: selectedServices || serviceName || '',
        calendarEventCreated: false,
        createdAt: Date.now(),
      };
    }

    return res.status(200).json({ ...result, hold_expires_at: hold.expiresAt.toISOString() });
  } catch (err) {
    console.error('QPay API Error Details:', err.response?.data || err.message);
    await hold.release();
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
  // Asked of the QPay account the invoice was created on. A page from before
  // branches existed sends no branch: that is Яармаг, the only branch then.
  const branch = req.body && req.body.branch != null ? normalizeBranchId(req.body.branch) : DEFAULT_BRANCH;
  if (!branch) return res.status(400).json({ error: 'unknown branch' });

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
    const qpayData = await checkPayment(invoice_id, qpayAccountFor(branch));
    // QPay v2 /payment/check reports payment in `rows[].payment_status` (the
    // shape script.js has always checked for) and may carry no top-level
    // `invoice_status` at all. Reading only the latter would answer UNKNOWN
    // for an invoice the customer has paid, leaving them at the QR with no
    // booking made.
    const invoiceStatus = (qpayData && qpayData.invoice_status) || (isPaidCheck(qpayData) ? 'PAID' : undefined);

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

/**
 * GET|POST /api/qpay/late-payment?b=<booking token>&h=<signature>
 *
 * QPay's payment callback for every invoice the site creates (the URL is set
 * as the invoice's callback_url; see services/lateBooking.js). It is what
 * books a customer whose browser is no longer watching — they paid after the
 * page stopped polling, or closed it. When the browser did book, this finds
 * that booking and does nothing (both write the same calendar event id).
 *
 * The outcome for a paid invoice is always one of: the appointment on the
 * calendar, or the salon alerted on Telegram with the customer's details.
 * Answers 200 once handled so QPay stops retrying.
 */
router.all('/late-payment', async (req, res) => {
  const booking = decodeCallback(req.query.b, req.query.h);
  if (!booking) {
    console.warn('late-payment: rejected callback with an invalid booking token');
    return res.status(403).json({ error: 'invalid callback' });
  }

  // The signed booking names the hairdresser, and so the branch whose QPay
  // account the invoice is on.
  const branch = branchOfStylist(booking.stylistId);
  if (!branch) {
    // A hairdresser with no branch cannot be checked against any account;
    // never guess one. A person has to look.
    console.error('late-payment: hairdresser has no branch', booking.stylistId);
    await sendSalonAlert([
      '⚠️ QPay-с төлбөрийн мэдэгдэл ирсэн боловч үсчний салбар тодорхойгүй',
      `Утас: ${booking.customerPhone || '—'}, үсчин ${booking.stylistId}, ${booking.date} ${booking.time}`,
      'QPay дээр төлбөрийг шалгаад, төлөгдсөн бол цагийг гараар бүртгэнэ үү.',
    ].join('\n'));
    return res.status(200).json({ received: true, handled: 'alerted-no-branch' });
  }
  const account = qpayAccountFor(branch);
  const alertOpts = { branch };

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const pick = (...vals) => vals.map((v) => (v == null ? '' : String(v).trim())).find(Boolean) || null;
  let invoiceId = pick(body.object_id, body.invoice_id, body.id, req.query.object_id, req.query.invoice_id);
  const paymentId = pick(body.payment_id, req.query.qpay_payment_id, req.query.payment_id);
  console.log('late-payment: QPay callback', JSON.stringify({
    invoiceId, paymentId, bodyKeys: Object.keys(body), queryKeys: Object.keys(req.query),
    stylistId: booking.stylistId, date: booking.date, time: booking.time,
  }));

  // QPay may name only the payment; its record names the invoice.
  if (!invoiceId && paymentId) {
    try {
      const payment = await getPayment(paymentId, account);
      invoiceId = pick(payment && payment.object_id, payment && payment.invoice_id);
    } catch (err) {
      console.warn('late-payment: payment lookup failed', paymentId, err.message || err);
    }
  }

  const details = { ...booking, services: booking.services, amount: booking.amount, invoiceId };
  if (!invoiceId) {
    // Nothing to verify the payment against, so nothing is booked from it. If
    // the browser already booked this customer into this slot, all is well;
    // otherwise a person has to look.
    try {
      const calendar = await getCalendarClient();
      if (await hasBookingForPhone(calendar, booking.stylistId, booking.start, booking.customerPhone)) {
        return res.status(200).json({ received: true, handled: 'already-booked' });
      }
    } catch (err) {
      console.warn('late-payment: could not look for an existing booking', err.message || err);
    }
    // Nothing to verify the payment against. Do not book on an unverified
    // claim, but make sure a person looks.
    await sendSalonAlert([
      '⚠️ QPay-с төлбөрийн мэдэгдэл ирсэн боловч нэхэмжлэлийн дугаар алга',
      `Утас: ${booking.customerPhone || '—'}, үсчин ${booking.stylistId}, ${booking.date} ${booking.time}`,
      'QPay дээр төлбөрийг шалгаад, төлөгдсөн бол цагийг гараар бүртгэнэ үү.',
    ].join('\n'), alertOpts);
    return res.status(200).json({ received: true, handled: 'alerted-no-invoice-id' });
  }

  let paid;
  try {
    paid = isPaidCheck(await checkPayment(invoiceId, account));
  } catch (err) {
    console.error('late-payment: could not confirm payment with QPay', invoiceId, err.message || err);
    // Let QPay retry; a person checks meanwhile in case it never does.
    await sendSalonAlert([
      '⚠️ QPay-н төлбөрийг баталгаажуулж чадсангүй (дахин оролдоно)',
      `QPay ${invoiceId}; утас ${booking.customerPhone || '—'}, үсчин ${booking.stylistId}, ${booking.date} ${booking.time}`,
      'Төлөгдсөн эсэхийг QPay дээр шалгана уу.',
    ].join('\n'), alertOpts);
    return res.status(502).json({ error: 'payment check failed' });
  }
  if (!paid) return res.status(200).json({ received: true, handled: 'not-paid' });

  // Name and phone as written on the invoice; the phone must match the token.
  let customerName = null;
  try {
    const invoice = await getInvoice(invoiceId, account);
    const desc = String((invoice && (invoice.invoice_description || invoice.description)) || '');
    const digits = desc.replace(/\D/g, '');
    if (booking.customerPhone && digits && !digits.includes(booking.customerPhone)) {
      console.error('late-payment: invoice phone does not match the booking token', invoiceId);
      await alertBookingFailure({ ...details, error: 'нэхэмжлэлийн утас захиалгатай таарахгүй байна' });
      return res.status(200).json({ received: true, handled: 'alerted-mismatch' });
    }
    customerName = desc.split(' - ')[0].trim() || null;
  } catch (err) {
    console.warn('late-payment: invoice details unavailable, booking without the name', invoiceId, err.message || err);
  }

  if (findClosure(booking.date)) {
    await alertBookingFailure({ ...details, customerName, error: 'салон амарч байгаа өдөр' });
    return res.status(200).json({ received: true, handled: 'alerted-closed' });
  }

  try {
    const calendar = await getCalendarClient();
    const result = await ensurePaidBooking(calendar, {
      stylistId: booking.stylistId,
      start: booking.start,
      services: booking.services,
      durationMinutes: booking.durationMinutes,
      customerName,
      customerPhone: booking.customerPhone,
      customerGender: booking.customerGender,
      depositTermsAccepted: !!booking.depositTermsAcceptedAt,
      depositTermsAcceptedAt: booking.depositTermsAcceptedAt,
      invoiceId,
      test: booking.test,
    }, { late: true, amount: booking.amount });
    console.log('late-payment: outcome', invoiceId, result.status);
    return res.status(200).json({ received: true, handled: result.status });
  } catch (err) {
    console.error('late-payment: could not write the booking', invoiceId, err.message || err);
    await alertBookingFailure({ ...details, customerName, error: err.message || err });
    return res.status(200).json({ received: true, handled: 'alerted-error' });
  }
});

module.exports = router;
module.exports.paymentStatuses = paymentStatuses;
