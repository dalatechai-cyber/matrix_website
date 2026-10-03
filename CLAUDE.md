# Tara Salon

Multi-page site for **Tara Salon** (Ulaanbaatar, Mongolia; formerly Matrix Eco
Salon) with two branches — **Яармаг** and **Парк Од** — same brand and prices,
separate owners. Six pages — `index`, `services` (price list), `products`
(Amos), `keune-products`, `booking`, `contact` — served by
`server.js`, which assembles them with `lib/pages.js` (shared `partials/`,
branch details from `data/branches.json`). Styles and scripts live in
`assets/`, logos in `brand/`, fonts in `fonts/`. An Express API (`routes/`)
handles QPay payments and Google Calendar booking. Content is Mongolian
(Cyrillic). `PROGRESS.md` tracks the rebuild. Photos: `data/gallery.json` lists
the feature photos (4:5 WebP crops in `img/photos/`, never upscaled);
`docs/PHOTOS.md` says where each came from. The «Бүтээл» gallery was removed on
2026-10-04 (its photos were Matrix's; `/zurag.html` forwards home) and returns
only with Tara's own photos. The Facebook export lives only on branch
`tara-photos` — never merge it or ship it. The site moves to **tarasalon.org**
(Namecheap) later: `docs/DOMAIN_MOVE.md`; until then it is matrixecosalon.org.

## Branches: calendars and QPay never cross

[config/branches.js](config/branches.js) is the rule. Every hairdresser in
[config/stylists.js](config/stylists.js) has a `branch`; the hairdresser
decides the branch, and the branch decides the calendar and the QPay account.
Both create-payment handlers refuse a request that names another branch, a
branch not yet connected, a retired hairdresser or one without a calendar,
before QPay is called. Яармаг keeps exactly its original QPay settings.

**QPay, two branches, one merchant.** Both branches use the site's one QPay
Quick QR login (`QPAY_USERNAME`/`QPAY_PASSWORD`, terminal `DALATECH_AI`) and
the same merchant, exactly as Core Language and Matrix do (founder,
2026-10-04). The only difference is the bank account a deposit is paid into,
which every invoice names (`bank_accounts`): Парк Од REQUIRES
`PARKOD_QPAY_BANK_CODE` (Khan Bank `050000`), `PARKOD_QPAY_ACCOUNT_NUMBER`
(her full IBAN, `MN…`, checksum-validated) and `PARKOD_QPAY_ACCOUNT_NAME`
(«БОЛОРТУЯА ГОНГОР»); Яармаг's account number is refused for her. Яармаг's
payee name is «ОЮУНСҮРЭН ЭРХЭМБААТАР» (founder, 2026-10-04). No
merchant is registered for her. Proof: a real 100₮ test lands in her account.
Full design: [docs/TWO_BRANCHES.md](docs/TWO_BRANCHES.md).

A branch takes online bookings only when it has opening hours in
`data/branches.json`, at least one hairdresser with a calendar, a complete
QPay account and (Парк Од) its own alert chat `PARKOD_TELEGRAM_CHAT_ID` —
alerts never go to the other owner's chat; until then the site shows
«Онлайн захиалга удахгүй нээгдэнэ». Парк Од's calendars come from
`PARKOD_CALENDAR_<NAME>` (e.g. `PARKOD_CALENDAR_SARAA`): connecting a
hairdresser is a Vercel variable and a redeploy. The booking page gets
hairdressers from `GET /api/branches` — there is no copy in the browser.

## Hairdressers: names, levels, the team section

Shown everywhere by the short Latin names the salon chose on 2026-10-03
(Oyunaa, Badamaa, Uyanga, Zaya, Chimgee, Anand, and Otgonjargal — her full
name, founder 2026-10-04; Boloroo, Saraa, Tomoo, Bulgaa, Enhuush, Chimegee,
Tuchku), exactly as written. Former names stay accepted as
aliases so an open page or a signed callback still reaches the same person.
Levels: SPECIAL and Мастер 20,000₮, 1-р зэрэг 10,000₮ (Яармаг only); English
titles «SPECIAL Hair Stylist», «Master Hair Stylist», «Hair Stylist» (1-р
зэрэг; founder 2026-10-04) — never «hair salonner». The home page's «Манай
үсчид» section renders from the same list. A `retired` hairdresser is not
shown or bookable and is kept only for old callbacks.

**Level-named haircuts** («Тайралт том хүн /SPECIAL/», «/МАСТЕР/», «/1-р
зэрэг/») go only to a hairdresser of that level (founder, 2026-10-04): the
booking page lists only those, hides a level the branch lacks, and both
create-payment handlers refuse a mismatch (`services/bookingRules.js`). The
deposit is deducted from the service price («Урьдчилгаа төлбөр үйлчилгээний
үнээс хасагдана.» on the home, price and booking pages).

## The 5-minute hold (website ↔ Messenger)

Before any QR, both create-payment handlers hold the time on the
hairdresser's calendar ([services/bookingHold.js](services/bookingHold.js)):
an opaque `sh…` event over the whole appointment, expiring with the QR (+30 s).
After inserting, it looks again and yields to anything overlapping except a
hold placed after its own (a chat hold is one with `dalaBookingState` 'hold'). Taken: 409 «taken», no QR. Calendar unreadable:
no QR. The paid booking replaces the hold; expired holds are deleted when a
day's times are read and by the daily cron (`/api/calendar/sweep-holds`,
needs `CRON_SECRET`). dala-ai's in-chat booking holds with `dh…` events on
the same calendars, so neither side can sell a time the other is holding.

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
  `gender` lives in [config/stylists.js](config/stylists.js) and reaches the
  booking page only through `/api/branches`. A new hairdresser needs a
  gender, or no deposit can be taken for them. Never guess one.
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

## Maintenance and test mode

Both off unless set in Vercel (Production), and like every env var they take
effect only after a Redeploy — see [config/siteMode.js](config/siteMode.js).

| Variable | Effect |
| --- | --- |
| `SITE_MAINTENANCE=on` | Every page (served by `server.js`, not static) shows the maintenance notice; availability and both create-payment paths refuse. Paid paths stay open. |
| `BOOKING_TEST_TOKEN` (16+ chars) | `/?test=<token>` gives that browser a signed HttpOnly cookie: bypasses maintenance, deposit 100₮, booking titled «ТЕСТ». |

The deposit is always decided server-side (`depositFor`): the stylist's price,
or 100₮ only for the test cookie. The page's `amount` is never charged.

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

The service menu and price list is **[data/services.json](data/services.json)**
— the salon's list of 1 October 2026, same prices at both branches, names and
prices exactly as on that list (a test pins every one). Each bookable choice
has a `key` (unique, comma-free; a service priced by hair length has one per
богино / дунд / урт); every key must be a current entry in
`data/serviceDurations.json` — a test checks. Entries marked `retired` there
are the old menu, kept in order so callbacks signed before the switch decode.

The server resolves duration from the customer's selected services and ignores
any `totalDuration` the browser sends — that number decides how much of a
stylist's day is blocked. An unrecognised service name costs the default
(60 min), never zero.

The current list's 62 figures were confirmed by the salon on 2026-10-03;
`"confirm": true` remains only on retired entries. Editing the JSON is the
whole change. See
**[docs/SERVICE_DURATIONS.md](docs/SERVICE_DURATIONS.md)** for the full rationale
and what is still open.

## Design Context

Design decisions are governed by two root documents — read them before any
UI/UX work:

- **[PRODUCT.md](PRODUCT.md)** — strategic: register (`brand`), users, purpose,
  brand personality (eco · modern · premium), anti-references, design
  principles, accessibility target (WCAG AA).
- **[DESIGN.md](DESIGN.md)** — visual system "Plaster & Steel" (September
  2026 rebrand): warm limewash beige, basalt #2B2622 for the header, footer
  and primary buttons, the logo's star orange #E8985C as accent only, copper
  #8A4B25 for readable accent text, Cormorant Garamond headings, Geologica
  body, logo rules (the metallic logo sits only on basalt). Token frontmatter
  is normative.

The impeccable skill is the design authority for this project; prefer it over
generic UI tooling. The `.impeccable/` directory holds its sidecar
(`design.json`) and live-mode config.
