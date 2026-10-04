# Яармаг branch move (November 2026), ready to apply

Яармаг moves to **Хан-Уул дүүрэг, 24-р хороо, Наадамчдын зам гудамж, VIP
Center 2 давхар**. The date is not set yet, so the site still shows the current
address. [yaarmag-move.patch](yaarmag-move.patch) holds the whole change
to `data/branches.json`:

- the new address (shown on the branch cards, the footer and the booking page's
  branch step, which all read this one file);
- the Google Maps link and the map on the contact page removed. Both point at
  Номин Яармаг, the old location; the card shows «Байршлын мэдээлэл удахгүй
  нэмэгдэнэ» until a map link for VIP Center is added (`mapUrl`,
  `mapEmbedQuery`).

Phones, hours, Facebook, hairdressers, calendars and QPay are unchanged.

## On the day

```bash
git apply docs/pending/yaarmag-move.patch
npm test            # all pass with the new address (checked when the patch was made)
git commit -am "Яармаг: new address at VIP Center from <date>"
```

Then push and redeploy. If the hours change with the move, edit `hoursText`
and `workHours` for `yaarmag` in the same commit, because `workHours` decides
which booking times are offered.
