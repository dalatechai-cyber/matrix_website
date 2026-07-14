'use strict';

const { findClosure, hasPendingClosure } = require('../config/closures');

/**
 * Guards the payment endpoints against taking a deposit for a day the salon is
 * shut. Kept in one module because there are two separate create-payment
 * handlers (the Express route and the standalone Vercel function), and they
 * must not drift apart.
 */

/**
 * The booking description the site sends with every payment, built in
 * script.js:
 *   "Matrix Eco: {stylistId} - {date} {time} - {name} - {phone}"
 * Reading the date back out of it means the guard also covers customers whose
 * browser is still running an older cached script.js — those clients send no
 * explicit bookingDate, but they have always sent this description.
 */
const DESCRIPTION_DATE_RE = /^Matrix Eco:\s*.+?\s+-\s+(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}\s+-\s+/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every salon-local date a payment request carries.
 *
 * There are two, and they are not interchangeable: `bookingDate` is what this
 * guard reads, while `description` is what gets stored and later parsed to
 * create the calendar event. A request whose two dates disagree must not be
 * able to pass the guard on one and be booked on the other, so both are checked.
 *
 * @param {{bookingDate?: string, description?: string}} body
 * @returns {string[]} YYYY-MM-DD dates, most authoritative first; may be empty
 */
function bookingDatesFromRequest(body) {
  const dates = [];

  const explicit = (body && body.bookingDate) || '';
  if (DATE_RE.test(explicit)) dates.push(explicit);

  const match = DESCRIPTION_DATE_RE.exec((body && body.description) || '');
  if (match && !dates.includes(match[1])) dates.push(match[1]);

  return dates;
}

/**
 * The date a payment request is for.
 *
 * @param {{bookingDate?: string, description?: string}} body
 * @returns {string|null} YYYY-MM-DD, or null when the request carries no date
 */
function bookingDateFromRequest(body) {
  return bookingDatesFromRequest(body)[0] || null;
}

/**
 * Decide whether a payment request may proceed.
 *
 * When no closure covers today or any future date, this always allows the
 * request — the salon is simply open, and payments behave exactly as they did
 * before closures existed.
 *
 * While a closure IS pending, a request whose date cannot be read is refused
 * rather than guessed at: the only clients that send no readable date are ones
 * we did not write, and letting an unreadable request through is precisely the
 * hole this guard exists to close.
 *
 * @param {{bookingDate?: string, description?: string}} body
 * @returns {{allowed: boolean, date: string|null, closure: object|null, reason: string}}
 */
function checkPaymentRequest(body) {
  const dates = bookingDatesFromRequest(body);

  if (dates.length) {
    // Any closed date anywhere in the request refuses it — see
    // bookingDatesFromRequest for why one date is not enough to check.
    for (const date of dates) {
      const closure = findClosure(date);
      if (closure) {
        return { allowed: false, date, closure, reason: 'salon-closed' };
      }
    }
    return { allowed: true, date: dates[0], closure: null, reason: 'open' };
  }

  if (hasPendingClosure()) {
    return { allowed: false, date: null, closure: null, reason: 'indeterminate-date' };
  }

  return { allowed: true, date: null, closure: null, reason: 'no-closure-configured' };
}

module.exports = {
  bookingDateFromRequest,
  bookingDatesFromRequest,
  checkPaymentRequest,
  DESCRIPTION_DATE_RE,
};
