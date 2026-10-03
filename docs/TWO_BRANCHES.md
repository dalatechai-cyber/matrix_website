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

**What could not be verified.** QPay's documentation site (developer.qpay.mn)
is blocked from this environment. The endpoints and fields above are from the
repository's own working code and from unofficial Quick QR SDKs. That the
money follows the invoice's `bank_accounts` is the strongest inference, not a
documented fact. Hence the questions below, before the first real payment.

## Exactly what to ask QPay (one e-mail, from the login's owner)

> Сайн байна уу. Бид Quick QR v2 API-г `DALATECH_AI` terminal-аар ашиглаж,
> «Matrix Eco Salon» merchant-аар төлбөр авдаг. Шинэ салбар «Tara Salon — Парк Од»
> өөр эзэмшигчтэй, өөрийн дансанд төлбөр авах ёстой. Дараахыг баталж өгнө үү:
> 1. Нэг terminal / нэвтрэх эрхээр хоёр дахь merchant (`POST /v2/merchant/person`
>    эсвэл `/company`) бүртгэж, түүгээр нэхэмжлэх үүсгэж болох уу? Идэвхжүүлэх,
>    гэрээ, баримт бичиг шаардлагатай юу?
> 2. Нэхэмжлэхийн `bank_accounts`-д заасан дансанд мөнгө шилжих үү, эсвэл
>    merchant-д бүртгэсэн дансанд уу? Данс эзэмшигч merchant-ийн регистртэй
>    таарах ёстой юу?
> 3. Мөнгө хэдэн хоногт шилжих вэ, шимтгэл ямар байх вэ?
> 4. Хэрэв нэг эрхээр боломжгүй бол Парк Од-д тусдаа terminal/нэвтрэх эрх олгоно уу.

(In English: may terminal DALATECH_AI register and invoice for a second
merchant; does an invoice settle into its `bank_accounts` or the merchant's
registered account, and must the holder match the merchant; activation,
contract, documents, settlement time and fee; else issue Парк Од her own login.)

**From the Парк Од owner** (for the registration form): company or individual;
register number; legal name (company) and the owner's surname and given name;
trading name («Tara Salon Парк Од»); address with city/aimag and district/sum;
phone; e-mail (bolotuyagongor@gmail.com); her bank, account number and the
holder's name exactly as the bank has it.

Then register her merchant, either way:
- GitHub → Actions → «Register Парк Од QPay merchant»: store the filled form
  (the JSON described at the top of `scripts/qpay-merchant.js`) as the
  repository secret `PARKOD_MERCHANT_FORM`, run with send = false (checks the
  form), then send = true; the log shows only the merchant id. Uses the same
  `QPAY_USERNAME`/`QPAY_PASSWORD` repository secrets as Яармаг's registration.
- or locally: `node scripts/qpay-merchant.js register parkod.json` (dry run),
  then with `--send`. One real 100₮ test
through the test link, and she confirms the money reached her account.

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

- The hold is the calendar event itself; the site has no database. A burst of
  holds from one address is refused (8 in 10 minutes, per server instance),
  and a customer keeps one website hold per calendar, but nothing stops a
  determined person with many addresses from holding times for 5½ minutes
  each — the same exposure the payment page has always had for invoices.
- dala-ai's in-chat booking must follow the same rule (yield to anything
  overlapping except a hold placed after its own, and treat an expired `sh`
  hold as free). Its PR documents what it implements.
