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
