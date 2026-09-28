---
name: Tara Salon
description: Teal and orange from the logo, white and mist neutrals — a calm, editorial salon site.
colors:
  teal: "#04484a"
  teal-deep: "#03393b"
  teal-hover: "#06595c"
  orange: "#f58634"
  ink: "#142727"
  muted: "#4d6362"
  line: "#d6e1e0"
  mist: "#edf3f2"
  paper: "#ffffff"
  on-teal: "#ffffff"
  on-teal-muted: "#b9d4d3"
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
  base: "6px"
  pill: "999px"
components:
  button-primary: { backgroundColor: "{colors.teal}", textColor: "{colors.on-teal}", rounded: "{rounded.pill}" }
  button-light: { backgroundColor: "{colors.paper}", textColor: "{colors.teal}", rounded: "{rounded.pill}" }
  button-outline: { backgroundColor: "transparent", textColor: "{colors.teal}", rounded: "{rounded.pill}" }
---

# Tara Salon — design system

Implemented in `assets/site.css` (tokens on `:root`) and `assets/booking.css`.

## Logo

- `brand/tara-salon-logo.svg` (teal + orange) on white and mist;
  `brand/tara-salon-logo-light.svg` (white + orange) on teal and over photos.
  The SVGs are the files the salon supplied, byte for byte (a test checks).
- Scale only. Never stretch, recolour, crop, outline, shadow or animate it.
  Keep clear space of at least the height of the orange star around it.
- PNG copies (`brand/*-4k.png`) are only the source for the favicon, touch
  icons and the social preview image.

## Colour

- **Teal** is the brand: hero, page intros, primary buttons, footer.
- **Orange** is an accent only: the star mark, the current step, the active
  nav underline, the deposit rule. Never body text (2.6:1 on white) and never
  a large fill.
- Neutrals are white and a teal-tinted mist, not cream. Text is ink on white
  (≥ 12:1) and white or `on-teal-muted` on teal (≥ 6.9:1).

## Type

- Headings: **Cormorant Garamond** 500/600, only at 22 px and above.
- Everything else: **Geologica** (variable), body at weight 350.
- Both are self-hosted in `fonts/` with the cyrillic-ext subset, so the
  Mongolian letters Ө ө Ү ү render in the brand fonts; Geologica's latin-ext
  subset carries ₮. No Google Fonts request.
- No all-caps labels, no eyebrow text over headings, sentence case.

## Layout and motion

- Left-aligned, max width 1240 px, generous section spacing.
- One bold element per page: the teal hero with the tall arched photo on the
  home page. Everything else stays quiet.
- One page-load reveal on the home hero; nothing else animates on its own.
  `prefers-reduced-motion` removes it.
- Phones first: 16 px+ gutters, 44–52 px tap targets, no horizontal scroll,
  a «Цаг захиалах» bar once the first screen has scrolled away, and a
  pinned Back / Continue bar in the booking flow.

## Do / Don't

- Do show the salon's own work; don't add stock photos.
- Do state prices and the deposit plainly; show «Үнэ удахгүй» for a price not
  yet set; never invent a figure, review, number or award.
- Don't use orange for anything a customer has to read.
