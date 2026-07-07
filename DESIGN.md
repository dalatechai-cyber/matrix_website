---
name: Matrix Eco Salon
description: Deep-green, eco-premium salon site — calm, modern, quietly luxurious.
colors:
  accent: "#64d39a"
  accent-dark: "#2f8d66"
  highlight: "#f4d58d"
  bg: "#0f1a16"
  surface: "#121f1a"
  surface-light: "#16251f"
  text: "#e8f5ef"
  muted: "#b4c8bf"
  ink-on-accent: "#04110b"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(2.3rem, 3.6vw, 3.4rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "normal"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(1.8rem, 3vw, 2.6rem)"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.5px"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  pill: "999px"
spacing:
  xs: "0.5rem"
  sm: "0.8rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "3.6rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink-on-accent}"
    rounded: "{rounded.pill}"
    padding: "0.65rem 1.4rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.ink-on-accent}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "0.65rem 1.4rem"
  chip-filter:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0.6rem 1.2rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0.7rem 0.9rem"
---

# Design System: Matrix Eco Salon

## 1. Overview

**Creative North Star: "The Moonlit Conservatory"**

Matrix is a glasshouse of green after dark: deep forest-black surfaces, a soft
mint glow that stands in for moonlight, and warm gold that reads as lamplight
through the leaves. The system is dark by conviction, not fashion — a calm,
low-lit space where hair and skin work is presented like botany under glass.
Everything is quiet: generous negative space, one confident accent, and
restraint doing the work that decoration would do on a lesser site.

The register is brand — the design *is* the product. It sells the salon as the
premium, eco-conscious choice, so prestige is carried by material honesty and
craft, never by volume. Depth comes from tonal layering of near-black greens and
soft shadow, with backdrop blur used sparingly and purposefully (the sticky
header) rather than as decoration.

This system explicitly rejects the **generic templated salon** (stock heroes,
the same rotating carousel every beauty site ships) and anything **loud, flashy,
or neon**. Saturation, gloss, and busyness are the enemy; the mint accent earns
its impact by being rare against the dark.

**Key Characteristics:**
- Dark, near-black green canvas with a single mint accent and a warm-gold spark
- One typeface (Manrope) working across the whole weight range
- Soft-cornered surfaces with faint mint borders and tinted gradients, not hard cards
- Motion is restrained and eased-out; blur/glow used only where it earns its place
- Bilingual reality: Mongolian Cyrillic content, legible at mobile sizes

## 2. Colors

A deep-green near-monochrome carrying one mint accent and a single warm-gold
highlight — the whole palette lives in a narrow, low-light band so the accent
can do the talking.

### Primary
- **Moonlit Mint** (#64d39a): The single voice of the brand. Links, prices,
  active states, button fills, section-title underlines, focus glows. It appears
  on a small fraction of any screen — that scarcity is what makes it read as
  premium rather than loud.
- **Conservatory Green** (#2f8d66): The deeper end of the accent. Anchors the
  primary-button gradient (pairs down from Moonlit Mint), the scrollbar thumb,
  and any place the mint needs a shadow-side.

### Secondary
- **Lamplight Gold** (#f4d58d): A rare warm highlight against all the green —
  used as a spark for special emphasis. Deploy sparingly; two accents shouting
  at once breaks the calm.

### Neutral
- **Forest Black** (#0f1a16): The body base, rendered as a radial gradient from a
  faintly lifted center (#1a2c24) down to near-black (#090f0d). The room the
  whole site sits in.
- **Deep Fern** (#121f1a): Default surface for cards, the header, team cards,
  contact cards.
- **Fern Rise** (#16251f): The elevated surface — modals, review cards, popovers.
- **Frosted Sage** (#e8f5ef): Primary text. Near-white with a green tint so it
  belongs to the room; high contrast on every dark surface.
- **Eucalyptus Gray** (#b4c8bf): Muted/secondary text — descriptions, taglines,
  labels. Still clears AA on the dark base; never drop text below it.
- **Ink-on-Accent** (#04110b): The near-black used *on top of* mint (button
  labels, active day/time chips). Dark ink on the accent, never white.

### Named Rules
**The One-Voice Rule.** Moonlit Mint is the only accent that carries meaning.
Lamplight Gold is a guest, not a co-host — if a screen needs two accents to feel
alive, the layout is wrong, not the palette.

**The Light-Island Rule.** The booking calendar and its inputs are deliberately
inverted — white (#ffffff) card, dark ink (#1a1a1a) — because a scheduling UI
must read like a crisp form, not a mood. This is the one sanctioned light island
in a dark site; keep the mint accent for its active states so it still belongs.

## 3. Typography

**Display Font:** Manrope (with `sans-serif` fallback)
**Body Font:** Manrope (same family)
**Label Font:** Manrope (same family)

**Character:** One humanist-geometric sans doing everything, differentiated by
weight and size rather than by pairing. Manrope's slightly rounded terminals keep
the dark, premium surface from turning cold — modern and clean without being
clinical. No second typeface; contrast comes from weight (300–700), not families.

### Hierarchy
- **Display** (700, `clamp(2.3rem, 3.6vw, 3.4rem)`, line-height 1.1): Hero H1
  only. Sits well under the ~6rem ceiling — the site whispers, it doesn't shout.
- **Headline** (700, `clamp(1.8rem, 3vw, 2.6rem)`, line-height 1.2): Page and
  Keune-hero H2s.
- **Title** (600–700, ~1.05rem, line-height 1.3): Card titles, group headers,
  modal titles.
- **Body** (400, 1rem, line-height 1.6): Paragraphs and list copy. Keep measure
  in the 65–75ch band; Eucalyptus Gray for secondary prose, Frosted Sage when it
  must be read.
- **Label** (600, 0.75rem, letter-spacing 0.5px, uppercase): Product categories,
  eyebrow-style category tags on product/Keune cards.

### Named Rules
**The Weight-Not-Family Rule.** Never introduce a second typeface. Hierarchy and
personality come from Manrope's weight range. A serif or a second sans breaks the
system.

## 4. Elevation

A hybrid: mostly tonal layering (near-black greens stacked — Forest Black →
Deep Fern → Fern Rise) with soft, diffuse dark shadows to lift interactive
surfaces. Shadows are ambient and low-contrast, never hard drop-shadows; depth is
suggested, not stamped. Faint mint borders (`rgba(100,211,154,0.12–0.25)`) do as
much lifting as the shadows do. Backdrop blur is reserved for the sticky header,
where it is functional (content reads softly beneath it), not decorative.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 10px 20px rgba(0,0,0,0.18)`): Price/product
  cards at rest.
- **Hover lift** (`box-shadow: 0 16px 28px rgba(0,0,0,0.25)` + `translateY(-2..-6px)`):
  Cards on hover, paired with a brighter mint border.
- **Floating layer** (`box-shadow: 0 24px 60px rgba(0,0,0,0.45–0.65)`): Modals,
  dropdown menus, video popovers.
- **Header on scroll** (`box-shadow: 0 8px 24px -10px rgba(0,0,0,0.5)`): The tight,
  elegant lift the sticky header gains once the page scrolls.

### Named Rules
**The Soft-Depth Rule.** Shadows are always dark, large-radius, and low-opacity.
If a shadow looks like a hard 2014-app drop shadow (small blur, high opacity), it
is wrong — widen the blur and drop the alpha.

## 5. Components

### Buttons
- **Shape:** Fully pill (`999px`).
- **Primary:** A mint gradient (`linear-gradient(135deg, #64d39a, #2f8d66)`) with
  Ink-on-Accent (#04110b) label and a soft mint shadow (`0 12px 25px
  rgba(100,211,154,0.2)`). Padding `0.65rem 1.4rem`. (The gradient can't live in
  the token schema's single `backgroundColor`; frontmatter approximates with
  Moonlit Mint — the gradient is canonical.)
- **Hover / Focus:** `translateY(-2px)` and a deeper mint shadow. Eased, subtle.
- **Ghost:** Transparent fill, mint border (`rgba(100,211,154,0.35)`), mint label
  — the quiet secondary action.

### Chips
- **Filter chips:** Deep-Fern fill with a mint border; text in Frosted Sage.
  Selected state fills toward mint (`rgba(100,211,154,0.25)`) with a mint label
  and a faint mint glow. Used on product/Keune filter rows.

### Cards / Containers
- **Corner Style:** Soft, `16–24px` depending on prominence (products 16px,
  price cards 20px, hero/eco cards 22–24px).
- **Background:** A gentle tinted gradient (`linear-gradient(160deg,
  rgba(100,211,154,0.08), rgba(12,20,17,0.7))`) or flat Deep Fern.
- **Border:** Always a faint mint hairline (`rgba(100,211,154,0.12–0.25)`); it
  brightens on hover.
- **Shadow Strategy:** Resting card → Hover lift (see Elevation).
- **Internal Padding:** `1–2rem` by density.
- **Rule:** No nested cards. A card inside a card is always wrong here.

### Inputs / Fields
- **Style:** Dark translucent fill (`rgba(12,20,17,0.6)`), faint mint border,
  `10px` radius, Frosted Sage text.
- **Focus:** Mint border + a soft mint focus ring (`0 0 0 3px
  rgba(100,211,154,0.15)`).
- **Light-island exception:** Inside the white booking calendar, inputs invert to
  light-gray fills (#f9fafb) with dark ink — see the Light-Island Rule.

### Navigation
- **Style:** A sticky, semi-transparent frosted header (Deep-Fern at ~80% over a
  14px backdrop blur) with a faint mint bottom border. Nav links sit in
  Eucalyptus Gray and shift to Moonlit Mint on hover.
- **Scroll behavior:** Past ~10px the header eases (0.4s, ease-out) into a
  lighter, more translucent frost (same colour, 60% opacity, 20px blur + slight
  saturate) with a tight lift shadow — content flows softly beneath it. Honours
  `prefers-reduced-motion`.
- **Dropdown:** Hover-reveal menu (Fern-Rise at 96%, blur, mint border) that fades
  and lifts in; the header stays `overflow: visible` so it never clips.
- **Mobile:** Below 900px the links collapse behind a bordered hamburger into a
  full-width panel dropping from the header; the primary "book" CTA reappears
  inside the open menu.

### Gallery Carousel (signature)
- A 3-D focus carousel: the active image is sharp and full-scale; neighbours are
  blurred (`blur(5px)`), dimmed (`opacity .42`), and scaled back (`.93`), sliding
  on an eased cubic-bezier(.22,1,.36,1) track with mint dot indicators. On mobile
  it becomes a stacked single-image swipe slider. This is the salon's proof-of-work
  surface — keep it central and uncluttered.

## 6. Do's and Don'ts

### Do:
- **Do** keep Moonlit Mint (#64d39a) rare — one accent, small area, high impact.
  Its scarcity is the premium signal.
- **Do** build depth from tonal layering (Forest Black → Deep Fern → Fern Rise)
  plus faint mint hairlines and soft, wide, low-opacity shadows.
- **Do** carry hierarchy with Manrope weights (300–700), never a second family.
- **Do** ease every transition out (cubic-bezier(0.22, 1, 0.36, 1) is the house
  curve) and pair every animation with a `prefers-reduced-motion` fallback.
- **Do** keep body text on Frosted Sage / Eucalyptus Gray against the dark base —
  verify ≥4.5:1 before shipping any new text color.
- **Do** protect the booking path: browse → decide → book → pay stays obvious on
  every page and every width.

### Don't:
- **Don't** ship the **generic templated salon** — no stock hero, no interchangeable
  beauty-template carousel. Every screen must feel specific to Matrix.
- **Don't** go **loud, flashy, or neon** — no high-saturation fills, glossy
  gradients, or busy competing accents. Loudness reads cheap here.
- **Don't** let a second accent (Lamplight Gold) compete with the mint — it is a
  rare spark, never a co-lead.
- **Don't** use gradient *text* (`background-clip: text`) or decorative
  glassmorphism; backdrop blur is reserved for the functional sticky header.
- **Don't** nest cards, and don't spread identical icon+heading+text card grids —
  vary the surfaces.
- **Don't** stamp hard, small-blur drop shadows. If it looks like a 2014 app, the
  blur is too tight and the opacity too high.
- **Don't** drop text below Eucalyptus Gray on the dark base, or push type past a
  ~6rem display ceiling.
