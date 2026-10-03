# NOTES — Tara two-branch round (started 2026-10-03)

Resume point after a context reset. Keep current. Founder is away; never wait for him.
Final report: under 25 lines, plain English (see the brief's last paragraph).

## Ground rules of this round

- NOTHING goes live: no merges, no publishes, no SQL on production, no Production env changes.
  Drafts, branches, previews only. Never invent prices, levels, names or rules. Never print
  or log secret values.
- matrix_website: my branch `claude/cool-albattani-9om8zg` (the session's designated branch).
- dala-ai: cloned at `/home/user/dala-ai`; work goes to its own `claude/*` branches + draft PRs.

## Decisions (with reasons)

1. **Website base = PR #82's head, not its base.** PR #82 is `claude/tara-salon-rebrand-44dg5w`
   (metallic «Plaster & Steel» design) → base `claude/beautiful-cori-8aoiuy`. The founder's
   "approved metallic-and-beige design" lives on the head. The Парк Од photos commit (233169d)
   is on `beautiful-cori`, so my branch = rebrand head + merge of beautiful-cori. My draft PR
   targets `claude/tara-salon-rebrand-44dg5w` so it stacks on PR #82 and nothing reaches main.
2. **Photos landed at the repo root**, not in `photos-incoming/park-od/` (commit 233169d put
   them at `/Boloroo.jpg` etc.). I optimise them into the site's image folder and delete the
   root originals from my branch (they stay in git history at 233169d).
3. **No `.claude/skills` design skills exist** in either repo or the session's skill folders.
   Design authority used instead: DESIGN.md, PRODUCT.md, `.impeccable/design.json` (CLAUDE.md
   names the impeccable skill as design authority; its sidecar is all that is in the repo).

## Facts from the salon (Oct 3 2026) — copied from the brief, the single list I work from

- Same prices/services both branches. 62-service duration sheet confirmed exactly as estimated.
- Short Latin names: Яармаг: Oyunaa (SPECIAL, owner, was Oyunsuren), Badamaa (was
  Badamtsetseg), Uyanga, Zaya (was Batzaya), Chimgee (was Uranchimeg), Anand (only man).
  Парк Од: Boloroo (SPECIAL, owner), Saraa, Tomoo, Bulgaa, Enhuush, Chimegee, Tuchku (only man);
  all except Boloroo are Мастер.
- Deposits: SPECIAL 20,000₮, Мастер 20,000₮, 1-р зэрэг 10,000₮ (Яармаг only).
- Children: girls with a female stylist, boys with the branch's male stylist; same deposit.
- Titles (website): «SPECIAL Hair Stylist», «Master Hair Stylist»; propose 1-р зэрэг's.
  Дали Mongolian: «үсчин», never «стилист».
- Парк Од hours Mon–Sat 10–20, Sun 11–19. Address Баянзүрх дүүрэг, 26-р хороо, Парк-Од молл,
  4 давхар, 405 тоот. Page profile.php?id=100067391025472. E-mail: the founder has it (kept out of the repo).
- Phones: 76001888 shared; Яармаг also 91005498.
- Парк Од booking account tarasalon.parkod@gmail.com (being created) + one Gmail per stylist
  sharing her calendar («make changes to events»), like booking@matrixecosalon.org for Яармаг.
- Oyunaa checks Яармаг's hand-off chats.

## Status

- [x] T1 QPay/booking investigation + two-branch design + code (docs/TWO_BRANCHES.md)
- [x] T2 env var list (docs/TWO_BRANCHES.md). Nothing set on Preview: no variable has a known
      value yet (merchant id, bank, chat id, calendar ids all still to be created), and the
      Vercel connection cannot even list env vars (403).
- [x] T3 dala-ai draft PR https://github.com/dalatechai-cyber/dala-ai/pull/283 (CI green). 315 texts/134
      chats; ~188/257 replies good, 68 weak (26 already fixed by applied files, 42 possible today).
      Fixed in code: dye price ask got only the clarifying question (×12) → price rows added;
      approved line copied with one word changed → hand-off line instead of the row (×4) → certain
      share 0.9. Biggest: photo/reel + "how much?" → hand-off then silence (34 chats, 26 never got a
      staff reply) — founder decision (recommend: turn on Tara's media alert now). Drafts:
      prompt/drafts/tara_quality_2026-10-03.mn.txt (deposit taken off price? loan apps? dye brand?).
      Report: docs/reports/2026-10-03-tara-dali-quality.md.
- [x] T4 names/titles: website (#83), Дали data both branches (#284), booking (#285).
- [x] T5 website: draft PR https://github.com/dalatechai-cyber/matrix_website/pull/83 (base = PR #82
      head). Two review rounds done, all findings fixed (blocker: hold id prefix «wh» invalid in
      Google → now «sh»; tie-break by holdPlacedAt; chat holds = dalaBookingState 'hold'; no
      release of a customer's earlier hold; rate limit 20 placed/10 min). 214 tests. Preview
      checked: /api/branches, real availability identical to production.
- [x] T6 dala-ai draft PR https://github.com/dalatechai-cyber/dala-ai/pull/285 (base #280's branch, CI
      green). 62 services/minutes, names, Парк Од not-connected, per-tenant merchant + payout rows,
      invoice records its login, sh/dh contract. e2e 251 locally (11 run the website's code).
      Drafts: booking_ask_agreement (Нөхцөл line removed), booking_ask_variant, button labels.
      Note: chat serves a level-priced line only at that level; website does not (founder to align).
- [x] T7 + T4 (Дали data): dala-ai draft PR https://github.com/dalatechai-cyber/dala-ai/pull/284 (CI green).
      Яармаг names SQL (not applied; also switches off Отгонжаргал and the still-active manicurist
      row), Парк Од intake form + after-onboarding SQL, local dry run only; branch gate clean both
      tenants. Drafts: prompt/drafts/tara_stylist_names.mn.txt, tara_park_od_wording.mn.txt.
      Open Qs: her hand-off reader, Cyrillic spellings of her stylists, away message, whether her
      Дали names Яармаг, 1-р зэрэг/SPECIAL men's prices she can't serve, nail refusal line, Page id.
- [x] Final report sent 2026-10-03.

## Open items for the founder (collect here)

- Level-named haircut services («Тайралт том хүн /SPECIAL/», «/МАСТЕР/», «/1-р зэрэг/») can be
  booked with a hairdresser of any level; no rule given, not enforced. Founder to decide.
- Chimgee (Уранчимэг) has no photo: team shows her initial.
- 1-р зэрэг English title proposal «Senior Hair Stylist».
- QPay written confirmation (questions in docs/TWO_BRANCHES.md); Парк Од owner's registration details.

### Decisions, continued

4. **Vercel env names cannot be listed**: the Vercel connection gets 403 on project env vars
   (both matrix-website and dala-ai). Names below come from the code. Setting Preview values
   may also be refused; try once, record the result.
   Projects: matrix-website `prj_SK9wL1sPFur7VCqvSiBaT0Elyw0q` (express; prod = main,
   www.matrixecosalon.org), dala-ai `prj_YZBmNuSmMqmVQU2OFOZvJzNtHi0J`; team
   `team_k62QPqdO25dZmbnr512kukZa`. Preview SSO on.
5. **QPay official docs unreachable** (proxy blocks *.qpay.mn). Research from unofficial SDKs:
   `scratchpad/qpay-research.md`. Design: Парк Од shares the Quick QR partner login
   (QPAY_USERNAME/PASSWORD, terminal DALATECH_AI) unless her own login is set (3 vars, all or
   none); REQUIRED own merchant id + own bank account sent as `bank_accounts` on every invoice;
   refuse if equal to Яармаг's. Yaarmag path unchanged. Ask QPay to confirm in writing.
6. **Website hold**: `wh`+sha256(calendarId|startISO|phone) opaque event, private
   {taraHold:'1', holdExpiresAt}, 5 min after each QR. Re-check after insert; yield unless the
   other overlap is a later-created hold. Booking deletes the hold. Expired holds deleted
   lazily (availability, create-payment) and by a sweep. Told the booking worker.
7. Отгонжаргал not in the founder's list: removed from website booking/team; flagged.

## Workers (background subagents)

- dala-ai `/home/user/dala-wt/quality` branch `claude/tara-dali-quality-oct3` — T3.
- dala-ai `/home/user/dala-wt/parkod` branch `claude/tara-park-od-tenant` — T4 (Дали data) + T7.
- dala-ai `/home/user/dala-wt/booking` branch `claude/tara-inchat-booking-two-branch` (base
  PR #280's head `claude/happy-pasteur-4gp7gd`) — T6.
- Shared facts file: scratchpad `round-facts.md` (copy kept in this NOTES "Facts" section).

# Round 2 — 2026-10-04 (founder asleep; answers, decisions and approvals)

Full list: scratchpad `round2-facts.md` (copied below in short). Workers: #283 quality, #284
names + Парк Од, #285 booking (same worktrees as round 1). I do the website (#83), the
guardrail PRs (both repos) and the approvals folder.

## Decisions of round 2 (with reasons)

R2-1. Otgonjargal back: website data says 1-р зэргийн үсчин, female, Яармаг, own calendar →
      hair stylist, bookable, 10,000₮. Display «Otgonjargal» (Latin form of her full name:
      founder said full name + names Latin everywhere). Old ids stay aliases.
R2-2. «Бүтээл» gallery removed (page, home section, nav). zurag.html → 301 to /. Hero, «Бидний
      тухай» and «Уралдаан ба сургалт» photos come from the same Facebook export: kept (not part
      of the instruction), listed for the founder.
R2-3. Guardrails PRs on their own branches from main (`claude/guardrails-hooks`), because the
      founder asked for one PR per repo; #83's branch is not used for them.
R2-4. Level-named haircuts: the service decides the level; a stylist of another level is
      neither offered nor invoiced (server refuses).

## Round 2 status

- Website #83: gallery removed, Otgonjargal back, «Hair Stylist», level-named haircuts by level
  (page + both payment paths), deposit-deducted line, docs (tarasalon.org, merchant steps,
  copy draft). 216 tests; browser 390/1440 verified locally. Pushed 63a33c0.
- Guardrails: matrix_website PR #84 (178 tests), dala-ai PR #286 (npm run check green: 2634,
  1 skip). The hook builds the blocked number from parts and matches any spelling; dala-ai's
  banned-number guard passes on it.
- Workers stopped at an API session limit (~09:20–11:50 UTC); resumed 15:45 UTC.
- R2-5. Hero/«Бидний тухай»/«Уралдаан ба сургалт» photos are from the same Facebook export as
  the removed gallery: kept, flagged for the founder.

### Round 2 — review fixes (2026-10-04)

- R2-6 Men's «Тайралт том хүн /SPECIAL/» is on the salon's list but no male
  hairdresser is SPECIAL at either branch, so online booking hides it (price
  page unchanged). A level cut is offered only if the branch has a hairdresser
  of that level who serves that section's customers. Two new step-3 notices
  (level missing, two levels together) are listed for approval in COPY_DRAFT.
- R2-7 Level check now maps each service to its catalogue entry by the same
  loose key as durations («(SPECIAL)», double spaces), reads serviceName as well
  as selectedServices, and /api/calendar/book refuses an explicit level
  mismatch like a gender mismatch.
- R2-8 Boloroo's personal e-mail removed from the template, TWO_BRANCHES and
  NOTES (it remains in git history since ca925df; the repo did not show up in a
  public search, so it is likely private). The founder fills it in outside the repo.
- R2-9 docs/PHOTOS.md lists only the 8 photos still shown; IMAGERY drops
  intro-zurag. Those 8 are from the same Matrix-era export — founder decides.

### Round 2 — final status (2026-10-04)

- dala-ai#283 (a5bf883), #284 (approvals folder c76c13a), #285 (59a76e5), #286 (2681997) and
  matrix_website #83 (this branch), #84 (01d0e3e): drafts, nothing merged, applied or published.
- Everything the founder still has to approve is in dala-ai `docs/approvals/tara-2026-10-04/`
  (branch claude/tara-park-od-tenant), with an index.
- R2-10 Парк Од hand-off alerts reach only the founder's Telegram; nothing tells Boloroo yet
  (needs her chat). Listed as missing, not built.

### Round 3 — founder's corrections (2026-10-04)

- R3-1 QPay: Парк Од uses the same login and merchant as Яармаг (as Core Language
  and Matrix); only `bank_accounts` differs, from PARKOD_QPAY_BANK_CODE /
  _ACCOUNT_NUMBER / _ACCOUNT_NAME (Яармаг's invoice sends the holder's name too, so
  it is required). Removed: PARKOD_QPAY_MERCHANT_ID, her optional own login, the
  merchant-registration script, template and workflow, the Boloroo details list.
  A test compares the two branches' invoice bodies field by field.
- R3-2 Men's SPECIAL cut not bookable online: approved as built.
- R3-3 «Гоёлын засалт /эрэгтэй/» (33,000₮, on the current list, women's section):
  the booking shows it under «Эрэгтэй засалт»; male customers get Anand / Tuchku.
  Price page unchanged (the salon's list as printed).
- R3-4 Photos: all eight still shown were checked at full size; none shows the
  Matrix name or logo, so all are kept and none removed (docs/PHOTOS.md).
- R3-5 Alerts: Парк Од's payment alerts go to PARKOD_TELEGRAM_CHAT_ID — for now the
  founder's own chat; Boloroo checks Messenger herself. Nothing built for owner
  alerts. R2-10 is closed.

## 2026-10-04 — round 4: test link, payee names, 7-day date row

- R4-1 Test link: a token that did not match failed silently (the page asked
  the full price). Now the match tolerates a «+» read as a space and stray
  spaces, and a rejected link leaves a short-lived marker so the booking page
  says «ТЕСТ холбоос буруу байна…». The cookie belongs to the address opened:
  book on the same address.
- R4-4 The founder's live 100₮ tests use a temporary branch (deleted after) that
  sets 100₮ for Saraa and Uyanga only. #83 itself refuses any deposit below
  10,000₮ in its tests (`tests/branches.test.js`), so a 100₮ price can never be
  merged by accident.
- R4-2 Payee names, as the bank app shows them: Яармаг «ОЮУНСҮРЭН ЭРХЭМБААТАР»
  (code; account number unchanged); Парк Од from PARKOD_QPAY_ACCOUNT_NAME
  («БОЛОРТУЯА ГОНГОР»). PARKOD_QPAY_ACCOUNT_NUMBER accepts her full IBAN
  (MN + 18 digits, mod-97 checked, spaces dropped) or a plain number; Яармаг's
  account is refused in either form. Яармаг's invoice still sends her plain
  number; whether QPay accepts an IBAN there is shown by the first 100₮ test.
- R4-3 Booking date row: the next 7 days only, in one row with no sideways
  scrolling (phone and desktop); today reads «Өнөө» on phones.
