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

Quick QR is QPay's product for a partner who registers several merchants
under one login. So Парк Од is a **second merchant under the same login**:

- the site invoices her bookings with HER merchant id and HER bank account in
  `bank_accounts`, through the shared login (or her own login, if QPay ever
  issues one — all three `PARKOD_QPAY_USERNAME/PASSWORD/TERMINAL_ID` or none);
- nothing of Яармаг's is ever used for her: a merchant id or account number
  equal to Яармаг's is refused, and an incomplete setting keeps Парк Од closed;
- her alerts go only to her own Telegram chat.

**How it is proven.** No e-mail to QPay (founder, 2026-10-04). The founder
registers Парк Од as a merchant under his login with her bank account, exactly
as Яармаг was registered, and the proof is a real 100₮ test that lands in her
account. (QPay's documentation could not be read from this environment; the
fields below come from the repository's own working code and Quick QR SDKs.)

## Registering Парк Од's merchant — what to get from Boloroo, and the steps

**Details to get from Boloroo** (as on her documents; nothing else is needed):

| Field | If she registers as an individual (`person`) | If as a company (`company`) |
| --- | --- | --- |
| Register number | her РД (e.g. two letters + eight digits) | the company's register number, and her own РД as owner |
| Names | surname (овог) and given name (нэр) | company legal name, and owner's surname and given name |
| Trading name | «Tara Salon Парк Од» (`business_name`) | «Tara Salon Парк Од» (`name`) |
| Address | Баянзүрх дүүрэг, 26-р хороо, Парк-Од молл, 4 давхар, 405 тоот | same |
| City / district | Улаанбаатар / Баянзүрх (the script looks up QPay's codes) | same |
| Phone | the number QPay may call her on | same |
| E-mail | bolotuyagongor@gmail.com | same |
| Bank account | her bank's name, account number, holder name exactly as the bank shows it | the company account |
| MCC | 7230 (beauty and barber shops), as Яармаг | same |

Ask her whether she trades as an individual or a company: that decides the form.

**Steps (founder)**

1. Look up the codes: `node scripts/qpay-merchant.js cities`, then
   `node scripts/qpay-merchant.js districts <Улаанбаатар's code>`; note
   Баянзүрх's code. (Needs `QPAY_USERNAME`/`QPAY_PASSWORD` in your shell, e.g.
   from `vercel env pull`; never printed.) Her bank's code: QPay's bank code
   for her bank (Khan Bank is `040000`, as Яармаг).
2. Fill `scripts/parkod-merchant.example.json` (a copy, outside the repo — the
   repo is public) with her details.
3. Check it: `node scripts/qpay-merchant.js register parkod.json` (dry run:
   validates, sends nothing). Or on GitHub: put the JSON in the repository
   secret `PARKOD_MERCHANT_FORM` and run Actions → «Register Парк Од QPay
   merchant» with send = false (the log never shows her details).
4. Register: the same with `--send` (or send = true). It prints the merchant id.
5. Set in Vercel (Preview first): `PARKOD_QPAY_MERCHANT_ID` (the printed id),
   `PARKOD_QPAY_BANK_CODE`, `PARKOD_QPAY_ACCOUNT_NUMBER`,
   `PARKOD_QPAY_ACCOUNT_NAME`, `PARKOD_TELEGRAM_CHAT_ID`, and at least one
   `PARKOD_CALENDAR_<NAME>`; Redeploy.
6. Proof: open the site with the test link (`/?test=<BOOKING_TEST_TOKEN>`),
   book at Парк Од, pay the 100₮ QR, and Boloroo confirms the 100₮ reached HER
   account. Only then set the same variables on Production.

## Environment variables (project `matrix-website`)

Set on **Preview** first to test, then **Production** at go-live; every change
needs a redeploy. None has a known value yet, so none was set by this round.

| Name | Secret? | Value, and where it comes from |
| --- | --- | --- |
| `PARKOD_QPAY_MERCHANT_ID` | no | Printed by `scripts/qpay-merchant.js register … --send` (or given by QPay) |
| `PARKOD_QPAY_BANK_CODE` | no | Her bank's QPay code (Яармаг's Khan Bank is `040000`); from QPay's bank list or her bank |
| `PARKOD_QPAY_ACCOUNT_NUMBER` | treat as sensitive | Her account number |
| `PARKOD_QPAY_ACCOUNT_NAME` | treat as sensitive | Account holder's name exactly as the bank has it |
| `PARKOD_TELEGRAM_CHAT_ID` | no | Her alert group: add the salon bot to a group with her, read the chat id |
| `PARKOD_CALENDAR_BOLOROO`, `_SARAA`, `_TOMOO`, `_BULGAA`, `_ENHUUSH`, `_CHIMEGEE`, `_TUCHKU` | no | Each calendar's «Calendar ID» (Google Calendar → Settings → Integrate calendar), after it is shared with tarasalon.parkod@gmail.com AND the site's service account (the address in `GOOGLE_SERVICE_ACCOUNT_EMAIL`), both «Make changes to events» |
| `CRON_SECRET` | yes | Any random 32+ characters. Turns on the daily hold sweep (Vercel Cron sends it); without it the sweep is off and expired holds are cleared only when a day's times are read |
| `PARKOD_QPAY_USERNAME`, `_PASSWORD`, `_TERMINAL_ID` | yes | Only if QPay issues Парк Од a login of her own; otherwise leave unset |

A hairdresser is bookable as soon as her calendar variable exists; the branch
opens when at least one is set AND the QPay and Telegram variables are
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
