# Launch Part 1 — the website (both branches) + Яармаг's Дали

Short list from `docs/LAUNCH_DAY_TARA.md` (full steps and fallbacks there).
Парк Од's Дали (C) and in-chat booking (D) wait for her Page access.

| # | Who | Step | Check after |
|---|---|---|---|
| 0 | You | Set up your Mac once and run the readiness command («Your Mac», end of LAUNCH_DAY_TARA.md) | It ends with `MAC READY` |
| 1 | Claude | A1 + B1 (done 2026-10-04; re-run if any PR changes) | Tests green; preview: both branches ready, 14 calendars; scratch DB: 0082→0084, all suites, all SQL files and reverts |
| 2 | You | A2: Production variables in Vercel (Парк Од bank ×3, `PARKOD_TELEGRAM_CHAT_ID`, 7 calendars, `CRON_SECRET`, `BOOKING_TEST_TOKEN`); check `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `QPAY_MERCHANT_ID` | Nothing changes on the live site yet |
| 3 | You | A3: merge #84 → `main`; #83 → its base; #82 → `main` | Claude, within 10 min: Production READY, `/api/health` ok, both branches ready (7 + 7), times offered, `/api/setup/check` 404, pages render |
| 4 | You | A4: one 100₮ test link payment at Парк Од (Saraa) and one at Яармаг (Uyanga) | Bank app shows the right payee; +100₮ in each account; «ТЕСТ – …» in the right calendar |
| 5 | Claude | Remove the two test bookings | Calendars clean |
| 6 | You | A5: one unpaid QR | The «⏳ Түр хадгалсан» event is gone within 6 minutes; the time is offered again |
| 7 | You | B2.1–2: merge #286; merge #283 → `main` | — |
| 8 | Claude | Merge `main` into #285 and #284, push (doc-only conflicts) | Their CI green |
| 9 | You | B2.3–4: merge #285, then #284 → `main` | Vercel deploy of `main` READY |
| 10 | Claude | B2.5: apply 0082, 0083, 0084 (on your «go»), never `supabase db push` | Ledger lists the three; `npm run check` on `main` green |
| 11 | You | «Go: merge dala-ai #287» (D-178, Claude merges); then `git pull`; then B3: SQL editor → stylist names, then answers, then branch phones | #287 merged; each file ends with `COMMIT` |
| 12 | You | B4: dry run → `--with-model` → `--publish` (Mac) | Every case passes, `facts: … agrees`; then Messenger: 5 test messages (the fifth: «Парк Од салбарын утас?» → 99076874) |
| 13 | You | B5: SQL editor → photo question, reel question, colour/treatment-perm | Photo with no text → the photo question; «ungu gargalt hed ve» → «Манай өнгөний үйлчилгээний үнэ:» + women's prices + 76001888 / 91005498 |
| 14 | You | Next morning: Vercel Logs → `sweep-holds` | One line, status 200 |
