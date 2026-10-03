'use strict';

/**
 * Tara Salon's branches — Яармаг and Парк Од. Same brand and prices, separate
 * owners: each branch books into its OWN stylists' Google Calendars and is
 * paid into its OWN bank account. Nothing here may let one branch's booking
 * reach the other's calendar or bank account.
 *
 * Public facts (address, phones, hours) live in data/branches.json, shared
 * with the pages. This file adds what only the server may know: the QPay
 * account, and whether the branch is ready to take online bookings at all.
 *
 * A branch is bookable only when ALL of these hold:
 *   - it has opening hours (workHours) in data/branches.json,
 *   - at least one hairdresser in config/stylists.js with `branch` set to it
 *     and a calendar id,
 *   - its QPay account is complete,
 *   - it has its own Telegram alert chat (Парк Од: PARKOD_TELEGRAM_CHAT_ID).
 * Until then the booking page shows it as «Онлайн захиалга удахгүй нээгдэнэ»
 * and every API refuses it, before Google or QPay is ever called.
 *
 * Яармаг keeps exactly the QPay settings the site has always used.
 *
 * Парк Од uses the SAME QPay as Яармаг (founder, 2026-10-04): the same Quick
 * QR login (QPAY_USERNAME / QPAY_PASSWORD, terminal DALATECH_AI) and the same
 * merchant, exactly as Core Language and Matrix do. The ONLY difference is the
 * bank account her deposits are paid into, which every invoice names in
 * `bank_accounts`. So Парк Од needs, all REQUIRED:
 *
 *   PARKOD_QPAY_BANK_CODE         her bank's QPay code (Khan Bank: 040000)
 *   PARKOD_QPAY_ACCOUNT_NUMBER    her account number
 *   PARKOD_QPAY_ACCOUNT_NAME      the account holder's name, as the bank has it
 *   PARKOD_TELEGRAM_CHAT_ID       the chat her payment alerts go to
 *
 * Яармаг's account number is refused for her, so a copy-paste in Vercel can
 * never send her deposits to Яармаг.
 */

const data = require('../data/branches.json');
const { STYLIST_CONFIG, teamOf } = require('./stylists');

const DEFAULT_BRANCH = 'yaarmag';
const BRANCH_IDS = data.order.filter((id) => data.branches[id]);

// The partner terminal, and the account Яармаг has always been paid into (see
// api/qpay/create-payment.js and routes/qpay.js). merchantId is deliberately
// absent: each of those two handlers keeps the merchant it has always used,
// for both branches.
const YAARMAG_TERMINAL_ID = 'DALATECH_AI';

const YAARMAG_BANK_ACCOUNTS = [{
  account_bank_code: '040000',
  account_number: '416055415',
  account_name: 'Эрхэмбаатар Оюунсүрэн',
  is_default: true,
}];

function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The QPay account a branch is paid into, or null for an unknown branch.
 * `complete` says whether every required credential is present.
 */
function qpayAccountFor(branchId) {
  if (branchId === 'yaarmag') {
    const username = env('QPAY_USERNAME');
    const password = env('QPAY_PASSWORD');
    return {
      branch: 'yaarmag',
      username,
      password,
      terminalId: YAARMAG_TERMINAL_ID,
      merchantId: null,
      bankAccounts: YAARMAG_BANK_ACCOUNTS,
      // Always treated as complete, as before this file existed: missing
      // credentials surface as the QPay error they always did, rather than
      // taking Яармаг offline.
      complete: true,
    };
  }
  if (branchId === 'parkod') {
    const bankCode = env('PARKOD_QPAY_BANK_CODE');
    const accountNumber = env('PARKOD_QPAY_ACCOUNT_NUMBER');
    const accountName = env('PARKOD_QPAY_ACCOUNT_NAME');
    const bankAccounts = bankCode && accountNumber && accountName
      ? [{ account_bank_code: bankCode, account_number: accountNumber, account_name: accountName, is_default: true }]
      : null;
    // Never Яармаг's account, even by a copy-paste in Vercel.
    const notYaarmag = !YAARMAG_BANK_ACCOUNTS.some((a) => a.account_number === accountNumber);
    return {
      ...qpayAccountFor('yaarmag'),
      branch: 'parkod',
      bankAccounts,
      complete: !!(bankAccounts && notYaarmag),
    };
  }
  return null;
}

function normalizeBranchId(value) {
  const v = String(value || '').trim().toLowerCase();
  return BRANCH_IDS.includes(v) ? v : null;
}

/** Public facts for a branch (data/branches.json), or null. */
function branchInfo(branchId) {
  return data.branches[branchId] || null;
}

/** The branch a hairdresser works at. Every entry in config/stylists.js has one. */
function branchOfStylist(stylistId) {
  const cfg = STYLIST_CONFIG[stylistId];
  return cfg ? normalizeBranchId(cfg.branch) : null;
}

/**
 * Display names of a branch's bookable hairdressers, in team order: current
 * (not retired) and with a calendar. See config/stylists.js teamOf.
 */
function stylistsOf(branchId) {
  return teamOf(branchId).filter((name) => STYLIST_CONFIG[name] && STYLIST_CONFIG[name].calendarId);
}

function hasWorkHours(info) {
  const wh = info && info.workHours;
  const ok = (pair) => Array.isArray(pair) && pair.length === 2 && pair[0] < pair[1];
  return !!(wh && ok(wh.weekday) && ok(wh.sunday));
}

/**
 * Whether a branch can take an online booking right now, and if not, why.
 * @returns {{ ready: boolean, reason: string }}
 */
function branchReadiness(branchId) {
  const info = branchInfo(branchId);
  if (!info) return { ready: false, reason: 'unknown-branch' };
  if (!hasWorkHours(info)) return { ready: false, reason: 'no-hours' };
  if (stylistsOf(branchId).length === 0) return { ready: false, reason: 'no-stylists' };
  const account = qpayAccountFor(branchId);
  if (!account || !account.complete) return { ready: false, reason: 'no-qpay' };
  // Staff alerts carry customers' names and phones: a branch needs its own
  // chat before it takes bookings (Яармаг's is TELEGRAM_CHAT_ID).
  if (branchId !== 'yaarmag' && !alertChatFor(branchId)) return { ready: false, reason: 'no-alert-chat' };
  return { ready: true, reason: 'ok' };
}

/**
 * Opening hours for a date at a branch. YYYY-MM-DD in salon time (UTC+8).
 * @returns {{ workStartHour: number, workEndHour: number } | null}
 */
function workHoursFor(branchId, dateStr) {
  const info = branchInfo(branchId);
  if (!hasWorkHours(info)) return null;
  const dayOfWeek = new Date(`${dateStr}T12:00:00+08:00`).getUTCDay();
  const [start, end] = dayOfWeek === 0 ? info.workHours.sunday : info.workHours.weekday;
  return { workStartHour: start, workEndHour: end };
}

/**
 * The branch a payment or booking request is for, decided by its hairdresser.
 * A request that names a different branch from the hairdresser's is refused:
 * a mismatch means a stale or tampered page, and guessing would risk charging
 * or booking at the wrong branch.
 *
 * @param {{ stylistId?: string, branch?: string }} args
 * @returns {{ ok: boolean, branch: string|null, reason: string }}
 */
function resolveBookingBranch({ stylistId, branch }) {
  const stylistBranch = branchOfStylist(stylistId);
  if (!stylistBranch) return { ok: false, branch: null, reason: 'unknown-stylist' };
  const cfg = STYLIST_CONFIG[stylistId];
  // Retired, or not yet connected to a calendar: nothing new is invoiced.
  if (cfg.retired) return { ok: false, branch: stylistBranch, reason: 'stylist-retired' };
  if (!cfg.calendarId) return { ok: false, branch: stylistBranch, reason: 'stylist-not-connected' };
  if (branch != null && branch !== '' && normalizeBranchId(branch) !== stylistBranch) {
    return { ok: false, branch: stylistBranch, reason: 'branch-mismatch' };
  }
  const readiness = branchReadiness(stylistBranch);
  if (!readiness.ready) return { ok: false, branch: stylistBranch, reason: `branch-not-ready:${readiness.reason}` };
  return { ok: true, branch: stylistBranch, reason: 'ok' };
}

/**
 * The Telegram chat a branch's alerts go to. No fallback between branches:
 * separate owners, and alerts name customers.
 */
function alertChatFor(branchId) {
  if (branchId === 'parkod') return env('PARKOD_TELEGRAM_CHAT_ID');
  return env('TELEGRAM_CHAT_ID');
}

module.exports = {
  DEFAULT_BRANCH,
  BRANCH_IDS,
  qpayAccountFor,
  normalizeBranchId,
  branchInfo,
  branchOfStylist,
  stylistsOf,
  branchReadiness,
  workHoursFor,
  resolveBookingBranch,
  alertChatFor,
};
