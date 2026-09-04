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

`npm test` → **119 passing**.

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

### Live-site verification was never done

The session that wrote this could not reach the deployed site: the environment's
egress policy blocks `*.vercel.app` **and** `matrixecosalon.org` (403 at the
gateway), and preview deployments sit behind Vercel SSO.

What was done instead: the real Express app run over real HTTP with only the
Google Calendar client stubbed — same routing, same Cyrillic query decoding,
same JSON — with an existing 15:00–16:00 booking on Monday 2026-09-07:

```
no services      (60 min): 10:00 11:00 12:00 13:00 14:00 16:00 17:00 18:00 19:00
Энгийн засалт    (60 min): 10:00 11:00 12:00 13:00 14:00 16:00 17:00 18:00 19:00
Оффис колор     (240 min): 10:00 11:00 16:00
Хими / Sika     (120 min): 10:00 11:00 12:00 13:00 16:00 17:00 18:00

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
| Tests | `npm test` (119) |
| Durations | `data/serviceDurations.json` |
| Server accessor | `config/serviceDurations.js` |
| Full rationale | [docs/SERVICE_DURATIONS.md](SERVICE_DURATIONS.md) |
| Closures/holidays | [CLAUDE.md](../CLAUDE.md), `config/closures.js` |
