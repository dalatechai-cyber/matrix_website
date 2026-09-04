# Service durations and booking availability

Status: implemented, needs the salon to confirm the duration figures.
Last updated: 2026-09-04.

## The problem this fixed

Booking treated every appointment as one hour. A customer could pick a 4-hour
service (Оффис колор) and be offered an 18:00 start on a Monday, when the salon
closes at 20:00 — a slot nobody could honour. The customer turns up, the stylist
cannot do the work, and the salon has already taken a deposit.

It was three defects at once, and fixing only the visible one would not have
worked:

1. **Availability didn't know the service.**
   `GET /api/calendar/available-slots` took only `date` and `stylistId`. The
   length came from `stylist.durationMinutes || 60` — a per-*stylist* figure, so
   every hairdresser's appointment was an hour regardless of what was booked.

2. **Conflict detection used the same wrong hour.**
   The overlap test compared `slotStart … slotStart + 60min` against the
   stylist's busy periods. A 4-hour booking starting at 14:00 was therefore
   never seen to collide with an existing 17:00 one.

3. **The calendar event itself was written as one hour.**
   `POST /api/calendar/book` honoured a `totalDuration` only for the manicurist;
   for everyone else it hardcoded the stylist default. That is the worst of the
   three, because the event *is* the busy record every later availability check
   reads back — a 4-hour colour recorded as 1 hour leaves the next three hours
   bookable by someone else. Fixing availability without this would have kept
   double-booking, silently.

Two smaller things fell out of the same investigation:

- `script.js` computed `totalDuration` as `MANICURE_DURATIONS[service] || 30`,
  so every *hair* service contributed 30 minutes. Hair durations did not exist.
- **Оффис колор was not in the booking list at all.** It is on the price list
  (`data/pricing.json`) but was missing from `HAIR_SERVICES`, so the salon's
  longest colour service could not be booked online. It has been added.

## How it works now

`data/serviceDurations.json` is the single source of truth. The server reads it
through `config/serviceDurations.js`; the browser fetches the same file. There is
no second copy to drift.

```
customer ticks services
        │
        ▼
GET /api/calendar/available-slots?date=…&stylistId=…&services=A,B,C
        │
        ├─ resolve total minutes from data/serviceDurations.json
        ├─ candidate starts: stylist's usual grid (60min hair / 30min manicure)
        │                    up to  close − totalDuration
        └─ drop any start whose whole appointment overlaps a busy period
        │
        ▼
customer picks a start, pays, then
POST /api/calendar/book  → event of the SAME resolved length
```

Key decisions, and why:

- **The server resolves duration; the browser's number is ignored.** The figure
  decides how much of a stylist's day is blocked. Trusting the client would let
  anyone reserve a whole day, or shorten a booking and re-open a slot the salon
  cannot honour. `totalDuration` is still accepted in the request body for
  backwards compatibility, but it does not affect the result.
- **An unknown service name costs the default (60 min), never zero.** Under-
  booking is what causes the salon to promise a slot it cannot keep, so the safe
  failure is to reserve too much. Unknown names are logged so the catalogue and
  the UI can be brought back into line.
- **The slot grid did not change.** Hairdressers are still offered starts on the
  hour, the manicurist every 30 minutes. Only the *last* start moved, and the
  overlap window widened. Changing the grid would have been a UX change nobody
  asked for.
- **Name matching is forgiving.** The booking checkboxes, the price list and the
  salon's own spelling differ in punctuation and in ё/е — `Будаг/угны`,
  `Будаг (Уг)` and `Оффис колор/Сор` all resolve. `normalizeServiceName()` exists
  in both `config/serviceDurations.js` and `script.js` and the two must agree.

## The figures need salon sign-off

Two durations came from the salon directly: **Оффис колор ≈ 4h** and
**хими ≈ 2h**. The manicure figures were already in the codebase and are
unchanged. **Everything else is an engineering estimate** and is flagged
`"confirm": true` in `data/serviceDurations.json`.

This matters commercially: too long and the salon loses bookable slots; too
short and the original bug comes back in a milder form. Someone at the salon
should walk the list. Editing the JSON is the whole change — no code, no
redeploy logic, and the booking UI picks it up on next load.

```bash
grep '"confirm": true' data/serviceDurations.json   # everything awaiting review
```

## Verifying

```bash
npm test    # 119 tests; the duration-aware ones are at the end of tests/calendar.test.js
```

The behavioural check on a deployed build: open the booking section, pick any
hairdresser, tick **Оффис колор**, and confirm the time list ends at **16:00** on
a Mon–Sat date (15:00 on a Sunday) with a "≈ 4 цаг" hint above it. Ticking a
single ordinary cut should restore 19:00.

## Still open

- The duration figures above (the main one).
- `routes/qpay.js` `createCalendarEventForInvoice()` also builds a calendar event
  and now derives its length from the services stored on the invoice. Note this
  path looks **dead in production**: `vercel.json` rewrites
  `/api/qpay/create-payment` to the standalone `api/qpay/create-payment.js`,
  which never populates the in-memory `paymentStatuses` map that this function
  reads, so it returns early. The live booking is created by the browser calling
  `POST /api/calendar/book` after payment. Worth deciding whether to delete the
  dead path rather than maintain two.
- Duration is chair time for one customer, assumed back-to-back. If the salon
  ever runs a colour's processing time in parallel with another customer, this
  model will over-book the stylist's day and needs revisiting.
