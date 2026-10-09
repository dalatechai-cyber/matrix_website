# Runbook: www.tarasalon.org becomes the main address (S9 Part B)

Code: `config/canonicalHost.js` (pull request «tarasalon.org as the main address»). It is OFF
until you set `CANONICAL_HOST` in Vercel; merging and deploying changes nothing by itself.

## What customers get after the switch

- Every old page (`www.matrixecosalon.org/…`, and the apex `tarasalon.org/…` if Vercel does not
  already send it to www) answers **301** to the same page and query on **https://www.tarasalon.org**.
  The apex `matrixecosalon.org` is already sent to `www.matrixecosalon.org` by Vercel (a 307, for
  every path, live 2026-10-09), so it reaches the new address in two hops; that is harmless: no
  callback was ever minted on that apex. The 301 is cached by browsers for one hour only.
  Old links, Facebook posts, printed QR codes and `?branch=…` / `?test=…` links keep working.
- `/api/*` on the old address is **never** redirected: QPay's callbacks for invoices made before
  the switch, the calendar cron, `/api/branches` and Дали all keep reaching it and are answered there.
- Every link the site writes names `https://www.tarasalon.org`: `<link rel="canonical">`,
  `og:url` / `og:image` (share previews), the new `/sitemap.xml` and `/robots.txt`, and QPay's
  `callback_url` on every new invoice, whatever address the customer came in on.
- Preview deployments (`*.vercel.app`) and local runs are never redirected and keep their own
  links, so a preview's invoice never calls Production back.
- Not produced by the site at all (checked 2026-10-09): e-mails, calendar invites with links,
  booking-confirmation messages with a link. The calendar events carry no website address.
- Дали's links (booking, deposit, products) are dala-ai rows: `docs/runbooks/tara-2026-10-09.md`
  in dala-ai (its step 6) moves them to `https://www.tarasalon.org/`. Do that one first or after;
  both addresses serve the same site.

## Do NOT

- **Do not set the old domain to «Redirect to another domain» in Vercel → Domains.** Vercel's
  redirect sends `/api/*` too (a 308 on QPay's POST callback): a paid customer never booked.
  Both domains stay attached to `matrix-website` and serving it; the code does the page redirect.
- Do not remove matrixecosalon.org from Vercel, Namecheap or Google Workspace. Renew it for at
  least a year. Its DNS also carries the Google Workspace mail records of
  `booking@matrixecosalon.org`: never touch its MX/TXT records.
- Do not change `BOOKING_CALLBACK_SECRET` or `QPAY_PASSWORD` at the same time: callbacks signed
  before the switch must still verify.

## Google Workspace `booking@matrixecosalon.org`

Nothing depends on the website's address. The Яармаг calendars are secondary calendars of that
account, shared to the service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`,
no impersonation), and Парк Од's come from `PARKOD_CALENDAR_<NAME>`. The switch does not touch
them. What would break them: the Workspace domain lapsing or its mail records changing. Keep
both. (Moving the account to `@tarasalon.org` is a separate project, not needed.)

## When

At a closed hour, when nobody is booking: the branches open 10:00–20:00 (Sunday 11:00–19:00)
Ulaanbaatar time, and customers still book online late in the evening. Best: **03:00–05:00 in
Ulaanbaatar = 19:00–21:00 UTC**. Not during dala-ai's steps 5–9 (00:00 UTC).

## Steps

1. **Check the new address serves THIS project's Production** (founder, 2026-10-09: it does;
   not reachable from a Claude session). A 200 alone is not enough: a parking page or another
   project answers 200 too. All of these must hold:
   - Vercel → matrix-website → Settings → Domains: `www.tarasalon.org` is listed, assigned to
     **Production** (no Git branch), and **not** set to redirect anywhere. `tarasalon.org` (apex)
     either serves Production or redirects **to www.tarasalon.org** (never the other way round:
     www → apex plus this code's apex → www is a loop).
   - `curl -sI 'https://www.tarasalon.org/' | grep -i -E '^(HTTP|server)'` → `HTTP/2 200` and
     `server: Vercel`.
   - `curl -s 'https://www.tarasalon.org/api/branches'` prints exactly what
     `curl -s 'https://www.matrixecosalon.org/api/branches'` prints.
2. **Merge** the matrix_website pull request; wait for the Production deployment **Ready**.
   Nothing changes yet. `curl -s https://www.matrixecosalon.org/robots.txt` now answers (it was a
   404) with `Sitemap: https://www.matrixecosalon.org/sitemap.xml`.
3. **Vercel → matrix-website → Settings → Environment Variables (Production only):**
   - `CANONICAL_HOST` = `www.tarasalon.org` (exactly: no `https://`, no slash);
   - `BASE_URL` = `https://www.tarasalon.org` (the fallback when a request's host is unreadable).
   Do not set `CANONICAL_HOST` for Preview or Development. Then **Redeploy** the Production deployment.
4. **Check, from any terminal** (each line: what you should see):
   ```
   curl -sI 'https://www.matrixecosalon.org/booking.html?branch=parkod' | grep -i -E '^(HTTP|location|cache-control)'
     → HTTP/2 301 · location: https://www.tarasalon.org/booking.html?branch=parkod · cache-control: public, max-age=3600
   curl -sI 'https://tarasalon.org/' | grep -i -E '^(HTTP|location)'
     → 301 (or Vercel's 307/308) to https://www.tarasalon.org/
   curl -s -o /dev/null -w '%{http_code}\n' 'https://www.matrixecosalon.org/api/branches'
     → 200   (not 301: the API stays)
   curl -s 'https://www.tarasalon.org/' | grep -o '<link rel="canonical"[^>]*>'
     → <link rel="canonical" href="https://www.tarasalon.org/">
   curl -s 'https://www.tarasalon.org/sitemap.xml' | head -4
     → <loc>https://www.tarasalon.org/</loc> …
   ```
5. **One 100₮ test** on the phone: open `https://www.matrixecosalon.org/?test=<BOOKING_TEST_TOKEN>`
   (the OLD address on purpose). *You should see:* the address bar becomes
   `www.tarasalon.org`, the test banner and a **100₮** QR. Pay it. *You should see:* the booking
   confirmed, a «ТЕСТ» event on the hairdresser's calendar, 100₮ in that branch's account.
   Vercel → Logs, host `www.tarasalon.org`: `POST /api/qpay/create-payment` 200 and QPay's
   `/api/qpay/late-payment` 200 on **www.tarasalon.org**. Delete the «ТЕСТ» event.
6. **QPay — first decide whose merchant record it is.** Both branches use the site's one QPay
   login and merchant «exactly as Core Language and Matrix do» (CLAUDE.md). If that merchant
   record is shared with Core Language, changing its website field relabels another business:
   leave it, or ask QPay for Tara's own record. If it is Tara's alone: website field →
   `https://www.tarasalon.org`. Nothing in the code reads it; whether QPay checks callbacks
   against it is unknown, which is why step 5's «late-payment 200 on www.tarasalon.org» is required.
7. **Google:** Search Console → add `https://www.tarasalon.org` (DNS TXT at Namecheap), then on
   the old property *Settings → Change of address* → the new one; submit
   `https://www.tarasalon.org/sitemap.xml`. Business Profile (Яармаг; Парк Од when created):
   website `https://www.tarasalon.org/`, appointment link
   `https://www.tarasalon.org/booking.html?branch=yaarmag` (Парк Од: `?branch=parkod`).
8. **Facebook / Instagram:** each Page's website field, each Instagram bio link, Messenger
   automatic replies and pinned posts → `https://www.tarasalon.org/`. Then
   developers.facebook.com/tools/debug → `https://www.tarasalon.org/` → *Scrape Again* (the share
   preview loses the old cached image).
9. **Watch for a day:** Vercel logs filtered by host `www.matrixecosalon.org` should show only
   301s on pages and 200s on `/api/*` (QPay callbacks of older invoices, the cron); on host
   `www.tarasalon.org`, every `/api/qpay/late-payment` must be 200. Any other status there: roll back.

## Rollback

Delete `CANONICAL_HOST` (and set `BASE_URL` back) in Vercel → Redeploy. The site again follows
the visitor's address. Browsers that saw a 301 keep going to www.tarasalon.org for up to an hour; that is
harmless while both addresses serve the same site, and the redirect is cached for one hour at
most, so a broken new address stops being visited within the hour of the rollback. Or Vercel → Deployments → the previous one →
Instant Rollback (the variable stays but the old code ignores it).
