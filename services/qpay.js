'use strict';

const axios = require('axios');

const QPAY_BASE_URL = 'https://quickqr.qpay.mn/v2';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory token cache: { access_token: string, fetchedAt: number }
let _tokenCache = null;

/**
 * Return a valid QPay access token.
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
      { terminal_id: 'DALATECH_AI' },
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    _tokenCache = {
      access_token: response.data.access_token,
      fetchedAt: now,
    };

    return _tokenCache.access_token;
  } catch (error) {
    console.error('QPay Token Error Details:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Create a QPay invoice and return the QR image and mobile deep-link URLs.
 */
async function createInvoice({ amount, description, callbackUrl, bankAccounts } = {}) {
  const merchantId = process.env.QPAY_MERCHANT_ID;
  if (!merchantId) {
    throw new Error('QPAY_MERCHANT_ID environment variable must be set');
  }

  // --- ЭНД АЛДААГ ЗАСЛАА (DATA SANITIZATION) ---
  // 1. "20,000 ₮" гэж ирсэн ч зөвхөн тоог нь ялгаж авч цэвэр тоо (Integer) болгоно
  const cleanAmount = Number(String(amount).replace(/[^0-9.]/g, ''));
  
  // 2. Хэрэв нэр, утас хоосон ирвэл алдаа заалгахгүйн тулд утга онооно
  const cleanDescription = description ? String(description).substring(0, 255) : "Matrix Salon - Үйлчилгээ";

  const accessToken = await getQPayToken();
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
async function checkPayment(invoiceId) {
  const accessToken = await getQPayToken();
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

function _resetTokenCache() {
  _tokenCache = null;
}

module.exports = { getQPayToken, createInvoice, checkPayment, _resetTokenCache };
