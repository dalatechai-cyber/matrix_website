// Vercel entry for the site and every /api route but create-payment
// (vercel.json). The app is server.js; this file exists only to carry the
// function's time limit, which Vercel reads from an ES-module
// `export const config` and nowhere else. 400 s: see api/qpay/create-payment.mjs.
import app from './server.js';

export const config = { maxDuration: 400 };

export default app;
