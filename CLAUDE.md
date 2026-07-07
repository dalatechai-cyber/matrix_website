# Matrix Eco Salon

Static, multi-page marketing site for **Matrix Eco Salon** (Ulaanbaatar,
Mongolia). Six HTML pages — `index`, `services`, `team`, `zurag` (gallery),
`products` (Amos), `keune-products` — sharing `styles.css` and `script.js`, plus
an Express API (`server.js`, `routes/`) for QPay payments and Google Calendar
booking. Content is Mongolian (Cyrillic).

## Design Context

Design decisions are governed by two root documents — read them before any
UI/UX work:

- **[PRODUCT.md](PRODUCT.md)** — strategic: register (`brand`), users, purpose,
  brand personality (eco · modern · premium), anti-references, design
  principles, accessibility target (WCAG AA).
- **[DESIGN.md](DESIGN.md)** — visual system: palette (dark forest-green with a
  mint accent, "The Moonlit Conservatory"), Manrope type scale, elevation,
  components, and Do's/Don'ts. Token frontmatter is normative.

The impeccable skill is the design authority for this project; prefer it over
generic UI tooling. The `.impeccable/` directory holds its sidecar
(`design.json`) and live-mode config.
