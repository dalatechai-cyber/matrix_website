// Vercel entry for POST /api/qpay/create-payment (vercel.json). The handler is
// create-payment.js; this file exists only to carry the function's time limit,
// which Vercel reads from an ES-module `export const config` and nowhere else
// (vercel.json `builds` config is ignored for it). 400 s: the 5½-minute hold
// is deleted by this request at expiry (services/bookingHold.js), so the
// function must outlive it. Needs a Pro plan (Hobby stops at 300 s).
import handler from './create-payment.js';

export const config = { maxDuration: 400 };

export default handler;
