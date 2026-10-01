# One end-to-end test booking before launch

## Is there a QPay sandbox we can use?

Not for this setup. The site talks to QPay's **QuickQR** API in production
(`https://quickqr.qpay.mn/v2`, [services/qpay.js](../services/qpay.js)), with
each hairdresser's own bank account on the invoice. QPay's documented sandbox
(`merchant-sandbox.qpay.mn`) belongs to the separate Merchant API, with
different credentials and invoice format. A sandbox invoice also cannot be paid
from a bank app, so QPay never calls the payment callback. That means a sandbox
could not prove the parts that matter: payment, calendar booking, Telegram
alert and late-payment callback. Before relying on this, ask QPay support:
"Does QuickQR v2 have a test environment where an invoice can be marked paid
and the callback fires?" I could not reach qpay.mn from my environment to check.

**What the site already has instead:** the test link (`BOOKING_TEST_TOKEN`,
see [config/siteMode.js](../config/siteMode.js)). It runs the real flow end to
end, with the real QPay, calendar, Telegram chat and callback. The only
differences are a **100₮** deposit instead of 20,000₮, «ТЕСТ» in the calendar
title and «[ТЕСТ]» on alerts. I recommend it over a 20,000₮ booking. The
steps below are the same either way. For 20,000₮, leave out `?test=…`, write
«ТЕСТ» in the customer name, and expect 20,000₮ per payment (60,000₮ for all
three tests).

## Before you start

1. **Run it on the live domain, after the merge.** QPay's payment callback goes
   to the address the booking was made on. Vercel preview addresses are
   password-protected, so QPay's callback is refused there and test 2 cannot
   pass on a preview. Run the tests right after launch, before announcing it.
2. In Vercel → Settings → Environment Variables (Production), check that
   these are set: `QPAY_USERNAME`, `QPAY_PASSWORD`, `QPAY_MERCHANT_ID`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `BOOKING_TEST_TOKEN` (16+
   random characters). Redeploy after any change. I can't see these myself
   (the Vercel connection refuses to list them).
3. Agree with the salon on **one hairdresser and two free times** (e.g.
   tomorrow evening). Tell her these are tests. **The deposit lands in that
   hairdresser's own bank account**, so agree that she refunds it, or that the
   salon keeps it.
4. Have the salon's Telegram alert group open, the hairdresser's Google
   Calendar open, and Vercel → Project → Logs open, filtered to `late-payment`.

## Test 1: normal booking (page stays open)

1. On your phone, open `https://<domain>/?test=<BOOKING_TEST_TOKEN>`, then
   go to «Цаг захиалах». The booking page shows the «ТЕСТ ГОРИМ» banner.
2. Choose Яармаг → «Тайралт хүүхэд /0–13 нас/» → Эрэгтэй → the agreed
   hairdresser → time 1 → name «ТЕСТ <your name>», your real phone → tick the
   deposit box → QR.
3. Pay the QR with your bank app, then return to the page.

**Expected:**
- Within a few seconds the page confirms the booking.
- The calendar has **one** event, «ТЕСТ – …», at time 1, 30 minutes long.
- The event description shows the service, phone, customer gender, deposit
  amount, the deposit-terms wording with the time you ticked it, and the QPay
  invoice id.
- Vercel logs show `late-payment: QPay callback` for that invoice, then
  `late-payment: outcome <invoice id> already-booked` (the page booked first).
  This proves QPay's callback reaches the site.
- **No Telegram message.** Alerts are sent only when something goes wrong
  (slot clash, booking failure).

## Test 2: customer closes the page before paying (late-payment callback)

1. On a laptop, open the same test link and book time 2 the same way, up to the
   QR.
2. Take a photo of the QR with your phone, **close the laptop's browser tab**,
   then pay from the photo with your phone's bank app.

**Expected:** within about a minute, an event «ТЕСТ – …» appears at time 2.
The logs show `late-payment: outcome <invoice id> booked`. The calendar holds **one** event only.

## Test 3: two people pay for the same time (Telegram alert)

1. Open the test link in **two** tabs. In both, pick the same hairdresser and
   the same time (time 1 again is fine if you deleted test 1's event; otherwise
   any free time). Get a QR in **both** tabs.
2. Pay tab A. Wait for its confirmation. Then pay tab B.

**Expected:**
- Tab A books normally.
- Tab B says «Төлбөр тань амжилттай орсон. Харамсалтай нь сонгосон цаг тань …
  өөр хүнд захиалагдсан байна…».
- The calendar shows a second event titled «ТЕСТ – ⚠ ТӨЛСӨН, ЦАГ ДАВХЦСАН – …».
- The Telegram group gets «[ТЕСТ] ⚠️ Урьдчилгаа төлсөн үйлчлүүлэгчийн цаг
  давхцсан» with the customer's name, phone and invoice id.
- If no Telegram message arrives, the logs show `SALON ALERT NOT SENT`, and the
  Telegram variables are missing or wrong.

## If launch goes wrong: Vercel Instant Rollback

Instant Rollback points the live domain back at the previous production
deployment within seconds. It does not rebuild anything, and there is no code
change or Git revert. Use it if the live site breaks right after the merge, for
example booking errors, payments failing, or pages not loading.

**Before the merge**, write down the current production deployment: Vercel →
Project `matrix-website` → Deployments, filter to Production, and note the top
entry (its URL or ID). That is the deployment you would roll back to.

**Dashboard (fastest):**
1. Vercel → Project `matrix-website` → Deployments.
2. Find the previous production deployment you noted. Open its ⋯ menu and choose
   **Instant Rollback**, then confirm. The project overview page also offers
   Instant Rollback for the current production deployment.
3. Open the live domain in a private window and check that the old site is back.

**CLI (same result):**
```bash
vercel rollback <previous-deployment-url-or-id>
vercel rollback status
vercel logs --environment production --status-code 5xx --since 5m
```

**Know before you press it:**
- On the Hobby plan you can roll back only to the deployment directly before
  the current one. Choosing a specific older deployment needs Pro or
  Enterprise.
- After a rollback, Vercel stops putting new production deployments on the
  domain automatically. Pushes to `main` will build but not go live. When the
  fix is ready, promote that deployment (⋯ → Promote, or
  `vercel promote <deployment-url>`) or undo the rollback from the project
  overview.
- A rollback does not undo bookings. Calendar events and QPay invoices created
  by the new site stay as they are. Check the Telegram alert group and the
  hairdressers' calendars for any customer who paid in the window between
  launch and rollback.
- The rolled-back deployment runs with the settings it was built with. Change
  environment variables only after the fix, then redeploy.

## Afterwards

- There is no separate booking database. The calendar event (plus the QPay
  invoice and the Vercel log line) is the booking record. Screenshot each event
  and the Telegram message, then delete the test events from the calendar.
- Settle the test deposits with the hairdresser (refund or keep).
- Change or remove `BOOKING_TEST_TOKEN` in Vercel and redeploy, so the test link
  stops working.
- Парк Од cannot be tested yet: it takes no online bookings until its
  hairdressers, QPay account and `PARKOD_TELEGRAM_CHAT_ID` are set.
