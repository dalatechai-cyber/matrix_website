'use strict';

const axios = require('axios');

const QPAY_BASE_URL = 'https://quickqr.qpay.mn/v2';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory token caches, one per QPay account:
// key -> { access_token: string, fetchedAt: number }
const _tokenCaches = new Map();

/**
 * Every function here takes an optional `account` (config/branches.js
 * qpayAccountFor). Omitted, or Яармаг's, it is the site's original account —
 * QPAY_USERNAME / QPAY_PASSWORD / QPAY_MERCHANT_ID, terminal DALATECH_AI —
 * exactly as before branches existed. Any other branch uses only its own
 * credentials and never falls back to Яармаг's.
 */
function credentialsFor(account) {
  if (!account || account.branch === 'yaarmag') {
    return {
      key: 'yaarmag',
      username: process.env.QPAY_USERNAME,
      password: process.env.QPAY_PASSWORD,
      terminalId: 'DALATECH_AI',
      merchantId: process.env.QPAY_MERCHANT_ID,
      missing: 'QPAY_USERNAME and QPAY_PASSWORD environment variables must be set',
      missingMerchant: 'QPAY_MERCHANT_ID environment variable must be set',
    };
  }
  return {
    key: `${account.branch}:${account.username || ''}:${account.terminalId || ''}`,
    username: account.username,
    password: account.password,
    terminalId: account.terminalId,
    merchantId: account.merchantId,
    missing: `QPay credentials for branch "${account.branch}" are not configured`,
    missingMerchant: `QPay merchant id for branch "${account.branch}" is not configured`,
  };
}

/**
 * Return a valid QPay access token.
 */
async function getQPayToken(account) {
  const creds = credentialsFor(account);
  const now = Date.now();
  const cached = _tokenCaches.get(creds.key);
  if (cached && now - cached.fetchedAt < TOKEN_TTL_MS) {
    return cached.access_token;
  }

  const { username, password } = creds;
  if (!username || !password || !creds.terminalId) {
    throw new Error(creds.missing);
  }

  const credentials = Buffer.from(username + ':' + password).toString('base64');
  try {
    const response = await axios.post(
      `${QPAY_BASE_URL}/auth/token`,
      { terminal_id: creds.terminalId },
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    _tokenCaches.set(creds.key, {
      access_token: response.data.access_token,
      fetchedAt: now,
    });

    return response.data.access_token;
  } catch (error) {
    console.error('QPay Token Error Details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a QPay invoice and return the QR image and mobile deep-link URLs.
 */
async function createInvoice({ amount, description, callbackUrl, bankAccounts, account } = {}) {
  const creds = credentialsFor(account);
  const merchantId = creds.merchantId;
  if (!merchantId) {
    throw new Error(creds.missingMerchant);
  }

  // --- ЭНД АЛДААГ ЗАСЛАА (DATA SANITIZATION) ---
  // 1. "20,000 ₮" гэж ирсэн ч зөвхөн тоог нь ялгаж авч цэвэр тоо (Integer) болгоно
  const cleanAmount = Number(String(amount).replace(/[^0-9.]/g, ''));
  
  // 2. Хэрэв нэр, утас хоосон ирвэл алдаа заалгахгүйн тулд утга онооно
  const cleanDescription = description ? String(description).substring(0, 255) : "Matrix Salon - Үйлчилгээ";

  const accessToken = await getQPayToken(account);
  try {
    const payload = {
      merchant_id: merchantId,
      amount: cleanAmount > 0 ? cleanAmount : 100, // Хэрэв үнэ 0 болвол автоматаар 100₮ болгож хамгаална
      currency: 'MNT',
      description: cleanDescription,
      mcc_code: '7230',
    };

    // Callback URL байвал л нэмнэ
    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }

    // Bank accounts байвал л нэмнэ
    if (bankAccounts && bankAccounts.length > 0) {
      payload.bank_accounts = bankAccounts;
    }

    console.log('FINAL TEST PAYLOAD:', payload);

    const response = await axios.post(
      `${QPAY_BASE_URL}/invoice`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    return {
      invoice_id: response.data.invoice_id || response.data.id || null,
      qr_image: response.data.qr_image,
      urls: response.data.urls || [],
    };
  } catch (error) {
    console.error('QPay Invoice Error Details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Check the real-time payment status of a QPay invoice.
 *
 * @param {string} invoiceId - The QPay invoice ID to check
 * @returns {Promise<object>} - QPay payment check response (contains invoice_status)
 */
async function checkPayment(invoiceId, account) {
  const accessToken = await getQPayToken(account);
  try {
    const response = await axios.post(
      `${QPAY_BASE_URL}/payment/check`,
      { invoice_id: invoiceId },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return response.data;
  } catch (error) {
    console.error('QPay Check Payment Error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch an invoice's details (status, amount, description) from QPay.
 *
 * @param {string} invoiceId
 * @returns {Promise<object>}
 */
async function getInvoice(invoiceId, account) {
  const accessToken = await getQPayToken(account);
  const response = await axios.get(
    `${QPAY_BASE_URL}/invoice/${encodeURIComponent(invoiceId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 },
  );
  return response.data;
}

/**
 * Fetch one payment's details; `object_id` is the invoice it paid.
 *
 * @param {string} paymentId
 * @returns {Promise<object>}
 */
async function getPayment(paymentId, account) {
  const accessToken = await getQPayToken(account);
  const response = await axios.get(
    `${QPAY_BASE_URL}/payment/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 },
  );
  return response.data;
}

/** Whether a /payment/check response shows the invoice as paid. */
function isPaidCheck(data) {
  if (!data) return false;
  if (data.invoice_status === 'PAID') return true;
  return Array.isArray(data.rows) && data.rows.some((row) => row && row.payment_status === 'PAID');
}

function _resetTokenCache() {
  _tokenCaches.clear();
}

module.exports = { getQPayToken, createInvoice, checkPayment, getInvoice, getPayment, isPaidCheck, _resetTokenCache };
