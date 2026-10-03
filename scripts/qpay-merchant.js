#!/usr/bin/env node
'use strict';

/**
 * Register and inspect QPay Quick QR merchants under the site's ONE partner
 * login — how Парк Од gets her own merchant id (docs/TWO_BRANCHES.md).
 *
 * Needs QPAY_USERNAME and QPAY_PASSWORD in the environment (e.g. from
 * `vercel env pull`). Never prints them. Nothing is created unless `--send`
 * is given: without it, `register` only shows what would be sent.
 *
 *   node scripts/qpay-merchant.js cities                  city/aimag codes
 *   node scripts/qpay-merchant.js districts <city_code>   district/sum codes
 *   node scripts/qpay-merchant.js register <form.json>    dry run: show the request
 *   node scripts/qpay-merchant.js register <form.json> --send
 *   node scripts/qpay-merchant.js get <merchant_id>       read one merchant back
 *   node scripts/qpay-merchant.js list                    merchants under this login
 *
 * Or from GitHub: Actions → «Register Парк Од QPay merchant» (manual), with the
 * filled form stored as the repository secret PARKOD_MERCHANT_FORM — the repo
 * is public, so the form is never committed and never printed (--no-echo).
 *
 * form.json, for a person:
 *   { "type": "person", "register_number": "…", "first_name": "<овог>", "last_name": "<нэр>",
 *     "business_name": "Tara Salon Парк Од", "mcc_code": "7230", "city": "…", "district": "…",
 *     "address": "…", "phone": "…", "email": "…",
 *     "bank_accounts": [{ "account_bank_code": "…", "account_number": "…", "account_name": "…", "is_default": true }] }
 * for a company: "type": "company" with register_number, company_name, name,
 *   owner_register_no, owner_first_name, owner_last_name and the same rest.
 *
 * The bank account is sent with the merchant as createMerchant.js did for
 * Яармаг; the site ALSO sends it on every invoice (config/branches.js), which
 * is what decides where a payment goes (to be confirmed by QPay in writing).
 */

const fs = require('fs');
const axios = require('axios');

const BASE = 'https://quickqr.qpay.mn/v2';
const TERMINAL_ID = 'DALATECH_AI';

async function token() {
  const { QPAY_USERNAME: u, QPAY_PASSWORD: p } = process.env;
  if (!u || !p) throw new Error('QPAY_USERNAME and QPAY_PASSWORD must be set (values are never printed)');
  const r = await axios.post(`${BASE}/auth/token`, { terminal_id: TERMINAL_ID },
    { headers: { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` }, timeout: 15000 });
  return r.data.access_token;
}

const PERSON = ['register_number', 'first_name', 'last_name', 'business_name', 'mcc_code', 'city', 'district', 'address', 'phone', 'email'];
const COMPANY = ['register_number', 'company_name', 'name', 'owner_register_no', 'owner_first_name', 'owner_last_name', 'mcc_code', 'city', 'district', 'address', 'phone', 'email'];

function checkForm(form) {
  const need = form.type === 'company' ? COMPANY : form.type === 'person' ? PERSON : null;
  if (!need) return ['"type" must be "person" or "company"'];
  const missing = need.filter((k) => !String(form[k] || '').trim()).map((k) => `missing ${k}`);
  const acc = Array.isArray(form.bank_accounts) ? form.bank_accounts[0] : null;
  if (!acc || !acc.account_bank_code || !acc.account_number || !acc.account_name) missing.push('missing bank_accounts[0] (account_bank_code, account_number, account_name)');
  if (acc && acc.account_number === '416055415') missing.push('bank account is Яармаг\'s, not Парк Од\'s');
  if (form.mcc_code && form.mcc_code !== '7230') missing.push('mcc_code should be 7230 (beauty and barber shops), as for Яармаг');
  return missing;
}

async function main() {
  const args = process.argv.slice(2);
  // --no-echo: never print the form (personal data) — for public CI logs.
  const noEcho = args.includes('--no-echo');
  const [cmd, arg, flag] = args.filter((a) => a !== '--no-echo');
  if (cmd === 'register') {
    const form = JSON.parse(fs.readFileSync(arg, 'utf8'));
    const problems = checkForm(form);
    if (problems.length) { console.error('Form not ready:\n- ' + problems.join('\n- ')); process.exit(2); }
    const { type, ...body } = form;
    const path = `/merchant/${type}`;
    if (flag !== '--send') {
      console.log(`DRY RUN — would POST ${BASE}${path}${noEcho ? ` (fields: ${Object.keys(body).join(', ')})` : ' with:'}`);
      if (!noEcho) console.log(JSON.stringify(body, null, 2));
      console.log('\nNothing was sent. Re-run with --send to register.');
      return;
    }
    const r = await axios.post(`${BASE}${path}`, body, { headers: { Authorization: `Bearer ${await token()}` }, timeout: 20000 });
    console.log('Registered. Merchant id (set it as PARKOD_QPAY_MERCHANT_ID):', r.data.id);
    return;
  }
  const t = await token();
  const auth = { headers: { Authorization: `Bearer ${t}` }, timeout: 15000 };
  if (cmd === 'cities') console.log(JSON.stringify((await axios.get(`${BASE}/aimaghot`, auth)).data, null, 2));
  else if (cmd === 'districts') console.log(JSON.stringify((await axios.get(`${BASE}/sumduureg/${encodeURIComponent(arg)}`, auth)).data, null, 2));
  else if (cmd === 'get') console.log(JSON.stringify((await axios.get(`${BASE}/merchant/${encodeURIComponent(arg)}`, auth)).data, null, 2));
  else if (cmd === 'list') console.log(JSON.stringify((await axios.post(`${BASE}/merchant/list`, { offset: { page_number: 1, page_limit: 50 } }, auth)).data, null, 2));
  else { console.error('Usage: see the comment at the top of scripts/qpay-merchant.js'); process.exit(1); }
}

main().catch((err) => {
  const data = err.response && err.response.data;
  // Under --no-echo, never repeat QPay's answer whole: it may quote the form.
  const shown = process.argv.includes('--no-echo')
    ? `${(err.response && err.response.status) || ''} ${(data && (data.error || data.message)) || err.message}`
    : ((data && JSON.stringify(data)) || err.message);
  console.error('QPay error:', shown);
  process.exit(1);
});
