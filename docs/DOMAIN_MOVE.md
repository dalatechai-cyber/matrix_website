# Moving to tarasalon.org — plan (not done yet)

The new domain is **tarasalon.org** (bought at Namecheap; founder, 2026-10-04).
Not tarasalon.mn. DNS is the founder's step at Namecheap: point the apex and
`www` at Vercel as the Vercel → Domains screen shows; nothing here changes DNS.

Today the site is `www.matrixecosalon.org`. This is the short checklist for
switching to the Tara Salon domain, and why each line matters. Nothing here
has been changed yet.

## What already follows the domain by itself

- **Canonical, `og:url`, `og:image` (social preview, `brand/og-image.jpg`)** —
  written from the request's host by `lib/pages.js` (`{{origin}}`). No edit.
- **QPay payment callback** (`callback_url` on every invoice) — built from the
  host the customer booked on (`services/lateBooking.js` `publicOrigin`), so
  invoices created on tarasalon.org call back to tarasalon.org. No edit.
- **Callback signatures** — keyed on `BOOKING_CALLBACK_SECRET` / `QPAY_PASSWORD`,
  not the domain. Callbacks stay valid across the switch.
- **Old booking links** — `/#booking` forwards to `/booking.html`; `team.html`
  forwards to `/`.

## The checklist

1. **Vercel → Domains:** add tarasalon.org (apex + `www`) to the
   `matrix-website` project and make it primary.
2. **Keep the old domain attached**, redirecting *pages* (`/`, `*.html`) to
   tarasalon.org with 301 — but **do not redirect `/api/*`** for at least
   30 days. Invoices created before the switch call back to the old host,
   and QPay does not reliably follow a redirect on a POST; a redirected
   callback means a paid customer who is never booked. Renew the old domain
   for at least a year so printed QR codes and old posts keep working.
3. **Vercel → Environment Variables:** set `BASE_URL=https://tarasalon.org`
   (used when a request's host is unreadable, and by `/api/health`), then
   Redeploy.
4. **QPay merchant profiles:** update the website on Яармаг's merchant; register
   Парк Од's merchant with tarasalon.org from the start.
5. **Дали, both tenants (dala-ai):** the booking link becomes
   `https://tarasalon.org/booking.html` and the price page link (Дали points
   to it for prices it doesn't hold, founder 2026-10-04) becomes
   `https://tarasalon.org/services.html` — in both Tara tenants' rows, then
   publish both (dala-ai `docs/tenants/tara-*.md` lists every place). For one
   branch: `/booking.html?branch=yaarmag` or `?branch=parkod`.
6. **Google Business Profile:** Яармаг — website and appointment link; create
   Парк Од's profile with the new links.
7. **Google Search Console:** add tarasalon.org, then *Change of address*
   from the old property.
8. **Facebook / Instagram / Messenger:** page website field, Instagram bio,
   Messenger auto-replies and pinned posts. Then re-scrape the home page in
   Facebook's Sharing Debugger so the new logo preview replaces the cached
   Matrix one.
9. **Test link:** the test cookie belongs to one domain — testers open
   `https://tarasalon.org/?test=<token>` again after the switch.
10. **After switching:** book once with the test link on tarasalon.org, pay
    100₮, and confirm the calendar event and the QPay callback in the Vercel
    logs (`late-payment: outcome`).

## Places in this repo that name the old domain

Examples only, no behaviour: `tests/latePayment.test.js`,
`tests/siteMode.test.js`, the comment in `services/lateBooking.js`, and
`docs/STATUS.md` (history). Nothing to change for the switch.
