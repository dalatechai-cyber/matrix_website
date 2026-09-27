'use strict';

const crypto = require('crypto');
const { STYLIST_CONFIG } = require('../config/stylists');
const { totalDurationFor } = require('../config/serviceDurations');
const {
  CUSTOMER_GENDER_LABELS,
  DEPOSIT_TERMS_TEXT,
  normalizeCustomerGender,
  consentTime,
  formatSalonTime,
} = require('./bookingRules');
const { sendSalonAlert } = require('./telegram');

/**
 * Puts a paid appointment on the stylist's calendar — the one place both
 * booking paths meet:
 *
 *   - the browser, which calls POST /api/calendar/book once it sees the
 *     payment go through; and
 *   - QPay's own payment callback (routes/qpay.js /late-payment), which
 *     arrives whether or not the customer's page is still open.
 *
 * Money has already been taken by the time either runs, so the rule is that a
 * paid invoice always ends in exactly one of two outcomes: the appointment on
 * the calendar, or the salon alerted on Telegram to arrange a time. Never
 * neither, and never two appointments for one payment.
 */

const DEFAULT_DURATION_MINUTES = 60;
const formatter = new Intl.NumberFormat('en-US');

/**
 * Google Calendar event id for a QPay invoice. Both paths use it, so whichever
 * writes second gets a 409 from Google instead of a duplicate appointment.
 * Event ids must be base32hex (a–v, 0–9); lowercase hex qualifies.
 * @param {string} invoiceId
 */
function eventIdForInvoice(invoiceId) {
  return 'qp' + crypto.createHash('sha256').update(String(invoiceId)).digest('hex').slice(0, 40);
}

/**
 * Length of the appointment, from the services — never from the browser.
 * @returns {{ minutes: number, unknown: string[] }}
 */
function durationFor(services) {
  const resolved = totalDurationFor(services);
  if (!resolved.resolved) return { minutes: DEFAULT_DURATION_MINUTES, unknown: [] };
  return { minutes: resolved.minutes, unknown: resolved.unknown };
}

/**
 * The calendar event for a booking. `durationMinutes` may be passed when it
 * was already resolved and signed server-side (the QPay callback); otherwise
 * it is resolved from the services.
 */
function buildBookingEvent({
  stylistId, start, services, durationMinutes, customerName, customerPhone, customerEmail,
  customerGender, depositTermsAccepted, depositTermsAcceptedAt, invoiceId, test = false, extraLines = [],
}) {
  const stylist = STYLIST_CONFIG[stylistId];
  let minutes = durationMinutes;
  if (!(minutes > 0)) {
    const d = durationFor(services);
    minutes = d.minutes;
    if (d.unknown.length > 0) console.warn('book: no duration configured for service(s):', d.unknown.join(', '));
  }
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  const gender = normalizeCustomerGender(customerGender);

  const lines = [];
  if (test) lines.push('ТЕСТ — test booking made through the test link (100₮ test deposit). Not a real customer.');
  if (customerName) lines.push(`Name: ${customerName}`);
  if (customerPhone) lines.push(`Phone: ${customerPhone}`);
  if (customerEmail) lines.push(`Email: ${customerEmail}`);
  lines.push(`Price: ${stylist.price} MNT (${stylist.level})`);
  // Written out so the stylist can see the length the slot was reserved for,
  // and spot a service whose configured duration does not match reality.
  lines.push(`Duration: ${minutes} min`);
  lines.push(`Customer: ${gender ? `${CUSTOMER_GENDER_LABELS[gender]} (${gender})` : 'not recorded'}`);
  if (depositTermsAccepted === true) {
    // A Date comes from a server-signed callback and is trusted as is; a
    // string comes from the browser and is checked for plausibility.
    const consent = depositTermsAcceptedAt instanceof Date && !Number.isNaN(depositTermsAcceptedAt.getTime())
      ? { at: depositTermsAcceptedAt, source: 'signed' }
      : consentTime(depositTermsAcceptedAt);
    const note = consent.source === 'server' ? ' (time recorded at booking)' : '';
    lines.push(`Deposit terms accepted: ${formatSalonTime(consent.at)}${note}`);
    lines.push(`Agreed: «${DEPOSIT_TERMS_TEXT}»`);
  } else {
    console.warn('book: deposit terms agreement not recorded for booking with', stylistId);
    lines.push('Deposit terms accepted: NOT RECORDED');
  }
  if (typeof invoiceId === 'string' && invoiceId) lines.push(`QPay invoice: ${invoiceId.slice(0, 100)}`);
  lines.push(...extraLines);

  const serviceText = Array.isArray(services) ? services.join(', ') : (services || '');
  const base = customerPhone
    ? `${customerPhone} - ${serviceText || customerName || 'Appointment'}`
    : (serviceText || customerName || 'Appointment');
  const summary = test ? `ТЕСТ – ${base}` : base;

  return {
    durationMinutes: minutes,
    requestBody: {
      summary,
      description: lines.join('\n'),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  };
}

/** Whether [start, end) overlaps anything busy on the stylist's calendar. */
async function slotIsBusy(calendar, calendarId, start, end) {
  const fb = await calendar.freebusy.query({
    requestBody: { timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: calendarId }] },
  });
  const result = ((fb && fb.data && fb.data.calendars) || {})[calendarId] || {};
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Calendar access error: ${result.errors.map((e) => e.reason).join(', ')}`);
  }
  return (result.busy || []).some((b) => start < new Date(b.end) && end > new Date(b.start));
}

/** An existing, non-cancelled event with this id, or null. */
async function findEvent(calendar, calendarId, eventId) {
  try {
    const r = await calendar.events.get({ calendarId, eventId });
    return r && r.data && r.data.status !== 'cancelled' ? r.data : null;
  } catch (err) {
    const code = err.code || (err.response && err.response.status);
    if (code === 404 || code === 410) return null;
    throw err;
  }
}

const CONFLICT_FLAG = 'matrixPaidConflict';

/** What an event already written for this payment means for the caller. */
function outcomeFor(event, eventId, built) {
  const isNote = !!(event.extendedProperties && event.extendedProperties.private
    && event.extendedProperties.private[CONFLICT_FLAG] === '1');
  return { status: isNote ? 'conflict' : 'already-booked', eventId, durationMinutes: built.durationMinutes };
}

function isConflictError(err) {
  const code = err && (err.code || (err.response && err.response.status));
  return code === 409;
}

/** Plain-text alert for staff (Mongolian, so it reads naturally in the salon's chat). */
function conflictAlertText({ stylistId, start, customerName, customerPhone, services, amount, invoiceId, late, test }) {
  const local = formatSalonTime(start).replace(':00 (UTC+8)', '');
  return [
    `${test ? '[ТЕСТ] ' : ''}⚠️ Урьдчилгаа төлсөн үйлчлүүлэгчийн цаг давхцсан`,
    `Үйлчлүүлэгч: ${customerName || '—'}, утас ${customerPhone || '—'}`,
    `Үсчин: ${stylistId}`,
    `Сонгосон цаг: ${local}`,
    services ? `Үйлчилгээ: ${Array.isArray(services) ? services.join(', ') : services}` : null,
    amount ? `Урьдчилгаа: ${formatter.format(amount)}₮${invoiceId ? ` (QPay ${invoiceId})` : ''}` : (invoiceId ? `QPay: ${invoiceId}` : null),
    late ? 'Төлбөр QR нээгдсэнээс хойш удаж орсон тул энэ хооронд цаг өөр хүнд захиалагдсан.' : 'Төлбөр орох үед энэ цаг өөр захиалгатай болсон байсан.',
    'Үйлчлүүлэгчтэй холбогдож өөр цаг тохирно уу.',
  ].filter(Boolean).join('\n');
}

/**
 * Put a paid booking on the calendar, exactly once per invoice.
 *
 * @returns {Promise<{ status: 'booked'|'already-booked'|'conflict', eventId: string|null, durationMinutes: number }>}
 *   Throws only when Google Calendar itself fails; the caller alerts on that.
 */
async function ensurePaidBooking(calendar, booking, { late = false, amount = null } = {}) {
  const stylist = STYLIST_CONFIG[booking.stylistId];
  if (!stylist) throw new Error(`Unknown stylistId "${booking.stylistId}"`);
  const calendarId = stylist.calendarId;
  const invoiceId = typeof booking.invoiceId === 'string' && booking.invoiceId ? booking.invoiceId : null;
  const eventId = invoiceId ? eventIdForInvoice(invoiceId) : null;
  const built = buildBookingEvent(booking);
  const end = new Date(booking.start.getTime() + built.durationMinutes * 60 * 1000);

  // Already written for this payment (by the other path, or a retried call).
  const existing = eventId ? await findEvent(calendar, calendarId, eventId) : null;
  if (existing) return outcomeFor(existing, eventId, built);

  if (await slotIsBusy(calendar, calendarId, booking.start, end)) {
    // Busy may be this very payment, booked by the other path a moment ago
    // (the browser and QPay's callback usually arrive together).
    const raced = eventId ? await findEvent(calendar, calendarId, eventId) : null;
    if (raced) return outcomeFor(raced, eventId, built);

    // The slot went to someone else. Record the paid customer on the calendar
    // as a note that does not block time (so staff see it next to the slot
    // and it survives a failed alert), then alert staff to arrange a time.
    const note = buildBookingEvent({
      ...booking,
      durationMinutes: built.durationMinutes,
      test: false,
      extraLines: ['', 'SLOT TAKEN when the payment arrived — this customer has PAID but has NO appointment. Contact them to arrange a time.'],
    }).requestBody;
    note.summary = `${booking.test ? 'ТЕСТ – ' : ''}⚠ ТӨЛСӨН, ЦАГ ДАВХЦСАН – ${note.summary}`;
    if (booking.test) note.description = `ТЕСТ — test booking made through the test link (100₮ test deposit). Not a real customer.\n${note.description}`;
    note.transparency = 'transparent';
    note.extendedProperties = { private: { [CONFLICT_FLAG]: '1' } };
    try {
      await calendar.events.insert({ calendarId, requestBody: eventId ? { ...note, id: eventId } : note });
    } catch (err) {
      if (eventId && isConflictError(err)) {
        // The other path wrote first; whatever it wrote is the outcome, and
        // if that was a conflict note it has already alerted.
        const other = await findEvent(calendar, calendarId, eventId);
        if (other) return outcomeFor(other, eventId, built);
      }
      console.error('Could not write the paid-but-conflicting note to the calendar:', err.message || err);
    }
    console.error('PAID booking conflicts with an existing appointment:', booking.stylistId, booking.start.toISOString(), invoiceId);
    await sendSalonAlert(conflictAlertText({ ...booking, start: booking.start, amount, invoiceId, late }));
    return { status: 'conflict', eventId, durationMinutes: built.durationMinutes };
  }

  try {
    const requestBody = eventId ? { ...built.requestBody, id: eventId } : built.requestBody;
    const response = await calendar.events.insert({ calendarId, requestBody });
    console.log('Calendar booking created:', response.data.id, 'for stylist', booking.stylistId,
      `(${built.durationMinutes} min)`, late ? '[from QPay callback]' : '');
    return { status: 'booked', eventId: response.data.id, durationMinutes: built.durationMinutes };
  } catch (err) {
    if (eventId && isConflictError(err)) {
      const other = await findEvent(calendar, calendarId, eventId);
      if (other) return outcomeFor(other, eventId, built);
      return { status: 'already-booked', eventId, durationMinutes: built.durationMinutes };
    }
    throw err;
  }
}

/**
 * Whether the stylist already has an appointment for this phone starting at
 * `start` — how a callback that cannot name its invoice still recognises a
 * booking the browser made.
 */
async function hasBookingForPhone(calendar, stylistId, start, phone) {
  const stylist = STYLIST_CONFIG[stylistId];
  const digits = String(phone || '').replace(/\D/g, '');
  if (!stylist || !digits) return false;
  const r = await calendar.events.list({
    calendarId: stylist.calendarId,
    timeMin: new Date(start.getTime() - 60 * 1000).toISOString(),
    timeMax: new Date(start.getTime() + 60 * 1000).toISOString(),
    singleEvents: true,
    q: digits,
  });
  return ((r && r.data && r.data.items) || []).some((e) => e.status !== 'cancelled'
    && new Date((e.start && e.start.dateTime) || 0).getTime() === start.getTime()
    && String(e.summary || '').replace(/\D/g, '').startsWith(digits));
}

/** Alert staff that a paid booking could not be written at all. */
async function alertBookingFailure({ stylistId, start, customerName, customerPhone, services, amount, invoiceId, error, test }) {
  const local = start ? formatSalonTime(start).replace(':00 (UTC+8)', '') : '—';
  return sendSalonAlert([
    `${test ? '[ТЕСТ] ' : ''}⚠️ Урьдчилгаа төлсөн боловч цаг бүртгэж чадсангүй`,
    `Үйлчлүүлэгч: ${customerName || '—'}, утас ${customerPhone || '—'}`,
    `Үсчин: ${stylistId || '—'}`,
    `Сонгосон цаг: ${local}`,
    services ? `Үйлчилгээ: ${Array.isArray(services) ? services.join(', ') : services}` : null,
    amount ? `Урьдчилгаа: ${formatter.format(amount)}₮${invoiceId ? ` (QPay ${invoiceId})` : ''}` : (invoiceId ? `QPay: ${invoiceId}` : null),
    `Шалтгаан: ${String(error || 'тодорхойгүй').slice(0, 200)}`,
    'Үйлчлүүлэгчтэй холбогдож цагийг гараар бүртгэнэ үү.',
  ].filter(Boolean).join('\n'));
}

module.exports = {
  DEFAULT_DURATION_MINUTES,
  eventIdForInvoice,
  buildBookingEvent,
  ensurePaidBooking,
  alertBookingFailure,
  conflictAlertText,
  hasBookingForPhone,
};
