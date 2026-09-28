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
  return `<div class="branches">${data.order.map((id) => branchCard(data.branches[id], opts)).join('\n')}</div>`;
}

function footerBranchesHtml() {
  const data = branchData();
  return data.order.map((id) => {
    const b = data.branches[id];
    const lines = [
      b.address ? `<li>${esc(b.address)}</li>` : '<li class="muted-on-teal">Хаяг удахгүй нэмэгдэнэ</li>',
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

const mnt = new Intl.NumberFormat('en-US');

/** A price as the menu shows it; null is a price the salon has not set yet. */
function priceHtml(price) {
  if (typeof price === 'number' && price > 0) return `<span class="amount">${mnt.format(price)}₮</span>`;
  if (price && typeof price.from === 'number') return `<span class="amount">${mnt.format(price.from)}₮-өөс</span>`;
  return '<span class="amount pending">Үнэ удахгүй</span>';
}

function priceListHtml() {
  const menu = require('../data/services.json');
  return menu.categories.map((c) => `<section class="price-cat" id="${esc(c.id)}" aria-labelledby="cat-${esc(c.id)}">
        <div>
          <h2 id="cat-${esc(c.id)}">${esc(c.name)}</h2>
          ${c.note ? `<p class="cat-note">${esc(c.note)}</p>` : ''}
        </div>
        <ul class="price-rows">
          ${c.services.map((s) => `<li><span class="svc">${esc(s.name)}</span>${priceHtml(s.price)}${s.note ? `<span class="svc-note">${esc(s.note)}</span>` : ''}</li>`).join('\n          ')}
        </ul>
      </section>`).join('\n      ');
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
    .replace('<!-- @price-list -->', () => priceListHtml());
  const safeOrigin = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : '';
  return html.replace(/\{\{origin\}\}/g, () => safeOrigin).replace(/\{\{v\}\}/g, () => ASSET_VERSION);
}

module.exports = { PAGES, renderPage, phoneLink };
