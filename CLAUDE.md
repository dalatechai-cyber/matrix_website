# Matrix Eco Salon

Static, multi-page marketing site for **Matrix Eco Salon** (Ulaanbaatar,
Mongolia). Six HTML pages — `index`, `services`, `team`, `zurag` (gallery),
`products` (Amos), `keune-products` — sharing `styles.css` and `script.js`, plus
an Express API (`server.js`, `routes/`) for QPay payments and Google Calendar
booking. Content is Mongolian (Cyrillic).

## Salon closures (holidays)

Booking availability comes from each stylist's Google Calendar, which knows
nothing about the salon being shut. Salon-wide closed periods therefore live in
**[config/closures.js](config/closures.js)**, the single source of truth: a date
inside a closure offers no times for any stylist, and neither create-payment
handler will invoice for one.

To close the salon for a future holiday, set these in Vercel and redeploy — no
code change:

| Variable | Example | Meaning |
| --- | --- | --- |
| `SALON_CLOSURE_START` | `2027-02-06` | First closed day (inclusive) |
| `SALON_CLOSURE_END` | `2027-02-09` | Last closed day (inclusive) |
| `SALON_CLOSURE_TITLE` | `Цагаан сар` | Headline shown to customers |
| `SALON_CLOSURE_MESSAGE` | `Салон түр амарч байна.` | One-sentence explanation |

`SALON_CLOSURE_START=none` disables closures entirely. With none configured,
booking and payment behave exactly as if the feature were absent. Bookings
resume the day after `END`, and a closure whose `END` has passed is inert, so
leaving an old one configured costs nothing.

Both payment paths must stay gated: `vercel.json` rewrites
`/api/qpay/create-payment` to the standalone function
[api/qpay/create-payment.js](api/qpay/create-payment.js), while the `/api/(.*)`
catch-all serves [routes/qpay.js](routes/qpay.js). Both share
[services/closureGuard.js](services/closureGuard.js) so they cannot drift.

## Booking rules: customer gender and the non-refundable deposit

Two owner rules gate every deposit, enforced in
[services/bookingRules.js](services/bookingRules.js) and shared by both
create-payment handlers (same reason as the closure guard):

- **Gender.** Women are served by female hairdressers, men by male ones. The
  booking asks «Үйлчлүүлэгч: Эмэгтэй / Эрэгтэй» first and lists only matching
  hairdressers; the server refuses a mismatched invoice. Each hairdresser's
  `gender` lives in [config/stylists.js](config/stylists.js) (from the team
  page's «Эмэгтэй үсчид» / «Эрэгтэй үсчид»), mirrored in `script.js`'s
  `STYLIST_CONFIG_CLIENT` — a test checks the two agree. A new hairdresser
  needs a gender, or no deposit can be taken for them. Never guess one.
- **Deposit terms.** The customer must tick «Урьдчилгаа төлбөр … зөвшөөрч
  байна.» before the QR exists; without it no invoice is created. The time
  they agreed, the exact wording and the QPay invoice id are written into the
  Google Calendar event — the owner's record for a dispute.

`POST /api/calendar/book` runs after payment, so it never refuses a missing
gender or agreement (it marks them "not recorded" instead) — only an explicit
mismatch.

## Paid invoices always end in a booking or an alert

Every invoice carries a signed `callback_url`
([services/lateBooking.js](services/lateBooking.js)) that QPay calls on payment,
so a customer who pays after the page stops polling (5 min fast, then up to
30 min) or closes it is still handled by `/api/qpay/late-payment`. The browser's
`/api/calendar/book` and that callback share
[services/bookingWriter.js](services/bookingWriter.js): one calendar event id per
invoice (no duplicates, whichever arrives first), and if the slot was taken in
the meantime, a non-blocking "⚠ ТӨЛСӨН, ЦАГ ДАВХЦСАН" note on the calendar plus a
Telegram alert with the customer's details. Set in Vercel:

| Variable | Meaning |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot that posts salon alerts (from @BotFather) |
| `TELEGRAM_CHAT_ID` | Salon chat/group the bot posts into |
| `BOOKING_CALLBACK_SECRET` | Optional signing key for callbacks; defaults to one derived from `QPAY_PASSWORD` |

Without the Telegram variables alerts are only logged (`SALON ALERT NOT SENT`)
— the calendar note still records the paid customer.

The salon no longer offers manicure (September 2026): no manicure service,
price or stylist may appear or be bookable. The manicurist's Google Calendar
keeps her past appointments and is simply no longer referenced.

## Service durations (booking)

Services take different amounts of time — Оффис колор ~4h, хими ~2h — and
availability must only offer start times where the whole appointment finishes
before closing, with no overlap against existing bookings. The figures live in
**[data/serviceDurations.json](data/serviceDurations.json)**, read by the server
through [config/serviceDurations.js](config/serviceDurations.js) and fetched by
the booking UI, so there is one source of truth and no client copy to drift.

The server resolves duration from the customer's selected services and ignores
any `totalDuration` the browser sends — that number decides how much of a
stylist's day is blocked. An unrecognised service name costs the default
(60 min), never zero.

Most figures are engineering estimates marked `"confirm": true` and still need
the salon's sign-off; editing the JSON is the whole change. See
**[docs/SERVICE_DURATIONS.md](docs/SERVICE_DURATIONS.md)** for the full rationale
and what is still open.

## Design Context

Design decisions are governed by two root documents — read them before any
UI/UX work:

- **[PRODUCT.md](PRODUCT.md)** — strategic: register (`brand`), users, purpose,
  brand personality (eco · modern · premium), anti-references, design
  principles, accessibility target (WCAG AA).
- **[DESIGN.md](DESIGN.md)** — visual system: palette (dark forest-green with a
  mint accent, "The Moonlit Conservatory"), Manrope type scale, elevation,
  components, and Do's/Don'ts. Token frontmatter is normative.

The impeccable skill is the design authority for this project; prefer it over
generic UI tooling. The `.impeccable/` directory holds its sidecar
(`design.json`) and live-mode config.
