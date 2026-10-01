'use strict';

/**
 * Assembles the site's pages. Every page is served by server.js (so
 * SITE_MAINTENANCE can replace it); on the way out the shared header and
 * footer are inserted and the branch blocks are written from
 * data/branches.json — one source for both branches' addresses, phones and
 * hours, so a page can never show a different number from the footer.
 *
 * Markers in a page:
 *   <!-- @head -->                    partials/head.html (fonts, styles, icons, social preview)
 *   <!-- @header -->                  partials/header.html (the current page marked)
 *   <!-- @footer -->                  partials/footer.html
 *   <!-- @branches -->                both branches, full (address, hours, map)
 *   <!-- @branches:compact -->        both branches, without the map
 *   <!-- @price-list -->              the service menu with prices, from data/services.json
 *   <!-- @price-nav -->               links to each price-list category
 *   <!-- @service-cards -->           the home page's category cards with starting prices
 *   <!-- @gallery -->                 every photo in data/gallery.json, with filters
 *   <!-- @gallery:home -->            the home page's selection from data/gallery.json
 *   <!-- @image:<slot> -->            a feature photo from data/imagery.json (nothing
 *                                     when that place has no photo yet)
 *   {{origin}}                        this deployment's public origin (canonical, og:url,
 *                                     og:image), so a new domain needs no page edits
 *   {{v}}                             asset version, for cache busting
 */

const fs = require('fs');
const path = require('path');
const { branchReadiness } = require('../config/branches');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index', 'services', 'zurag', 'products', 'keune-products', 'booking', 'contact'];

const cache = new Map();
function readFile(rel) {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return cache.get(rel);
}

/** Only https links from data files become links. */
function safeUrl(u) {
  return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// require() rather than a file read so Vercel's bundler ships the file.
function branchData() {
  return require('../data/branches.json');
}

const PLACEHOLDER = '<span class="placeholder">Удахгүй нэмэгдэнэ</span>';

/** "76001888" → "+976 7600 1888", as a tappable link. */
function phoneLink(digits) {
  const d = String(digits).replace(/\D/g, '');
  const shown = d.length === 8 ? `+976 ${d.slice(0, 4)} ${d.slice(4)}` : d;
  return `<a href="tel:+976${esc(d)}">${esc(shown)}</a>`;
}

function hoursHtml(b) {
  if (!Array.isArray(b.hoursText) || b.hoursText.length === 0) return PLACEHOLDER;
  return b.hoursText.map((h) => `${esc(h.days)}: ${esc(h.time)}`).join('<br />');
}

function mapHtml(b) {
  if (!b.mapEmbedQuery) {
    return '<div class="map-frame"><p>Байршлын мэдээлэл удахгүй нэмэгдэнэ.</p></div>';
  }
  const src = `https://www.google.com/maps?q=${encodeURIComponent(b.mapEmbedQuery)}&output=embed`;
  return `<div class="map-frame" data-map-src="${esc(src)}" data-map-title="${esc(b.name)} — газрын зураг">
          <div><p>Газрын зургийг дарж нээнэ үү. Google Maps ачаалагдана.</p>
          <button class="btn btn--outline" type="button" data-map-load>Газрын зураг харах</button></div>
        </div>`;
}

function branchCard(b, { withMap }) {
  const bookable = branchReadiness(b.id).ready;
  const phones = (b.phones || []).length ? b.phones.map(phoneLink).join(', ') : PLACEHOLDER;
  const actions = [];
  if (bookable) {
    actions.push(`<a class="btn btn--primary" href="/booking.html?branch=${esc(b.id)}">Энэ салбарт захиалах</a>`);
  }
  if (safeUrl(b.facebook)) {
    actions.push(`<a class="btn btn--outline" href="${esc(b.facebook)}" target="_blank" rel="noopener noreferrer">Facebook хуудас</a>`);
  }
  if (safeUrl(b.mapUrl)) {
    actions.push(`<a class="btn btn--outline" href="${esc(b.mapUrl)}" target="_blank" rel="noopener noreferrer">Google Maps-д нээх</a>`);
  }
  return `<article class="branch" id="branch-${esc(b.id)}">
        <h3>${esc(b.name)}</h3>
        <dl>
          <dt>Хаяг</dt><dd>${b.address ? esc(b.address) : PLACEHOLDER}</dd>
          <dt>Утас</dt><dd>${phones}</dd>
          <dt>Цагийн хуваарь</dt><dd>${hoursHtml(b)}</dd>
        </dl>
        ${withMap ? mapHtml(b) : ''}
        ${actions.length ? `<div class="branch-actions">${actions.join('')}</div>` : ''}
        ${bookable ? '' : '<p class="branch-note">Онлайн захиалга удахгүй нээгдэнэ.</p>'}
      </article>`;
}

function branchesHtml(opts) {
  const data = branchData();
  return `<div class="branches" data-reveal-group>${data.order.map((id) => branchCard(data.branches[id], opts)).join('\n')}</div>`;
}

function footerBranchesHtml() {
  const data = branchData();
  return data.order.map((id) => {
    const b = data.branches[id];
    const lines = [
      b.address ? `<li>${esc(b.address)}</li>` : '<li class="muted-on-stone">Хаяг удахгүй нэмэгдэнэ</li>',
      ...(b.phones || []).map((p) => `<li>${phoneLink(p)}</li>`),
      safeUrl(b.messenger) ? `<li><a href="${esc(b.messenger)}" target="_blank" rel="noopener noreferrer">Messenger</a></li>` : '',
      safeUrl(b.facebook) ? `<li><a href="${esc(b.facebook)}" target="_blank" rel="noopener noreferrer">Facebook</a></li>` : '',
    ];
    return `<div><h2>${esc(b.name)}</h2><ul>${lines.join('')}</ul></div>`;
  }).join('\n      ');
}

// Changes with every deployment on Vercel, so browsers never keep a stale
// stylesheet or script next to a new page.
const ASSET_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 8);

/**
 * One photo tile. Files are 4:5 crops at the widths listed (never larger
 * than the source), so the browser picks the smallest sharp one; the
 * lightbox opens the largest.
 */
function photoTile(item, sizes) {
  const ws = item.widths;
  const src = (w) => `/img/photos/${esc(item.slug)}-${w}.webp`;
  const small = ws[0];
  return `<button type="button" data-cat="${esc(item.cat)}"><img src="${src(small)}" srcset="${ws.map((w) => `${src(w)} ${w}w`).join(', ')}" sizes="${sizes}" width="${small}" height="${Math.round(small * 1.25)}" loading="lazy" decoding="async" data-full="${src(ws[ws.length - 1])}" alt="${esc(item.alt)}" /></button>`;
}

function galleryHtml({ home }) {
  const g = require('../data/gallery.json');
  if (home) {
    const bySlug = new Map(g.items.map((i) => [i.slug, i]));
    const tiles = g.home.map((slug) => bySlug.get(slug)).filter(Boolean)
      .map((i) => photoTile(i, '(max-width: 960px) 33vw, 16vw'));
    return `<div class="gallery-grid gallery-grid--home" data-gallery data-reveal>${tiles.join('')}</div>`;
  }
  const chips = [['all', 'Бүгд'], ...g.categories.map((c) => [c.id, c.label])]
    .map(([id, label], i) => `<button class="chip" type="button" data-filter="${esc(id)}" aria-pressed="${i === 0}">${esc(label)}</button>`);
  const tiles = g.items.map((i) => photoTile(i, '(max-width: 720px) 50vw, (max-width: 1240px) 25vw, 300px'));
  return `<div class="filter-row" role="group" aria-label="Шүүлтүүр">${chips.join('')}</div>
          <div class="gallery-grid" data-gallery>${tiles.join('\n')}</div>`;
}

/**
 * A feature photo for one place on the site, chosen in data/imagery.json so
 * the owner's own photos can replace these without touching a page. With no
 * photo set nothing is drawn: the section keeps its limewash texture and
 * light, never a stand-in picture of someone else's salon.
 */
function imageSlotHtml(name, { sizes = '(max-width: 760px) 92vw, 40vw', eager = false } = {}) {
  const slot = (require('../data/imagery.json').slots || {})[name];
  const item = slot && slot.photo ? require('../data/gallery.json').items.find((i) => i.slug === slot.photo) : null;
  if (!item) return ''; // the section's own plaster and light carry it until a photo arrives
  const ws = item.widths;
  const src = (w) => `/img/photos/${esc(item.slug)}-${w}.webp`;
  const mid = ws.includes(800) ? 800 : ws[ws.length - 1];
  return `<figure class="feature feature--photo" data-slot="${esc(name)}"><img src="${src(mid)}" srcset="${ws.map((w) => `${src(w)} ${w}w`).join(', ')}" sizes="${sizes}" width="${mid}" height="${Math.round(mid * 1.25)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" alt="${esc(slot.alt || item.alt)}" /></figure>`;
}

const mnt = new Intl.NumberFormat('en-US');

/** A single price as the menu shows it; null is a price the salon has not set yet. */
function priceHtml(price) {
  if (typeof price === 'number' && price > 0) return `<span class="amount">${mnt.format(price)}₮</span>`;
  return '<span class="amount pending">Үнэ удахгүй</span>';
}

/** Short / medium / long prices, each labelled, for a service priced by hair length. */
function lengthPricesHtml(prices) {
  return `<span class="amount-tiers">${prices.map((p) => `<span class="tier"><span class="tier-label">${esc(p.length)}</span>${priceHtml(p.price)}</span>`).join('')}</span>`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'svc';

/**
 * A service with a description (TARA LUMI): its name is a button that shows
 * and hides the description. Without JavaScript the description simply stays
 * open; assets/site.js closes it on load and animates each toggle.
 */
function serviceNameHtml(s) {
  if (!s.details) return `<span class="svc">${esc(s.name)}</span>`;
  const id = `about-${slug(s.name)}`;
  return `<button type="button" class="svc svc-toggle" aria-expanded="true" aria-controls="${id}" data-disclosure>${esc(s.name)}<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

function serviceDetailsHtml(s) {
  const d = s.details;
  if (!d) return '';
  return `<div class="svc-details" id="about-${slug(s.name)}"><div class="svc-details-inner"><div class="svc-details-body">
            <p class="svc-details-title">${esc(d.title)}</p>
            <ul>${d.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            ${d.footnote ? `<p class="svc-note">${esc(d.footnote)}</p>` : ''}
          </div></div></div>`;
}

function priceRowHtml(s) {
  const tiered = Array.isArray(s.prices);
  return `<li${tiered ? ' class="is-tiered"' : ''}>${serviceNameHtml(s)}${tiered ? lengthPricesHtml(s.prices) : priceHtml(s.price)}${s.note ? `<span class="svc-note">${esc(s.note)}</span>` : ''}${serviceDetailsHtml(s)}</li>`;
}

function serviceMenu() {
  return require('../data/services.json');
}

function priceListHtml() {
  return serviceMenu().categories.map((c) => `<section class="price-cat" id="${esc(c.id)}" aria-labelledby="cat-${esc(c.id)}">
        <div>
          <h2 id="cat-${esc(c.id)}">${esc(c.name)}</h2>
          ${c.note ? `<p class="cat-note">${esc(c.note)}</p>` : ''}
        </div>
        <ul class="price-rows">
          ${c.services.map(priceRowHtml).join('\n          ')}
        </ul>
      </section>`).join('\n      ');
}

function priceNavHtml() {
  return serviceMenu().categories.map((c) => `<a class="chip" href="#${esc(c.id)}">${esc(c.name)}</a>`).join('\n          ');
}

/** Lowest price in a category: what the home page's «…₮-өөс» shows. */
function lowestPrice(c) {
  const all = c.services.flatMap((s) => (Array.isArray(s.prices) ? s.prices.map((p) => p.price) : [s.price]))
    .filter((n) => typeof n === 'number' && n > 0);
  return all.length ? Math.min(...all) : null;
}

/** The home page's category cards: name, a few services, and the starting price. */
function serviceCardsHtml() {
  return serviceMenu().categories.map((c) => {
    const from = lowestPrice(c);
    return `<li><a href="/services.html#${esc(c.id)}"><h3>${esc(c.name)}</h3><p>${esc(c.summary)}.</p><span class="price-from">${from ? `${mnt.format(from)}₮-өөс` : 'Үнэ удахгүй'}</span></a></li>`;
  }).join('\n            ');
}

/**
 * The finished HTML for a page, or null for a name that is not a page.
 * @param {string} page     e.g. 'index'
 * @param {{ origin?: string }} [opts]  public origin, e.g. https://www.example.mn
 */
function renderPage(page, { origin = '' } = {}) {
  if (!PAGES.includes(page)) return null;
  if (!fs.existsSync(path.join(ROOT, `${page}.html`))) return null;
  // Replacements are functions throughout, so "$&"-style sequences in any
  // inserted text are never read as replacement patterns.
  let html = readFile(`${page}.html`).replace('<!-- @head -->', () => readFile('partials/head.html'));
  const header = readFile('partials/header.html')
    .replace(new RegExp(`(<a [^>]*data-nav="${page}")`, 'g'), '$1 aria-current="page"');
  const footer = readFile('partials/footer.html').replace('{{footer-branches}}', () => footerBranchesHtml());
  html = html
    .replace('<!-- @header -->', () => header)
    .replace('<!-- @footer -->', () => footer)
    .replace('<!-- @branches:compact -->', () => branchesHtml({ withMap: false }))
    .replace('<!-- @branches -->', () => branchesHtml({ withMap: true }))
    .replace('<!-- @price-list -->', () => priceListHtml())
    .replace('<!-- @price-nav -->', () => priceNavHtml())
    .replace('<!-- @service-cards -->', () => serviceCardsHtml())
    .replace('<!-- @gallery:home -->', () => galleryHtml({ home: true }))
    .replace('<!-- @gallery -->', () => galleryHtml({ home: false }))
    .replace(/<!-- @image:([a-z-]+)(?: (eager))? -->/g, (_, name, eager) => imageSlotHtml(name, { eager: !!eager }));
  const safeOrigin = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : '';
  return html.replace(/\{\{origin\}\}/g, () => safeOrigin).replace(/\{\{v\}\}/g, () => ASSET_VERSION);
}

module.exports = { PAGES, renderPage, phoneLink };
