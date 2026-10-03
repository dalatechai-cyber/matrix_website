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
  4 давхар, 405 тоот. Page profile.php?id=100067391025472. E-mail bolotuyagongor@gmail.com.
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
- [ ] T4 names/titles everywhere
- [x] T5 website: draft PR https://github.com/dalatechai-cyber/matrix_website/pull/83 (base = PR #82
      head). Two review rounds done, all findings fixed (blocker: hold id prefix «wh» invalid in
      Google → now «sh»; tie-break by holdPlacedAt; chat holds = dalaBookingState 'hold'; no
      release of a customer's earlier hold; rate limit 20 placed/10 min). 214 tests. Preview
      checked: /api/branches, real availability identical to production.
- [ ] T6 dala-ai #280 update
- [x] T7 + T4 (Дали data): dala-ai draft PR https://github.com/dalatechai-cyber/dala-ai/pull/284 (CI green).
      Яармаг names SQL (not applied; also switches off Отгонжаргал and the still-active manicurist
      row), Парк Од intake form + after-onboarding SQL, local dry run only; branch gate clean both
      tenants. Drafts: prompt/drafts/tara_stylist_names.mn.txt, tara_park_od_wording.mn.txt.
      Open Qs: her hand-off reader, Cyrillic spellings of her stylists, away message, whether her
      Дали names Яармаг, 1-р зэрэг/SPECIAL men's prices she can't serve, nail refusal line, Page id.
- [ ] Final report

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
