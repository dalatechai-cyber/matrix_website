# Tara Salon rebuild — progress

Branch `claude/beautiful-cori-8aoiuy`, previewed on Vercel. **Preview only:**
production (`main`, matrixecosalon.org) keeps taking bookings exactly as
today until the owner approves the switch.

## Part 1 — brand, design system, home page ✅

- Logos: `brand/tara-salon-logo.svg` (teal + orange, light backgrounds) and
  `brand/tara-salon-logo-light.svg` (white + orange, teal/dark), taken
  unmodified from the `tara-logo` branch. PNG backups
  (`brand/*-4k.png`) are used only to generate the favicon, touch icons
  (`brand/icon-*.png`, `favicon.ico`) and the 1200×630 social preview
  (`brand/og-image.jpg`). The logo is scaled only — never stretched,
  recoloured, cropped or given effects.
- Fonts self-hosted in `fonts/`: Geologica (body, UI) and Cormorant Garamond
  (headings). Both contain the Mongolian letters Ө ө Ү ү (checked in the font
  files) and ₮. No request to Google Fonts.
- `assets/site.css`, `assets/site.js`: new design system (teal #04484A brand,
  orange #F58634 accent only, mist/white neutrals). One page-load animation;
  `prefers-reduced-motion` honoured.
- Pages are assembled by `lib/pages.js` (shared head/header/footer, both
  branches' details from `data/branches.json`, origin-relative canonical and
  social links). `team.html` is retired (301 to `/`).
- `index.html` rebuilt. `/#booking` (old links, the chatbot) forwards to
  `/booking.html`.

## Part 2 — price list, gallery, branches, products ✅

- `services.html` «Үйлчилгээ ба үнэ»: rendered from `data/services.json`
  (same for both branches). Every price is `null` → «Үнэ удахгүй» until the
  new prices arrive; the names are the bookable services, so the menu and
  the booking list can never disagree.
- `zurag.html` «Бүтээл»: 17 photos of the salon's own work (two weak ones
  dropped), Бүгд / Эмэгтэй / Эрэгтэй filter, keyboard-friendly lightbox.
- `contact.html` «Салбарууд»: both branches from `data/branches.json`; Google
  map loads only on tap (fast pages, no Google request on load). Парк Од shows
  «Удахгүй нэмэгдэнэ» placeholders and no booking button until it is ready.
- `products.html` (Amos) and `keune-products.html`: same content, data files
  and behaviour, new skin; script moved to `assets/products.js`.
- `team.html` deleted (301 → `/`).

## Part 3 — branch-aware booking ✅

- `booking.html` + `assets/booking.js`: six steps — салбар → үйлчилгээ →
  үсчин («Үйлчлүүлэгч: Эмэгтэй / Эрэгтэй», only matching hairdressers of that
  branch) → өдөр, цаг → мэдээлэл + non-refundable-deposit tick box → QPay QR
  with «QR код m:ss хүчинтэй» and «Шинэ QR код авах». Phone back button
  moves between steps. On a phone the bank-app buttons come first.
- Same booking engine and protections: server-decided deposit and duration,
  closures, gender rule on both payment paths, recorded agreement time and
  invoice id on the calendar event, 3 s / 12 s polling to 30 min, late
  payments via the signed QPay callback, one calendar event per booking,
  Telegram alerts. Old pages still mid-booking keep working (the new `branch`
  field is optional and defaults to Яармаг).
- `config/branches.js`: branch → calendars and QPay account. Яармаг keeps its
  exact QPay settings; Парк Од only its own `PARKOD_*` variables, no
  fallback. Парк Од is shown but not bookable until connected. Alerts carry
  the branch and can go to Парк Од's own chat (`PARKOD_TELEGRAM_CHAT_ID`).
- `tests/branches.test.js` (10 tests) proves the separation; full suite
  186/186.
- Verified in a browser at 390 px and 1440 px with the payment APIs mocked:
  paid → booked, QR expired → new invoice, slot taken → back to times.
- Old `script.js`, `styles.css`, `logo.png`, `favicon.jpg` removed.

## Part 4 — domain-move plan, review, PR — pending

## Open items for the owner

- All new Mongolian copy is a **draft** for approval.
- New prices: every price shows «Үнэ удахгүй» until supplied.
- Парк Од: address, phones, hours, map, stylists, calendars and QPay account.
- Products page keeps the old claim «Бид Amos Professional-ийн албан ёсны
  дистрибьютер.» — confirm it is still true for Tara Salon.
