# Status — Matrix Eco Salon website

Last updated: 2026-09-04. Written so a future session (or a future you) can pick
this up without re-deriving anything.

---

## Live in production

**Duration-aware booking.** Merged as `082a795` (PR #73), production deployment
`dpl_73N5WVN1bD19AGNnN5x2MMCrMkyf`, state READY.

Booking used to assume every appointment took one hour. A customer could pick a
4-hour service (Оффис колор) and be offered an **18:00 start on a day the salon
closes at 20:00** — a slot nobody could honour, with a QPay deposit already
taken. It was three defects wearing one symptom:

| Defect | Effect |
| --- | --- |
| `available-slots` took only `date` + `stylistId`; length came from a per-**stylist** figure | Every hairdresser's appointment was an hour regardless of what was booked |
| The overlap test compared `slotStart … +60min` against busy periods | A 4-hour booking at 14:00 never collided with an existing 17:00 one — silent double-booking |
| `POST /book` honoured `totalDuration` only for the manicurist | A 4-hour colour was written to Google Calendar as a **1-hour event** |

The third is the one that mattered most: the calendar event *is* the busy record
every later availability check reads back, so fixing only the visible symptom
would have left double-booking in place.

Now: `data/serviceDurations.json` is the single source of truth, read by the
server through `config/serviceDurations.js` and fetched by the browser — one
file, no client copy to drift. The customer's ticked services go to
`available-slots`, which stops offering starts once the appointment would run
past closing and widens the conflict window to the whole appointment. `/book`
writes the event at that same length, for every stylist.

Two smaller things fixed alongside:

- `script.js` computed `totalDuration` as `MANICURE_DURATIONS[service] || 30`, so
  every **hair** service contributed 30 minutes. Hair durations did not exist.
- **Оффис колор was not in the booking checkbox list at all** — it is on the
  price list (`data/pricing.json`) but was missing from `HAIR_SERVICES`, so the
  salon's longest colour service could not be booked online.

Design decisions worth knowing before changing this:

- **The browser's `totalDuration` is ignored.** That number decides how much of a
  stylist's day gets blocked; trusting it would let anyone reserve a whole day,
  or shorten a booking and re-open a slot the salon cannot honour. It is still
  accepted in the request body for compatibility but has no effect.
- **An unknown service name costs the default (60 min), never zero.**
  Under-booking is what promises a slot the salon cannot keep, so the safe
  failure is reserving too much. Unknown names are logged.
- **The slot grid did not change** — hairdressers on the hour, manicurist every
  30 minutes. Only the *last* start moved.

`npm test` → **128 passing**.

---

## Stubbed / provisional — needs a human

### The duration figures themselves

Only two came from the salon: **Оффис колор ≈ 4h** and **хими ≈ 2h**. Manicure
figures were already in the codebase and are unchanged. **Everything else is an
engineering estimate.**

```bash
grep '"confirm": true' data/serviceDurations.json
```

This is commercially load-bearing in both directions: too long and the salon
loses bookable slots; too short and the original bug comes back milder. Someone
at the salon should walk the list. Editing the JSON is the entire change — no
code, no redeploy logic, and the booking UI picks it up on next load.

### Dye is two services, and it took two passes to see it

`Тариф.xlsx` has `будаг/уг  135000` and `будаг  176000-200000` as two columns.
Read as one scale — three lengths, cheapest 135,000₮ — the roots price vanishes,
which is exactly the mistake this repo made first. The salon's model is **two
axes**:

| Service | Price |
| --- | --- |
| **Үндэс** (roots only; «Үг» and «Үндэс» are the same word) | 135,000₮ |
| **Будаг** (full dye), by hair length | хүзүүний урт 135,000₮ · далны дээгүүр 176,000₮ · далнаас доош 200,000₮ |

The shortest length tier costs the same 135,000₮ as roots. That coincidence is
what makes the two collapsible, so `tests/content.test.js` asserts both exist
separately. The booking checkboxes now use the same two names, with
`Будаг (Уг)` / `Будаг (Бүтэн)` kept as aliases at their old 90 and 120 minutes.

### The price list lives in two repositories

`data/pricing.json` is not the only copy of the salon's prices. The Messenger and
website chatbot — **[dalatechai-cyber/matrix-chatbot](https://github.com/dalatechai-cyber/matrix-chatbot)**,
live at `matrix-chatbot-seven.vercel.app` — keeps its own list in
`config/currentClient.js`, and that list is what the bot quotes to a customer.
When the salon corrected three services in September 2026, both copies were
wrong in the same way, because both were built from the same reading of
`Тариф.xlsx`.

Worse, the bot's `lib/systemPromptBuilder.js` had a standing rule *instructing* it
to reproduce one of the errors (that «CICA» and «Сор» each name two services), and
its contact block and three pinned handoff replies carried the retired phone
number — the number a customer is given at the moment the bot gives up.

**So a price or a service name changed here is only half the change.** The other
half is that repo. The same is true of the salon's phone number, its address and
its opening hours. There is no shared source between them; keeping them in step
is a human step, every time.

### The gallery photos are someone else's marketing

The retired booking number **7741-7777 was live on `zurag.html` as pixels**, not
text — burned into a contact banner across the bottom of `Pictures_Page/Male/pic9.jpg`
and `Pictures_Page/Female/pic7.jpg`, twice in each (a reception line
`77417777→1→5→5` and a stylist extension). No grep over the repo could see it.
Both banners were cropped off; the photos above them are untouched, re-encoded
with their own quantization tables so nothing else changed.

The banners say more than a phone number. They advertise **ЖЕМ ПАЛАС** (Gem
Palace) and **WWW.MATRIXSALON.MN** — a different branch and a different domain
from this salon's own Yaarmag address and `matrixecosalon.org`. Three more
gallery images (`Female/pic3`, `pic4`, `pic5`) carry the same banner's header
strip, cropped so the digits fall below the frame; they hold no contact details
and were left alone. Four posters in `files/` (`Budag.jpeg`, `OfficeOroolt.jpeg`,
`HollywoodOroolt.jpeg`, `EleganceOroolt.jpeg`) carry a **seven-branch location
list** and third-party financing logos, and `files/OfficeColor.png` carries a
**15% OFF campaign that expired 2023-02-20** — which is why `SERVICE_IMAGE_MAP`
no longer points «Будаг» or «Оффис колор» at them.

**For a human:** these assets came from the larger Matrix chain's marketing, so
any re-export can bring the wrong number, branch or domain back with it. Before
adding a picture to the gallery or to `SERVICE_IMAGE_MAP`, look at the bottom
10% of the frame. Photographs of this salon's own work, without a burned-in
banner, would retire the problem for good.

### Live-site verification was never done

The session that wrote this could not reach the deployed site: the environment's
egress policy blocks `*.vercel.app` **and** `matrixecosalon.org` (403 at the
gateway), and preview deployments sit behind Vercel SSO.

**There is a way through, found later:** the Vercel MCP tool
`mcp__Vercel__web_fetch_vercel_url` fetches production URLs fine — that is how
the burned-in number above was confirmed live, and how `robots.txt`,
`sitemap.xml` and `manifest.json` were confirmed to 404. It does **not** get past
SSO on a preview deployment's HTML, so a branch still has to merge before the
rendered page can be read.

What was done instead: the real Express app run over real HTTP with only the
Google Calendar client stubbed — same routing, same Cyrillic query decoding,
same JSON — with an existing 15:00–16:00 booking on Monday 2026-09-07:

```
no services       (60 min): 10:00 11:00 12:00 13:00 14:00 16:00 17:00 18:00 19:00
Энгийн засалт     (60 min): 10:00 11:00 12:00 13:00 14:00 16:00 17:00 18:00 19:00
Оффис колор      (240 min): 10:00 11:00 16:00
Эмчилгээний хими (120 min): 10:00 11:00 12:00 13:00 16:00 17:00 18:00

Booking Оффис колор at 11:00 wrote: 11:00 -> 15:00 (240 min)
```

**The one-minute check still owed on production:** open booking, pick any
hairdresser, tick **Оффис колор**, confirm the times stop at **16:00** Mon–Sat
(15:00 on Sunday) with a "≈ 4 цаг" hint above them. Tick a single ordinary cut
instead and 19:00 should return.

---

## Known dead code

`routes/qpay.js` → `createCalendarEventForInvoice()` also builds a calendar
event, and now derives its length from the services stored on the invoice. It
appears to be **dead in production**: `vercel.json` rewrites
`/api/qpay/create-payment` to the standalone `api/qpay/create-payment.js`, which
never populates the in-memory `paymentStatuses` map this function reads, so it
returns early every time. The live booking is created by the browser calling
`POST /api/calendar/book` after payment succeeds.

It was fixed rather than deleted because the repo's convention (see CLAUDE.md) is
that both payment paths stay consistent. Worth an explicit decision: delete it,
or wire it up. Maintaining two paths where one is unreachable is the worst of the
three options.

---

## Assumptions that will eventually bite

- **Duration is chair time for one customer, assumed back to back.** If the salon
  ever runs a colour's processing time in parallel with another customer, this
  model over-books the stylist's day and needs rethinking.
- `normalizeServiceName()` exists in **both** `config/serviceDurations.js` and
  `script.js` and the two must agree, or a service resolves to a different
  duration on each side. There is no test that pins them together.

---

## Quick reference

| | |
| --- | --- |
| Tests | `npm test` (128) |
| Durations | `data/serviceDurations.json` |
| Server accessor | `config/serviceDurations.js` |
| Full rationale | [docs/SERVICE_DURATIONS.md](SERVICE_DURATIONS.md) |
| Closures/holidays | [CLAUDE.md](../CLAUDE.md), `config/closures.js` |
