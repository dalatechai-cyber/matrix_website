# Launch day — Tara Salon, both branches

Every step for taking Яармаг and Парк Од live, in order: the website
(matrix_website), Дали for both tenants (dala-ai), in-chat booking, the
domain. **You** = the founder (merges, credentials, SQL editor, Vercel,
Facebook, Namecheap, payments). **Claude** = checks, prepared files, fixes.
Claude never merges, pushes to `main`, runs `supabase db push` or touches
Production settings (the committed guardrails ask before each). The one
exception is B2 step 5: Claude applies the three dala-ai migrations, only on
your «go», one at a time with read-back.

Written 2026-10-04. The PRs, all drafts, CI green:

| Repo | PR | What |
| --- | --- | --- |
| matrix_website | #82 | The rebrand (base of #83) |
| matrix_website | #83 | Two branches, names and levels, 5-minute hold, Парк Од booking, setup check |
| matrix_website | #84 | Guardrails hook |
| dala-ai | #283 | Яармаг Дали answers, photo and reel price question, migration `0083` |
| dala-ai | #284 | Парк Од tenant, Latin names for both tenants, approvals folder |
| dala-ai | #285 | In-chat booking for both branches, migrations `0082` and `0084` |
| dala-ai | #286 | Guardrails hook |

## Still blocked

| Blocker | Blocks | Unblocks when |
| --- | --- | --- |
| **Page admin access to Парк Од's Facebook Page** (tomorrow) | C1–C8 (Парк Од's Дали) and her in-chat booking | You are admin and have read her Page ID |
| **Парк Од's Page ID** (expected 100067391025472, unconfirmed) | C2 | You read it on the Page (Settings → Page transparency / About → «Page ID») |

---

## A. The website (matrix_website)

**A1 — Claude, the day before.** Re-run every test on the final heads of #82,
#83 and #84 (`npm test`). Confirm CI is green, and check the preview's setup
page (`/api/setup/check`): both branches ready, 14 calendars readable and
distinct. (`testLinkReady` is false on Preview since the token was deleted
there; the Production token in A2 is what A4 needs.)

**A2 — You: Production variables** (Vercel → `matrix-website` → Settings →
Environment Variables → **Production**). Copy each value from its Preview
entry:

- Парк Од's bank account, exactly as on Preview:
  - `PARKOD_QPAY_BANK_CODE` = `050000` (Khan Bank);
  - `PARKOD_QPAY_ACCOUNT_NUMBER` = her full IBAN, `MN` + 18 digits, no spaces
    (spaces are dropped if pasted; a wrong check digit is refused and Парк Од
    stays closed);
  - `PARKOD_QPAY_ACCOUNT_NAME` = `БОЛОРТУЯА ГОНГОР`.

  Яармаг's payee name («ОЮУНСҮРЭН ЭРХЭМБААТАР») and account number live in
  the code (`config/branches.js`); there is no variable to set for her.
- `PARKOD_TELEGRAM_CHAT_ID` (your own chat for now);
- check that `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` exist in Production
  (Яармаг's alerts; Preview has no `TELEGRAM_CHAT_ID`, so the preview cannot
  test Яармаг's alert);
- the seven calendars: `PARKOD_CALENDAR_BOLOROO`, `_SARAA`, `_TOMOO`,
  `_BULGAA`, `_ENHUUSH`, `_CHIMEGEE`, `_TUCHKU`;
- `CRON_SECRET`: any random 32+ characters, e.g. `openssl rand -hex 32`;
- `BOOKING_TEST_TOKEN`: 16+ characters, if Production has none yet.

Also check that `QPAY_MERCHANT_ID` (Production) is
`17e69f2a-d1a4-4fe6-a5a2-34a649378414`. The second payment path reads it from
there, and both branches invoice under it.

*Check:* nothing changes yet. Production keeps running the old code until A3.

**A3 — You: merge**, in this order:

1. #84 (guardrails) into `main`, at any time.
2. #83 into its base branch `claude/tara-salon-rebrand-44dg5w`.
3. #82 into `main`.

Vercel then builds and deploys Production by itself.

*Check (Claude, within 10 minutes):*

- the Production deployment is READY;
- `https://www.matrixecosalon.org/api/health` returns `ok`;
- `/api/branches` shows both branches `ready: true`, with 7 + 7 hairdressers;
- `/api/calendar/available-slots` returns times for one hairdresser per branch;
- `/api/setup/check` returns **404** (the setup page is preview-only);
- `/zurag.html` forwards to `/`;
- the home, price and booking pages render at phone and desktop width with no
  errors.

*If anything is wrong:* Vercel → Deployments → the previous Production
deployment → «Instant Rollback». First read the rollback note in
`docs/TWO_BRANCHES.md`: it covers invoices that are still open.

**A4 — You: the live 100₮ tests** (steps under «The 100₮ test» below, on
`https://www.matrixecosalon.org`). Do one at Парк Од (Saraa): Boloroo confirms
+100₮ in her Khan Bank account. Do one at Яармаг (Uyanga): +100₮ in Яармаг's
account.

*Claude* then removes both test bookings. *Check:* each payment shows
«ТЕСТ – …» in the right calendar, and the money is in the right account. **The
website is live for both branches.**

**A5 — You: one unpaid QR** (2 minutes of your time, then a 5-minute wait).
Book any hairdresser a few days ahead, open the QR and do **not** pay. In her
Google Calendar a «⏳ Түр хадгалсан…» event appears at that time. Close the page.
*Check:* within 6 minutes the event is gone by itself, and the time is offered
again on the website and in Messenger.

How the hold is released in Production (nothing to schedule):
- **Main path, every QR:** the payment request that placed the hold stays
  alive after it answers (Vercel `waitUntil`) and deletes the hold 2 s after
  it expires: 5 min 32 s after the QR was made. It needs no schedule and no
  variable, but it needs the Pro plan: the payment functions run up to 400 s
  (`maxDuration` in `api/qpay/create-payment.mjs` and `server.mjs`). On Hobby
  (300 s) the release would be cut off and only the back-ups below remain.
- **If that is ever cut short:** an expired hold is free anyway. The website
  deletes it whenever anyone looks at that day's times or books, and Дали
  reads it as free.
- **Daily clean-up (back-up only):** Vercel Cron calls
  `/api/calendar/sweep-holds` once a day at 20:00 UTC (04:00 Ulaanbaatar),
  on Production only (Vercel never runs crons on previews), and only when
  `CRON_SECRET` is set in Production (A2). Without it the route answers 401
  and the clean-up is off; the two paths above still work. *Check after the
  first night:* Vercel → Logs, filter `sweep-holds`: one line «sweep-holds:
  deleted N expired hold(s)» and status 200.

---

## B. Дали — Яармаг (dala-ai, tenant `matrix-eco-salon`)

**B1 — Claude, the day before.** Merge #283, #285 and #284 together on a
scratch branch, then run on a scratch PostgreSQL:

- all migrations in order: `0082` → `0083` → `0084`;
- every verify suite;
- every SQL file below, then each one's revert.

Report the result. Nothing is pushed anywhere.

**B2 — You merge; Claude applies the three migrations.**

1. Merge #286 (guardrails).
2. Merge #283 into `main`. Then **Claude** merges `main` into #285 and #284
   and pushes: they conflict with #283 only in `NOTES.md` and
   `docs/schema.md` (notes, no code; checked on a scratch merge 2026-10-04).
   Wait for their CI to be green.
3. Merge #285, then #284 into `main`.
4. Wait for the Vercel deploy of `main` (READY). #285's booking code stays
   asleep while `BOOKING_MODE` is unset.
5. **Claude** applies `0082_booking`, `0083_photo_reel_question` and
   `0084_prompt_blocks_seed`, in that order, through the Supabase connector,
   one at a time with read-back, the way `0035`–`0081` were applied. Say «go»
   in the session; the guardrails ask you to confirm each one.
   **Never run `supabase db push` on this project**: the ledger records
   `0035` onward under timestamp versions, so `db push` would try to re-apply
   `0035`–`0081` (dala-ai `docs/publish-mac.md`).

Don't publish any tenant between the deploy and step 5: the publisher refuses
until `0084` exists.

*Check (Claude):* `npm run check` on `main`; the deploy is READY; in the SQL
editor, `select version, name from supabase_migrations.schema_migrations order
by version desc limit 3;` lists `0084_prompt_blocks_seed`,
`0083_photo_reel_question`, `0082_booking`.

**B3 — You: Яармаг's SQL** (Supabase → SQL editor). First merge dala-ai #287
(D-178, phones; Claude merges on your «go») and `git pull`. Run each file once, in
this order. Each one refuses a second run:

1. `scripts/provision/tara-yarmag-stylist-names-2026-10-03.sql` (Latin names,
   «Үсчдийн нэр», Otgonjargal).
2. `scripts/provision/tara-yarmag-answers-2026-10-04.sql` (deposit deducted,
   loan apps, dye brand, the hand-off line).
3. `scripts/provision/tara-yarmag-branch-phones-2026-10-04.sql` (D-178,
   dala-ai #287: «Салбарууд» gives Яармаг 76001888, 91005498 and Парк Од
   99076874, «нийтлэг утас» gone; `park_od_branch` gives 99076874). It refuses
   to run before file 1. Then publish at once (B4).

**B4 — You: publish Яармаг at once** (your Mac, set up as in «Your Mac» at
the end of this page):

```
cd ~/dalatech/dala-ai && git checkout main && git pull && npm ci
export NEXT_PUBLIC_SUPABASE_URL=https://tlggenaatnopnxzbkbuf.supabase.co
SUPABASE_SECRET_PUBLISH="$(security find-generic-password -s dala-supabase-publish-mac -w)" \
  node scripts/publish/tenant.ts --slug matrix-eco-salon
SUPABASE_SECRET_PUBLISH="$(security find-generic-password -s dala-supabase-publish-mac -w)" \
ANTHROPIC_API_KEY="$(security find-generic-password -s dala-anthropic-publish-mac -w)" \
  node scripts/publish/tenant.ts --slug matrix-eco-salon --with-model
SUPABASE_SECRET_PUBLISH="$(security find-generic-password -s dala-supabase-publish-mac -w)" \
  node scripts/publish/tenant.ts --slug matrix-eco-salon --publish
```

The first is the dry run: it must be clean. The second is the one paid model
run: every reply case must pass, then `facts: … every copy agrees` and
`Dry run. Nothing was written.` Only then the third.

*Check:* send Tara's Page these four messages from your Messenger and compare
the replies:

- «Урьдчилгаа төлбөр үнээс хасагдах уу?» → «Урьдчилгаа төлбөр үйлчилгээний
  үнээс хасагдаж тооцогдоно.»
- «Зээлийн аппаар төлж болох уу?» → «Одоогоор зээлийн аппаар төлбөр
  авдаггүй.»
- «Ямар будаг хэрэглэдэг вэ?» → the 76001888 hand-off line.
- «Оюунаа» → the answer uses Oyunaa.
- «Парк Од салбарын утас?» → Парк Од's address, «Утас: 99076874» and her Page.

**B5 — You: photo and reel question** (SQL editor, no republish needed):

1. `scripts/provision/tara-yarmag-photo-question-2026-10-04.sql`
2. `scripts/provision/tara-yarmag-reel-question-2026-10-04.sql`

*Check:* send a hair photo with no text → the approved photo question comes
back, and the chat stays with Дали. Then answer «Tara perm, урт» → the price.

3. `scripts/provision/tara-yarmag-colour-and-treatment-perm-2026-10-04.sql`
   (approved 2026-10-04; run it after the price list file, which gives
   91005498, or it refuses): women's «Эмчилгээний хими» is not offered;
   «өнгө гаргалт» gets «Манай өнгөний үйлчилгээний үнэ:» with the women's
   colour prices, or the men's when the customer writes «эрэгтэй». The
   price-page replies are gone (neither is a Tara service); the website needs
   no change for them.

---

## C. Дали — Парк Од (dala-ai, tenant `tara-park-od`) — BLOCKED until you are Page admin

All of these run on the operator's machine (`SUPABASE_SECRET_PUBLISH`), after
B2. The full detail is in `docs/tenants/tara-park-od.md`.

**C1 — You: Page access.** Once you are admin: connect the Page to the DalaTech
app and subscribe it to messages. Then seal her Page token by hand:
`node scripts/kek/seal.ts`, as for Яармаг.

**C2 — You: confirm the Page ID.** Read it on the Page, or call
`GET https://graph.facebook.com/v21.0/me?fields=id,name` with her token.

**C3 — You: onboard.** Dry run first, then the same command with `--apply`:

```
node scripts/onboard/tenant.ts --form intake/tara-park-od.docx --slug tara-park-od \
  --wording intake/tara-park-od.wording.json --facebook-page-id <Page ID> \
  --display-name "Tara Salon — Парк Од"
```

Pass `--wording` on **every** run of this command.

**C4 — You:** run `scripts/provision/tara-park-od-after-onboarding.sql` in the
SQL editor, once.

**C5 — You: sign her wording sheet.** Re-run C3 with `--apply`. It prints the
sheet id (18 lines, all approved on 2026-10-04). Then run:

```
… --apply --sign-wording <sheet id> --signed-by Bilguun
```

**C6 — You (Boloroo confirms):**

```
… --apply --client-confirmed "Болор" --confirmed-on <date> --summary <summary id>
```

**C7 — You: check, then publish.**

1. `node scripts/facts/branches.ts --group tara-salon` must be clean.
2. `node scripts/publish/tenant.ts --slug tara-park-od` (dry run).
3. The same with `--with-model`, once.
4. The same with `--publish`.
5. Switch her answer cases on:

   ```sql
   update reply_cases set active = true
   where tenant_id = (select id from tenants where slug = 'tara-park-od')
     and note like 'answers 2026-10-04%';
   ```

*Check:* message her Page with the four checks from B4, but with «Болороо» for
the name check. Also ask «Яармаг салбар хаана байдаг вэ?» → Яармаг's address,
76001888, 91005498 and Яармаг's Page; her own lines give 99076874 only.

**C8 — Check the D-177 replies** (they land on with the C file, approved
2026-10-04): «ungu gargalt hed ve» → «Манай өнгөний үйлчилгээний үнэ:», the
women's colour prices and 99076874, never «not offered»; «eregtei hun ungu
gargalt» → the men's prices; «emegtei emchilgeenii himi hed ve» → not
offered, never 189,000₮.

---

## D. In-chat booking (dala-ai, both tenants) — after B, and after C for Парк Од

The full detail is in `docs/proposals/tara-inchat-booking.md`, «Switching it
on».

**D1 — You: Production variables** (Vercel → `dala-ai` → Environment
Variables → **Production**):

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`: **copy them from
  the `matrix-website` project**, same names.
- `BOOKING_LINK_SECRET`: `openssl rand -base64 36`.
- `SUPABASE_SECRET_BOOKING`: a new secret key (Supabase → Settings → API
  keys).
- Confirm that `QPAY_USERNAME` / `QPAY_PASSWORD` / `QPAY_TERMINAL_ID` are the
  website's Quick QR login (terminal `DALATECH_AI`).
- `BOOKING_MODE=test`.

Then redeploy. Preflight refuses the deploy if any of these is missing.

**D2 — You: QStash.** Add one schedule: every minute, POST
`https://api.dalatech.online/api/workers/booking`, with an empty body.

**D3 — You: the rows.** Build one `booking_config` row per branch, run each
file in the SQL editor, then put the branch in test mode.

1. Яармаг. Build the file:

   ```
   node scripts/booking/from-website.ts --website <matrix_website checkout> \
     --rules config/booking/tara-salon.json --slug matrix-eco-salon \
     --tester <your PSID> --out yaarmag.sql
   ```

   Run `yaarmag.sql`, then:

   ```sql
   update booking_config set mode = 'test'
   where tenant_id = (select id from tenants where slug = 'matrix-eco-salon');
   ```

2. Парк Од, after C. Build the file with her variables in your shell (the same
   values as the website's):

   ```
   PARKOD_QPAY_BANK_CODE=… PARKOD_QPAY_ACCOUNT_NUMBER=… PARKOD_QPAY_ACCOUNT_NAME=… \
   PARKOD_CALENDAR_BOLOROO=… PARKOD_CALENDAR_SARAA=… PARKOD_CALENDAR_TOMOO=… \
   PARKOD_CALENDAR_BULGAA=… PARKOD_CALENDAR_ENHUUSH=… PARKOD_CALENDAR_CHIMEGEE=… \
   PARKOD_CALENDAR_TUCHKU=… \
   node scripts/booking/from-website.ts --website <checkout> \
     --rules config/booking/tara-salon.json --slug tara-park-od \
     --tester <your PSID> --out parkod.sql
   ```

   The summary must say «connected». Run `parkod.sql`, then:

   ```sql
   update booking_config set mode = 'test'
   where tenant_id = (select id from tenants where slug = 'tara-park-od');
   ```

3. Check both: `node scripts/booking/check.ts --group tara-salon` must print
   «the branches book alike».

**D4 — You: one 100₮ chat test per branch.**

1. From your Messenger, write «Цаг авъя» to the Page.
2. Book at least a day ahead and pay 100₮.
3. Check all four:
   - the confirmation, marked ТЕСТ;
   - one «ТЕСТ – …» event in that hairdresser's calendar;
   - one row in `booking_payments`;
   - the 100₮ in that branch's bank account.
4. Try «Цуцлах» once, and once let the 5 minutes pass. Each time the time must
   come free on the website too.

*Claude* removes the test bookings.

**D5 — You: live.**

```sql
update booking_config set mode = 'live'
where tenant_id = (select id from tenants where slug in ('matrix-eco-salon','tara-park-od'));
```

Then set `BOOKING_MODE=live` in Vercel and redeploy. To stop it, set a
branch's `mode = 'off'`. That takes effect on the next message, with no
deploy.

---

## E. The domain tarasalon.org (any day after A; full list in `docs/DOMAIN_MOVE.md`)

**E1 — You: Vercel.** Vercel → `matrix-website` → Domains: add
`tarasalon.org` and `www.tarasalon.org`, and make tarasalon.org primary.

**E2 — You: Namecheap DNS.** Enter exactly the records Vercel's Domains screen
shows. Usually that is:

- an `A` record for `@` → `76.76.21.21`;
- a `CNAME` for `www` → `cname.vercel-dns.com`.

Wait until Vercel shows «Valid Configuration».

**E3 — You:** keep matrixecosalon.org attached. Redirect its **pages** to
tarasalon.org, but **not `/api/*`**, for at least 30 days, so paid callbacks
on old invoices still reach the site.

**E4 — You:** set `BASE_URL=https://tarasalon.org` (Production), then
redeploy.

**E5 — Claude** prepares one SQL file per tenant that changes Дали's booking
link, booking line, the `booking` reply, the products FAQ, the website contact
to tarasalon.org. **You** run them and publish both
tenants (as B4 and C7).

**E6 — You:** update the QPay merchant's website field, Google Business
Profile, Search Console («Change of address»), and the Facebook and Instagram
website fields. Then re-scrape the home page in Facebook's Sharing Debugger.

**E7 — You: one more 100₮ test** on `https://tarasalon.org/?test=<token>` (the
test cookie belongs to one domain). *Check (Claude):* the Vercel logs show
`late-payment: outcome`, and the booking is in the calendar.

---

## The 100₮ test (website)

**Before the first test on Preview (You, once):**

1. Add `BOOKING_TEST_TOKEN` to **Preview**: 16+ random characters, e.g.
   `openssl rand -hex 16`. Today's preview reports `testLinkReady: false`.
2. Redeploy the preview, or ask Claude to push.

**The test:**

1. **Open the test link**, logged in to Vercel in the same browser:
   - Preview: `https://matrix-website-git-claude-coo-92597c-bilguuns-projects-a8563d8e.vercel.app/?test=<BOOKING_TEST_TOKEN>`
   - Production: `https://www.matrixecosalon.org/?test=<token>`

   The browser now carries the test cookie: the deposit is 100₮, and the
   booking is titled «ТЕСТ». Three things break it:
   - **A different address.** The cookie belongs to the address you opened.
     Book on that same address: a link from Vercel's deployment list
     (`matrix-website-<hash>-….vercel.app`) is a different address from the
     branch link above, and `matrixecosalon.org` is different from
     `www.matrixecosalon.org`.
   - **A token that doesn't match.** Copy it from Vercel exactly; a token made
     with `openssl rand -hex 16` has no characters that links change. If the
     token is wrong, the booking page now says so in a red line at the top
     («ТЕСТ холбоос буруу байна…») instead of quietly asking the full price.
   - **A token changed without a redeploy.** Variables take effect only after
     a redeploy.
2. **Book:**
   On the booking page (`/booking.html`):
   - Парк Од: Парк Од → service «Үйлчилгээ — Үс оношлогоо
     зөвлөгөө» → Эмэгтэй → **Saraa**.
   - Яармаг: Яармаг → the same service → Эмэгтэй → **Uyanga**.
3. **Pick a time:** the last day in the date row (it shows the next 7 days),
   at **19:00** (the last slot), so no real customer is turned away while the
   test sits there. Enter
   your name and phone, tick the deposit terms, and the QR shows **100₮**.
4. **Pay from your bank app.** The page confirms within seconds. On Preview,
   QPay's callback can't reach the preview (Vercel login), so keep the page
   open until it confirms. Production has no such limit.
5. **Check:**
   - one «ТЕСТ – <phone> - …» event at 19:00 in Saraa's (or Uyanga's) calendar;
   - before paying, your bank app names the payee «БОЛОРТУЯА ГОНГОР» with her
     IBAN (Яармаг: «ОЮУНСҮРЭН ЭРХЭМБААТАР» with hers);
   - Boloroo sees +100₮ in her Khan Bank account (Яармаг: Яармаг's account),
     with your name and phone as the description.
6. **Clean up:** tell Claude the stylist and the date. Claude opens
   `/api/setup/cleanup-test?stylist=Saraa&date=<YYYY-MM-DD>` on the preview,
   which works for Production tests too because the calendars are the same.
   It removes only the test link's booking and lists what it removed. You can
   also delete the event by hand in the calendar.

A fresh Яармаг test is worth it once, because this release changed the payment
path (the hold, the level and gender rules, the bank account per branch). Its
invoice body is unchanged except the payee name, now «ОЮУНСҮРЭН ЭРХЭМБААТАР».

---

## Your Mac (for B4 and, later, C3–C7)

One time (full detail: dala-ai `docs/publish-mac.md`):

1. **Node 22.18 or newer**: `node --version`; if older, `brew install node@22`.
2. **The checkout**: `mkdir -p ~/dalatech && cd ~/dalatech && git clone
   https://github.com/dalatechai-cyber/dala-ai.git && cd dala-ai && npm ci`.
   Git must be signed in to GitHub (the repository is private): `gh auth
   login`, or the GitHub Desktop/Keychain credentials you already use.
3. **The Supabase key** (the secret): Supabase dashboard → project
   `tlggenaatnopnxzbkbuf` → Project Settings → API Keys → Secret keys → «Add
   new secret key», name it `publish-mac`, copy it once, then store it (paste
   the value at the prompt, never on the command line):
   `security add-generic-password -a "$USER" -s dala-supabase-publish-mac -w`
4. **The Anthropic key** (only for `--with-model`, which spends): Anthropic
   console → API keys → create `publish-mac`, then
   `security add-generic-password -a "$USER" -s dala-anthropic-publish-mac -w`

No Supabase CLI is needed, and `supabase db push` must never be run here (B2).

**Is my Mac ready?** One command; it ends with `MAC READY` or stops at the
first thing missing. It reads only (the publish dry run writes nothing and
spends nothing). The first time, macOS asks whether `security` may read each
key: «Always Allow».

```
cd ~/dalatech/dala-ai && node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<18)){console.error("Node "+process.version+" is too old: need 22.18+");process.exit(1)}console.log("node ok",process.version)' && git fetch -q origin && echo "github ok" && security find-generic-password -s dala-supabase-publish-mac -w >/dev/null && echo "supabase key ok" && security find-generic-password -s dala-anthropic-publish-mac -w >/dev/null && echo "anthropic key ok" && NEXT_PUBLIC_SUPABASE_URL=https://tlggenaatnopnxzbkbuf.supabase.co SUPABASE_SECRET_PUBLISH="$(security find-generic-password -s dala-supabase-publish-mac -w)" node scripts/publish/tenant.ts --slug matrix-eco-salon >/tmp/dala-dryrun.txt 2>&1 && tail -3 /tmp/dala-dryrun.txt && echo MAC READY
```

If the last step fails, send `/tmp/dala-dryrun.txt` to Claude.

---

## Парк Од's online booking switch (2026-10-04)

Парк Од's website booking is **off** (founder, 2026-10-04) until her
hairdressers' Gmail calendars are ready: the booking page and her branch card
show «Онлайн захиалга удахгүй нээгдэнэ.» with 99076874, her only number
(tappable; founder 2026-10-04); her team section offers the same number; her team,
branch details and prices stay. Her calendars, QPay account and alert chat
stay configured. **To open it:** Vercel → matrix-website → Settings →
Environment Variables → Production → add `PARKOD_BOOKING` = `on` → Redeploy.
*Check:* `/api/branches` shows Парк Од `ready: true`, and the booking page
offers her hairdressers.
