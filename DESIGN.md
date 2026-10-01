---
name: Tara Salon
description: Plaster & Steel — warm limewash beige, basalt, brushed steel and the logo's orange star; calm, understated luxury.
colors:
  stone: "#2b2622"
  stone-deep: "#221e1b"
  stone-hover: "#3d3530"
  star: "#e8985c"
  copper: "#8a4b25"
  ink: "#2b2520"
  muted: "#5c524a"
  line: "#d9cec0"
  steel: "#b8b5af"
  sand: "#ebe3d8"
  plaster: "#f5f0e8"
  paper-card: "#fbf8f3"
  on-stone: "#f3ede4"
  on-stone-muted: "#c9bfb2"
typography:
  display:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "clamp(2.7rem, 1.8rem + 4.2vw, 5.4rem)"
    fontWeight: 500
    lineHeight: 1.02
  headline:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "clamp(2.1rem, 1.6rem + 2.2vw, 3.2rem)"
    fontWeight: 500
    lineHeight: 1.08
  body:
    fontFamily: "Geologica, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 350
    lineHeight: 1.65
  label:
    fontFamily: "Geologica, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
rounded:
  base: "14px"
  pill: "999px"
components:
  button-primary: { backgroundColor: "{colors.stone}", textColor: "{colors.on-stone}", rounded: "{rounded.pill}" }
  button-on-stone: { backgroundColor: "{colors.on-stone}", textColor: "{colors.stone}", rounded: "{rounded.pill}" }
  button-outline: { backgroundColor: "transparent", textColor: "{colors.ink}", rounded: "{rounded.pill}" }
---

# Tara Salon — design system: "Plaster & Steel"

Implemented in `assets/site.css` (tokens on `:root`) and `assets/booking.css`.
September 2026 rebrand: the salon's new interior — warm beige plaster and
limewash, natural stone, brushed stainless steel, soft indirect light,
rounded organic shapes, lots of space — and the new metallic logo.

## Logo

- `brand/tara-salon-logo.png` and `brand/tara-salon-logo-2000.webp` are the
  files the owner supplied, byte for byte (a test checks). The page uses the
  scaled copies `tara-salon-logo-240/-480` (WebP with PNG fallback).
- **Stone-band rule.** The silver letters were drawn for a dark ground and go
  soft on beige, so the logo sits only on basalt: the header, the footer and
  the maintenance card's top band. Never directly on beige, white or a photo.
- Scale only, by height (56 px desktop, 48 px phone). Never stretch, recolour,
  crop, outline, shadow or animate it.
- Icons (`favicon.ico`, `brand/icon-16/32/180/192/512.png`,
  `icon-maskable-512.png`) are the logo's own metallic «T» and orange star on
  a basalt square; 16/32 px use a larger star so it survives. `og-image.jpg`
  is the logo on basalt.

## Colour

- **Plaster / sand** are the page: `plaster` for most sections, `sand` for
  alternating sections and page intros, `paper-card` for cards and choices.
  A faint mineral grain (inline SVG noise) makes the beige read as limewash.
- **Basalt (`stone`)** is the brand's dark: header, footer, the products band,
  primary buttons. Its edge is a brushed-steel hairline.
- **Star orange** is an accent only: the star mark, the current step, the
  active nav underline, list stars. It is 2.3:1 on beige, so it is never text
  there; on basalt it is 6.6:1 and may mark the current page in the menu.
- **Copper** is the star deepened for text on beige (5.3:1): prices, step
  numbers, the policy rule.
- Text: `ink` on beige (≥ 11:1), `muted` for secondary (≥ 5.5:1);
  `on-stone` / `on-stone-muted` on basalt (≥ 7.8:1).
- The QPay QR box stays pure white so the code scans at full contrast.

## Type

- Headings: **Cormorant Garamond** 500/600, only at 22 px and above.
- Everything else: **Geologica** (variable), body at weight 350.
- Both self-hosted in `fonts/` with cyrillic-ext (Ө ө Ү ү) and latin-ext (₮).
- No all-caps labels, no eyebrow text over headings, sentence case.

## Layout, shape and motion

- Left-aligned, max width 1240 px, generous section spacing.
- Rounded, organic: 14 px corners, pill buttons and chips, and the home hero's
  tall arched photo with a thin brushed-steel rim, lit from above.
- Motion is calm and slow (0.9 s, `--ease`). The home hero has its page-load
  reveal. Below the first screen, section heads and groups ease in once as they
  arrive (`data-reveal`, `data-reveal-group`; children stagger 70 ms). Feature
  photos drift a few pixels against the scroll through the browser's own scroll
  timeline (no script on scroll). Cards lift 3 px on hover; buttons, chips and
  cards press to 98 % on tap. The booking flow has none of this.
  `prefers-reduced-motion` removes all of it, and without JavaScript everything
  is simply visible.
- Feature photos sit in the hero's arch (half-circle top, steel rim) and are
  chosen in `data/imagery.json` (see docs/IMAGERY.md). Plaster bands carry a
  limewash texture and soft light; basalt bands a fine mineral fleck — both
  inline SVG, a few hundred bytes.
- Phones first: 16 px+ gutters, 44–52 px tap targets, no horizontal scroll,
  a «Цаг захиалах» bar once the first screen has scrolled away, and a
  pinned Back / Continue bar in the booking flow.

## Do / Don't

- Do show the salon's own work; don't add stock photos.
- Do state prices and the deposit plainly; show «Үнэ удахгүй» for a price not
  yet set; never invent a figure, review, number or award.
- Don't use star orange for anything a customer has to read on beige.
- Don't put the logo on anything lighter than basalt.
