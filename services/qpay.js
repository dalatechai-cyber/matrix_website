'use strict';

const axios = require('axios');

const QPAY_BASE_URL = 'https://merchant.qpay.mn/v2';
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
      {},
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
 * @param {string} params.merchantId   Dynamic merchant ID for this transaction
 * @param {string|number} params.amount Amount in MNT
 * @param {string} params.description  Human-readable order description
 * @param {string} params.callbackUrl  QPay server-to-server callback URL
 * @returns {Promise<{ qr_image: string, urls: Array }>}
 */
async function createInvoice({ merchantId, amount, description, callbackUrl }) {
  const accessToken = await getQPayToken();
  try {
    const response = await axios.post(
      `${QPAY_BASE_URL}/invoice`,
      {
        merchant_id: merchantId,
        amount: String(amount),
        currency: 'MNT',
        description,
        callback_url: callbackUrl,
      },
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
