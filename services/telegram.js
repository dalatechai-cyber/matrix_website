'use strict';

const axios = require('axios');
const { alertChatFor } = require('../config/branches');

/**
 * Send an alert to the salon's Telegram chat.
 *
 * Used when money has been taken but no appointment could be put on the
 * calendar as asked — staff must contact the customer. Configure in Vercel:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — the salon group/chat the bot posts into
 *
 * Never throws: an alert that fails to send is logged loudly instead, and the
 * caller's own durable record (the calendar note) still exists.
 *
 * @param {string} text  Plain text, sent as-is
 * @param {{ branch?: string }} [opts]  the branch the alert is about
 * @returns {Promise<boolean>} whether Telegram accepted it
 */
async function sendSalonAlert(text, { branch } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Each branch's alerts go to its own chat when one is set
  // (config/branches.js); otherwise to the salon's chat, as before.
  const chatId = alertChatFor(branch || 'yaarmag');
  if (!token || !chatId) {
    console.error('SALON ALERT NOT SENT — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured:\n' + text);
    return false;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text, disable_web_page_preview: true },
      { timeout: 8000 },
    );
    return true;
  } catch (err) {
    // The token is in the URL; log only Telegram's own description.
    const reason = (err.response && err.response.data && err.response.data.description) || err.code || 'request failed';
    console.error('SALON ALERT FAILED to send via Telegram (' + reason + '):\n' + text);
    return false;
  }
}

module.exports = { sendSalonAlert };
