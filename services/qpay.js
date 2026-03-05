'use strict';

const axios = require('axios');
const { randomUUID } = require('crypto');

const QPAY_BASE_URL = 'https://quickqr.qpay.mn/v2';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory token cache: { access_token: string, fetchedAt: number }
let _tokenCache = null;

/**
 * Return a valid QPay access token.
 * A new token is only requested when the cache is empty or older than 24 hours.
 * @returns {Promise<string>} access_token
 */
async function getQPayToken() {
  const now = Date.now();
  if (_tokenCache && now - _tokenCache.fetchedAt < TOKEN_TTL_MS) {
    return _tokenCache.access_token;
  }

  const username = process.env.QPAY_USERNAME;
  const password = process.env.QPAY_PASSWORD;
  if (!username || !password) {
    throw new Error('QPAY_USERNAME and QPAY_PASSWORD environment variables must be set');
  }

  const credentials = Buffer.from(username + ':' + password).toString('base64');
  try {
    const response = await axios.post(
      `${QPAY_BASE_URL}/auth/token`,
      { terminal_id: username },
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    _tokenCache = {
      access_token: response.data.access_token,
      fetchedAt: now,
    };

    return _tokenCache.access_token;
  } catch (error) {
    console.error('QPay API Error Details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a QPay invoice and return the QR image and mobile deep-link URLs.
 * @param {object} params
 * @param {string|number} params.amount Amount in MNT
 * @param {string} params.description  Human-readable order description (shown in QPay)
 * @param {string} params.callbackUrl  QPay server-to-server callback URL
 * @returns {Promise<{ qr_image: string, urls: Array }>}
 */
async function createInvoice({ amount, description, callbackUrl }) {
  // QPAY_INVOICE_CODE is the invoice template code from the QPay merchant portal.
  // For backwards-compatibility also accept QPAY_MERCHANT_ID if the new variable
  // has not been set yet, but QPAY_INVOICE_CODE should be preferred.
  const invoiceCode = process.env.QPAY_INVOICE_CODE || process.env.QPAY_MERCHANT_ID;
  if (!invoiceCode) {
    throw new Error('QPAY_INVOICE_CODE environment variable must be set');
  }
  const accessToken = await getQPayToken();
  try {
    const payload = {
      invoice_code: invoiceCode,
      sender_invoice_no: randomUUID().replace(/-/g, ''),
      invoice_receiver_code: 'terminal',
      invoice_description: description,
      amount: Number(amount),
      callback_url: callbackUrl,
    };
    console.log('QPay Payload:', payload);
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
    console.error('QPay API Error Details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Reset the in-memory token cache.
 * Intended for use in tests only.
 */
function _resetTokenCache() {
  _tokenCache = null;
}

module.exports = { getQPayToken, createInvoice, _resetTokenCache };
