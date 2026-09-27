'use strict';

const { STYLIST_CONFIG } = require('../config/stylists');

/**
 * The salon's booking rules that must hold before a deposit is taken. Kept in
 * one module for the same reason as closureGuard.js: there are two separate
 * create-payment handlers (the Express route and the standalone Vercel
 * function), and they must not drift apart.
 *
 *   1. A female customer is served by a female hairdresser, a male customer by
 *      a male one. The browser only offers matching hairdressers; this is what
 *      makes a mismatched booking impossible rather than merely unlikely.
 *   2. The customer has agreed that the deposit is not refunded for a
 *      cancellation or a no-show. No invoice (and so no QR) exists without it.
 */

/** Customer-facing labels, also written onto the calendar event. */
const CUSTOMER_GENDER_LABELS = { female: 'Эмэгтэй', male: 'Эрэгтэй' };

/** The exact wording the customer ticks. Recorded on the booking verbatim. */
const DEPOSIT_TERMS_TEXT =
  'Урьдчилгаа төлбөр нь цагаа цуцалсан эсвэл ирээгүй тохиолдолд буцаан олгогдохгүй гэдгийг ойлгож, зөвшөөрч байна.';

/**
 * Shown by the browser when a payment request is refused by these rules. The
 * current page never sends such a request, so in practice this reaches only a
 * tab still running a script.js from before the rules existed — and reloading
 * is exactly what fixes it.
 */
const REFRESH_MESSAGE = 'Уучлаарай, хуудсаа шинэчлээд дахин оролдоно уу.';

// How far a browser-reported consent time may sit from the server's clock and
// still be recorded as given. Outside it, the server's own time is used.
const CONSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONSENT_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * @param {unknown} value  'female' | 'male' (the Mongolian labels are accepted too)
 * @returns {'female'|'male'|null}
 */
function normalizeCustomerGender(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'female' || v === 'эмэгтэй') return 'female';
  if (v === 'male' || v === 'эрэгтэй') return 'male';
  return null;
}

/**
 * Whether this customer may book this hairdresser.
 *
 * @param {{ stylistId?: string, customerGender?: string }} args
 * @returns {{ allowed: boolean, reason: string, customerGender: string|null, stylistGender: string|null }}
 */
function checkGenderMatch({ stylistId, customerGender }) {
  const stylist = STYLIST_CONFIG[stylistId];
  const customer = normalizeCustomerGender(customerGender);
  if (!stylist) {
    return { allowed: false, reason: 'unknown-stylist', customerGender: customer, stylistGender: null };
  }
  const stylistGender = stylist.gender === 'female' || stylist.gender === 'male' ? stylist.gender : null;
  if (!stylistGender) {
    // Never guess: a hairdresser whose gender is not recorded cannot be matched.
    return { allowed: false, reason: 'stylist-gender-unrecorded', customerGender: customer, stylistGender: null };
  }
  if (!customer) {
    return { allowed: false, reason: 'missing-customer-gender', customerGender: null, stylistGender };
  }
  if (customer !== stylistGender) {
    return { allowed: false, reason: 'gender-mismatch', customerGender: customer, stylistGender };
  }
  return { allowed: true, reason: 'ok', customerGender: customer, stylistGender };
}

/**
 * The time to record for the customer's agreement to the deposit terms.
 *
 * The browser reports when the box was ticked. That is kept when it is a real
 * time close to now; anything else (missing, malformed, in the future, days
 * old) falls back to `now`, and says so, so the record never shows a time the
 * server had no reason to believe.
 *
 * @param {unknown} reported  ISO timestamp from the browser
 * @param {Date} [now]
 * @returns {{ at: Date, source: 'browser'|'server' }}
 */
function consentTime(reported, now = new Date()) {
  const t = typeof reported === 'string' ? new Date(reported) : null;
  if (t && !Number.isNaN(t.getTime())) {
    const age = now.getTime() - t.getTime();
    if (age <= CONSENT_MAX_AGE_MS && age >= -CONSENT_MAX_SKEW_MS) {
      return { at: t, source: 'browser' };
    }
  }
  return { at: now, source: 'server' };
}

/**
 * A Date as Ulaanbaatar wall-clock time: "2026-09-27 14:03:12 (UTC+8)".
 * @param {Date} date
 */
function formatSalonTime(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19).replace('T', ' ')} (UTC+8)`;
}

/**
 * Decide whether a create-payment request may produce an invoice.
 *
 * The site sends `staffName` (the stylist id), `customerGender` and
 * `depositTermsAccepted: true`. A request missing any of them is refused
 * before QPay is ever called, so no invoice or QR exists for it.
 *
 * @param {{ staffName?: string, customerGender?: string, depositTermsAccepted?: unknown }} body
 * @returns {{ allowed: boolean, reason: string, customerGender: string|null }}
 */
function checkPaymentBookingRules(body) {
  const b = body || {};
  const gender = checkGenderMatch({ stylistId: b.staffName, customerGender: b.customerGender });
  if (!gender.allowed) {
    return { allowed: false, reason: gender.reason, customerGender: gender.customerGender };
  }
  if (b.depositTermsAccepted !== true) {
    return { allowed: false, reason: 'deposit-terms-not-accepted', customerGender: gender.customerGender };
  }
  return { allowed: true, reason: 'ok', customerGender: gender.customerGender };
}

module.exports = {
  CUSTOMER_GENDER_LABELS,
  DEPOSIT_TERMS_TEXT,
  REFRESH_MESSAGE,
  normalizeCustomerGender,
  checkGenderMatch,
  consentTime,
  formatSalonTime,
  checkPaymentBookingRules,
};
