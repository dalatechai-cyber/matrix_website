# Two branches, two bank accounts: QPay, calendars and what to set

Written 2026-10-03. Яармаг's booking and payments are unchanged byte for byte
(a test checks the invoice body). Парк Од is built, tested and switched off: it
opens by itself once the variables below exist and the site is redeployed.

## How booking and QPay work today

- **Vercel project** `matrix-website` (team «Bilguun's projects»), production
  branch `main`, served at www.matrixecosalon.org. Express app (`server.js`)
  plus one standalone function, `api/qpay/create-payment.js`, that `vercel.json`
  routes `/api/qpay/create-payment` to. Both create-payment paths share the
  same guards (closure, gender, deposit agreement, branch, the 5-minute hold).
- **QPay product: Quick QR v2** (`https://quickqr.qpay.mn/v2`). One partner
  login: `QPAY_USERNAME` + `QPAY_PASSWORD`, with `terminal_id` `DALATECH_AI`
  in the code.
  1. `POST /auth/token` (Basic auth) → bearer token.
  2. `POST /invoice` with `merchant_id`, `amount` (decided by the server from
     the hairdresser's level, never the page), `currency` MNT, `description`
     (name – phone), `mcc_code` 7230, `bank_accounts` (the account that
     receives the money) and a signed `callback_url`.
  3. Confirmed only by asking QPay: `POST /payment/check {invoice_id}`; the
     page polls (3 s, then 12 s, up to 30 min) and QPay calls the signed
     callback (`/api/qpay/late-payment`) even if the page is closed.
  4. Paid → the appointment is written to the hairdresser's Google Calendar
     (service account `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`).
- Яармаг's merchant was registered under this same login by
  `createMerchant.js` (`POST /v2/merchant/company`) with the owner's account.
- Environment variable NAMES the site reads (from the code; the Vercel
  connection here may not list the project's variables): `QPAY_USERNAME`,
  `QPAY_PASSWORD`, `QPAY_MERCHANT_ID` (Express path only), `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
  `GOOGLE_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `BOOKING_CALLBACK_SECRET` (optional), `BASE_URL`, `SALON_CLOSURE_*`,
  `SITE_MAINTENANCE`, `BOOKING_TEST_TOKEN`; new: `PARKOD_*`, `CRON_SECRET`.

## The design for Парк Од

**Same QPay, her own bank account** (founder, 2026-10-04). Парк Од uses the
founder's existing QPay login and merchant, exactly as Core Language and Matrix
do. Her invoice is Яармаг's invoice with ONE change: `bank_accounts` names her
Khan Bank account instead of Яармаг's. No merchant is registered for her, and
nothing is needed from Boloroo but her account details. A test compares the two
invoice bodies field by field.

- Same `QPAY_USERNAME`/`QPAY_PASSWORD`, terminal `DALATECH_AI`, and the same
  `merchant_id` each payment path has always used. Same currency, MCC 7230 and
  signed callback.
- `bank_accounts` is `[{ account_bank_code, account_number, account_name,
  is_default: true }]`, read from the three variables below. Яармаг's invoice
  sends the same four fields, so the holder's name is needed.
- Яармаг's account number is refused for her, and a missing variable keeps
  Парк Од closed («Онлайн захиалга удахгүй нээгдэнэ»).
- Her payment alerts go to `PARKOD_TELEGRAM_CHAT_ID`, never to Яармаг's chat.
  For now that is the founder's own chat; Boloroo checks Парк Од's Messenger
  herself (founder, 2026-10-04).

**Proof.** Set the variables on Preview, open the site with the test link
(`/?test=<BOOKING_TEST_TOKEN>`), book at Парк Од and pay the 100₮ QR; Boloroo
confirms the 100₮ reached HER account. Only then set the same on Production.

## Connecting Парк Од's calendars (same structure as Яармаг)

Яармаг: one secondary Google calendar per hairdresser inside the booking account
booking@matrixecosalon.org, each shared with the site's service account (the
address in `GOOGLE_SERVICE_ACCOUNT_EMAIL`, «Make changes to events»); the site
reads free/busy and writes bookings and 5-minute holds with that service
account; Яармаг's calendar ids are fixed in `config/stylists.js`. Парк Од is
identical except: the calendars live in tarasalon.parkod@gmail.com, and each id
comes from a Vercel variable (`PARKOD_CALENDAR_<NAME>`, table below).

**Setup check, Preview deployments only** (404 on Production):
`/api/setup/check` shows the service-account address to share with, each
hairdresser's variable, whether the site can read that calendar, and each
branch's readiness. `/api/setup/prove?stylist=Saraa` writes one marked test
event into her calendar, checks it landed there and that its hour is no longer
offered, then deletes it (Парк Од only; Яармаг's calendars are only read).

## Environment variables (project `matrix-website`)

Set on **Preview** first to test, then **Production** at go-live; every change
needs a redeploy. None has a known value yet, so none was set by this round.

| Name | Secret? | Value |
| --- | --- | --- |
| `PARKOD_QPAY_BANK_CODE` | no | Her bank's QPay code: Khan Bank is `040000` (as Яармаг's) |
| `PARKOD_QPAY_ACCOUNT_NUMBER` | treat as sensitive | Her Khan Bank account number |
| `PARKOD_QPAY_ACCOUNT_NAME` | treat as sensitive | The account holder's name exactly as Khan Bank shows it |
| `PARKOD_TELEGRAM_CHAT_ID` | no | The chat her payment alerts go to — for now the founder's own; never Яармаг's |
| `PARKOD_CALENDAR_BOLOROO`, `_SARAA`, `_TOMOO`, `_BULGAA`, `_ENHUUSH`, `_CHIMEGEE`, `_TUCHKU` | no | Each calendar's «Calendar ID» (Google Calendar → Settings → Integrate calendar), after it is shared with tarasalon.parkod@gmail.com AND the site's service account (the address in `GOOGLE_SERVICE_ACCOUNT_EMAIL`), both «Make changes to events» |
| `CRON_SECRET` | yes | Any random 32+ characters. Turns on the daily hold sweep (Vercel Cron sends it); without it the sweep is off and expired holds are cleared only when a day's times are read |

A hairdresser is bookable as soon as her calendar variable exists; the branch
opens when at least one is set AND the bank account and Telegram variables are
complete.

## Rollback note

Callbacks signed by this version name hairdressers by their new ASCII ids
(`oyunaa`, `badamaa`, `zaya`, `chimgee`, `saraa`…). A rollback to the version
before it cannot read them: a payment made on an invoice from this version
would reach the failure alert (customer details included) instead of being
booked automatically. Roll back only with no open invoices, or book those by
hand from the alert.

## Limits of the hold

- The hold is the calendar event itself; the site has no database. More than
  20 placed holds in 10 minutes from one address are refused (per server
  instance; generous because mobile carriers share addresses; the test link is
  exempt). A determined person with many addresses could still hold times for
  5½ minutes each — the same exposure the payment page has always had.
- A customer's earlier hold is not released by a newer one (its QR may still
  be paid); it expires on its own.
- dala-ai's in-chat booking must follow the same rule (yield to anything
  overlapping except a hold placed after its own, and treat an expired `sh`
  hold as free). A chat hold is recognised by its private
  `dalaBookingState = 'hold'`, never by its `dh…` id (a paid chat booking
  keeps that id). Its PR documents what it implements.
