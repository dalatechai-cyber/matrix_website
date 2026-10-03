'use strict';

/**
 * Customer-facing facts the salon gave us, locked down.
 *
 * The price list and the contact block are the two places where a wrong string
 * costs the salon money directly: a customer who dials a dead number does not
 * call back, and a price shown as a range is a price the salon has to argue
 * about in the chair. Both are plain data files / markup with no runtime behind
 * them, so nothing else in the suite would notice them regressing.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const menu = require('../data/services.json');

/** Every service in the price list, with the id of its category. */
function allServices() {
  return menu.categories.flatMap((c) => c.services.map((s) => ({ ...s, category: c.id })));
}

/** Every bookable choice: a single-priced service, or one length of a tiered one. */
function allChoices() {
  return allServices().flatMap((s) => (Array.isArray(s.prices)
    ? s.prices.map((p) => ({ name: s.name, key: p.key, price: p.price, length: p.length, category: s.category }))
    : [{ name: s.name, key: s.key, price: s.price, category: s.category }]));
}

// ---------------------------------------------------------------------------
// Contact numbers
// ---------------------------------------------------------------------------

const LOGO_PNG_SHA = 'af7b2d3e32697b50';
const LOGO_WEBP_SHA = '741a3955a919349f';
const PAGES = ['index.html', 'services.html', 'products.html', 'keune-products.html', 'booking.html', 'contact.html'];
const { renderPage } = require('../lib/pages');
/** A page as visitors get it: shared header, footer and branch details included. */
const rendered = (file) => renderPage(file.replace(/\.html$/, '')) || '';
const RETIRED_NUMBER = /7741[^0-9]{0,2}7777/;
const CURRENT_NUMBERS = ['76001888', '91005498'];
const RETIRED_YAARMAG_NUMBER = /8090[^0-9]{0,2}5498/;

test('contact: the retired booking number appears on no page', () => {
  for (const page of PAGES) {
    const html = rendered(page);
    assert.ok(html.length > 0, `${page} did not render`);
    assert.ok(!RETIRED_NUMBER.test(html), `${page} still shows the retired number`);
    // Digits only, so a number split by markup or an entity cannot hide.
    assert.ok(!RETIRED_NUMBER.test(html.replace(/[^0-9]/g, '')), `${page} hides the retired number between other characters`);
    // 91005498 replaced Яармаг's 80905498 everywhere (1 October 2026).
    assert.ok(!RETIRED_YAARMAG_NUMBER.test(html) && !RETIRED_YAARMAG_NUMBER.test(html.replace(/[^0-9]/g, '')),
      `${page} still shows 80905498`);
  }
});

test('contact: both current numbers are shown, and both are dialable', () => {
  const html = rendered('index.html');
  for (const number of CURRENT_NUMBERS) {
    // Displayed (the site groups as "+976 7600 1888") and tappable on a phone.
    assert.ok(html.includes(`+976 ${number.slice(0, 4)} ${number.slice(4)}`), `${number} is not displayed`);
    assert.ok(html.includes(`tel:+976${number}`), `${number} is not a tel: link`);
  }
});

// ---------------------------------------------------------------------------
// The price list of 1 October 2026 (the salon's own list is the source of truth)
// ---------------------------------------------------------------------------

/** [category, name, price | [short, medium, long]] — exactly as on the salon's list. */
const PRICE_LIST = [
  ['women', 'Тайралт том хүн /SPECIAL/', 120000], ['women', 'Тайралт том хүн /МАСТЕР/', 99000],
  ['women', 'Тайралт том хүн /1-р зэрэг/', 66000], ['women', 'Тайралт хүүхэд', 44000], ['women', 'Тайралт /чёлк/', 22000],
  ['women', 'Хэлбэржүүлэлт /өдөр тутмын/', 44000], ['women', 'Хэлбэржүүлэлт /гоёлын/', 60000],
  ['women', 'Гоёлын засалт /бүтэн/', 99000], ['women', 'Гоёлын засалт /хагас/', 75000], ['women', 'Хуримын засалт', 180000],
  ['women', 'Гоёлын засалт /эрэгтэй/', 33000],
  ['men', 'Тайралт том хүн /SPECIAL/', 89000], ['men', 'Тайралт том хүн', 69000], ['men', 'Тайралт хүүхэд /14–18 нас/', 44000],
  ['men', 'Тайралт хүүхэд /0–13 нас/', 33000], ['men', 'Бүтэн будалт', 88000], ['men', 'Эмчилгээний хими', 189000],
  ['men', 'Down perm', 125000], ['men', 'Бүтэн цайруулалт', 450000], ['men', 'Хэсэгчилсэн сор', 195000],
  ['men', 'Хуйхны цэвэрлэгээ', 33000], ['men', 'Нөхөн сэргээх эмчилгээ', 66000],
  ['care', 'Хуйх цэвэрлэгээ', 33000], ['care', 'Үс оношлогоо, зөвлөгөө', 33000], ['care', 'Нөхөн сэргээх эмчилгээ', 66000],
  ['care', 'Үсний тэжээл', 88000], ['care', 'Үсний спа', 154000], ['care', 'CICA үсний гүний эмчилгээ', 198000],
  ['care', 'Эмчилгээний будаг', 88000],
  ['perm', 'Tara perm', [220000, 250000, 290000]], ['perm', 'Усан хими', [120000, 160000, 200000]],
  ['perm', 'Afro хими', [450000, 500000, 550000]], ['perm', 'Hippie & Jerry curl', [450000, 500000, 550000]],
  ['perm', 'Сэттинг хими', [450000, 500000, 550000]], ['perm', 'Шулуун хими', [450000, 500000, 550000]],
  ['color', 'Энгийн будаг', [160000, 180000, 210000]], ['color', 'Өнгөлөгч будаг', [160000, 180000, 210000]],
  ['color', 'TARA LUMI', [350000, 460000, 510000]], ['color', 'TARA BLEND', [550000, 630000, 720000]],
  ['color', 'Хэсэгчилсэн сор', 150000], ['color', 'Бүтэн сор', 210000], ['color', 'Уг будаг', 99000],
];

test('price list: every service and price matches the salon\'s list, in order, nothing extra', () => {
  const actual = allServices().map((s) => [s.category, s.name, Array.isArray(s.prices) ? s.prices.map((p) => p.price) : s.price]);
  assert.deepEqual(actual, PRICE_LIST);
  for (const c of menu.categories.filter((x) => x.lengths)) {
    assert.deepEqual(c.lengths, ['Богино', 'Дунд', 'Урт']);
    for (const s of c.services.filter((x) => x.prices)) assert.deepEqual(s.prices.map((p) => p.length), c.lengths, s.name);
  }
});

test('price list: TARA LUMI uses the list (350,000 / 460,000 / 510,000) and carries its description', () => {
  const lumi = allServices().find((s) => s.name === 'TARA LUMI');
  assert.deepEqual(lumi.prices.map((p) => p.price), [350000, 460000, 510000]);
  assert.equal(lumi.details.title, 'TARA Lumi – үүсгэлттэй будалт');
  assert.equal(lumi.details.points.length, 6);
  const html = rendered('services.html');
  assert.ok(html.includes('TARA Lumi – үүсгэлттэй будалт') && html.includes('Үндэс ургах үед огцом ялгарахгүй, арчилгаа хялбар'));
  for (const page of PAGES) assert.ok(!/380[,. ]?000/.test(rendered(page)), `${page} quotes the owner's 380,000`);
});

test('price list: every price is on the price page and in the booking menu, and nothing is pending', () => {
  const html = rendered('services.html');
  assert.ok(!html.includes('Үнэ удахгүй') && !html.includes('үнийн жагсаалт удахгүй'));
  const fmt = new Intl.NumberFormat('en-US');
  for (const c of allChoices()) {
    assert.ok(typeof c.price === 'number' && c.price > 0, c.key);
    assert.ok(html.includes(`${fmt.format(c.price)}₮`), `${c.name} ${c.price} is not on the price page`);
  }
  assert.ok(!rendered('index.html').includes('Үнэ удахгүй'), 'home page still says prices are coming');
});

test('price list: every choice has a unique, comma-free booking key that resolves to a length', () => {
  const { durationForService, normalizeServiceName } = require('../config/serviceDurations');
  const keys = allChoices().map((c) => c.key);
  assert.equal(new Set(keys.map(normalizeServiceName)).size, keys.length, 'two choices share a booking key');
  for (const k of keys) {
    assert.ok(!k.includes(','), `${k}: services travel as a comma-separated list`);
    assert.ok(durationForService(k) > 0, `${k} has no duration`);
  }
});

test('children: both children\'s haircuts are listed and bookable, and no page refuses children', () => {
  for (const name of ['Тайралт хүүхэд /0–13 нас/', 'Тайралт хүүхэд /14–18 нас/', 'Тайралт хүүхэд']) {
    const c = allChoices().find((x) => x.name === name);
    assert.ok(c, `${name} is missing`);
    assert.ok(require('../config/serviceDurations').durationForService(c.key) > 0);
  }
  for (const page of PAGES) {
    assert.ok(!/хүүхэд[^.]{0,40}(үйлчлэхгүй|үйлчилдэггүй|авахгүй)|насанд хүрэгчдэд зориулсан/i.test(rendered(page)), page);
  }
});

test('facebook: each branch links its own Page on its card and in the footer', () => {
  const pages = { yaarmag: 'https://www.facebook.com/profile.php?id=100067872726164', parkod: 'https://www.facebook.com/profile.php?id=100067391025472' };
  const html = rendered('contact.html');
  for (const [id, url] of Object.entries(pages)) {
    const start = html.indexOf(`id="branch-${id}"`);
    const card = html.slice(start, html.indexOf('</article>', start));
    assert.ok(card.includes(`href="${url}"`), `${id} card has no Facebook link`);
    const other = Object.entries(pages).find(([k]) => k !== id)[1];
    assert.ok(!card.includes(other), `${id} card links the other branch's Page`);
  }
  const footer = html.slice(html.indexOf('<footer'));
  for (const url of Object.values(pages)) assert.ok(footer.includes(`href="${url}"`), `footer misses ${url}`);
});

test('price list: services from before the October 2026 list still resolve to a booking duration', () => {
  const { durationForService } = require('../config/serviceDurations');
  for (const name of ['Эмчилгээний хими', 'Оффис колор', 'Сор', 'Үндэс', 'Будаг']) {
    assert.ok(durationForService(name) > 0, `${name} has no duration — booking would guess`);
  }
  // Retired labels stay resolvable because names still arrive under them: a
  // browser holding a cached script.js posts the old checkbox value.
  for (const [retired, minutes] of [['Хими / Sika', 120], ['Оффис колор/Сор', 240], ['Будаг/угны', 90],
                                    ['Будаг/бүтэн', 120], ['Будаг (Уг)', 90], ['Будаг (Бүтэн)', 120]]) {
    assert.equal(durationForService(retired), minutes, `retired label ${retired} stopped resolving`);
  }
});

// ---------------------------------------------------------------------------
// Manicure is no longer offered
// ---------------------------------------------------------------------------
// «Г. Мөнхзаяа» is the former manicurist. A customer review on index.html is
// signed by someone else who shares the given name, so the bare name is not banned.
const MANICURE_WORDS = /маникюр|педикюр|хумс|гелэн|г\. мөнхзаяа|munkhzaya/i;

test('manicure: no page, price or bookable service mentions it', () => {
  for (const page of PAGES) {
    const html = rendered(page);
    assert.ok(!MANICURE_WORDS.test(html), `${page} still mentions manicure`);
  }
  for (const s of allServices()) assert.ok(!MANICURE_WORDS.test(s.name), `price list still has ${s.name}`);
  for (const c of menu.categories) assert.ok(!MANICURE_WORDS.test(c.name), c.name);
  const durations = require('../data/serviceDurations.json');
  for (const s of durations.services) assert.ok(!MANICURE_WORDS.test(s.name), `durations still has ${s.name}`);
  for (const file of ['assets/booking.js', 'assets/site.js', 'data/services.json']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!MANICURE_WORDS.test(text), `${file} still mentions manicure`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'hairstylist_pic/munkhzaya.jpeg')), 'manicurist photo is still served');
});

// ---------------------------------------------------------------------------
// Customer gender and the non-refundable deposit (owner-approved wording)
// ---------------------------------------------------------------------------
const GENDER_NOTE = 'Эмэгтэй үйлчлүүлэгчид эмэгтэй үсчин, эрэгтэй үйлчлүүлэгчид эрэгтэй үсчин үйлчилнэ.';
const DEPOSIT_TERMS = 'Урьдчилгаа төлбөр нь цагаа цуцалсан эсвэл ирээгүй тохиолдолд буцаан олгогдохгүй гэдгийг ойлгож, зөвшөөрч байна.';

test('booking: the gender step and note use the approved wording', () => {
  const html = rendered('booking.html');
  assert.ok(html.includes('<legend>Үйлчлүүлэгч:</legend>'));
  assert.ok(html.includes('value="female"') && html.includes('<span>Эмэгтэй</span>'));
  assert.ok(html.includes('value="male"') && html.includes('<span>Эрэгтэй</span>'));
  assert.ok(html.includes(GENDER_NOTE));
  // No hairdresser is in the markup: the page lists only matching ones, from
  // the server's own list (/api/branches), so there is no copy to drift.
  assert.ok(!/name="stylist"/.test(html));
  const script = fs.readFileSync(path.join(ROOT, 'assets/booking.js'), 'utf8');
  assert.ok(!/Оюунсүрэн|Бадамцэцэг|Ананд/.test(script), 'booking.js must not carry its own list of hairdressers');
  assert.ok(script.includes('.filter((s) => s.gender === state.gender)'), 'only hairdressers matching the customer are listed');
});

test('booking: the deposit box and the recorded agreement use the approved wording', () => {
  assert.ok(rendered('booking.html').includes(DEPOSIT_TERMS));
  assert.equal(require('../services/bookingRules').DEPOSIT_TERMS_TEXT, DEPOSIT_TERMS);
});

test('booking: the QR expiry wording is the approved text', () => {
  const html = rendered('booking.html');
  const script = fs.readFileSync(path.join(ROOT, 'assets/booking.js'), 'utf8');
  assert.ok(html.includes('QR кодын хугацаа дууслаа. Шинэ QR код авах бол доорх товчийг дарна уу.'));
  assert.ok(html.includes('>Шинэ QR код авах</button>'));
  assert.ok(script.includes('`QR код ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} хүчинтэй`'));
  assert.ok(script.includes('Уучлаарай, энэ цаг өөр хүнд захиалагдсан байна. Өөр цаг сонгоно уу.'));
});

// ---------------------------------------------------------------------------
// Tara Salon rebuild
// ---------------------------------------------------------------------------

test('menu: every bookable duration is on the price list, apart from retired entries', () => {
  const catalogue = require('../data/serviceDurations.json');
  const keys = allChoices().map((c) => c.key);
  for (const s of catalogue.services.filter((x) => !x.retired)) {
    assert.ok(keys.includes(s.name), `bookable ${s.name} is missing from the menu`);
  }
  for (const k of keys) {
    const entry = catalogue.services.find((x) => x.name === k);
    assert.ok(entry && !entry.retired, `${k} must be a current entry in data/serviceDurations.json`);
  }
});

test('brand: every page shows the Tara Salon logo and no old Matrix branding', () => {
  for (const page of PAGES) {
    const html = rendered(page);
    assert.ok(html.includes('/brand/tara-salon-logo-240.png'), `${page} header logo`);
    assert.ok(html.includes('class="footer-logo" src="/brand/tara-salon-logo-480.png"'), `${page} footer logo`);
    assert.ok(!html.includes('tara-salon-logo.svg') && !html.includes('logo-light'), `${page} uses the retired teal logo`);
    assert.ok(!/matrix/i.test(html.replace(/Matrix Eco:/g, '')), `${page} still says Matrix`);
    assert.ok(!html.includes('logo.png') && !html.includes('favicon.jpg'), `${page} uses an old logo file`);
    assert.ok(html.includes('og:image') && html.includes('/brand/og-image.jpg'), `${page} social preview`);
  }
});

test('brand: the logo files are the ones supplied, untouched', () => {
  const crypto = require('node:crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 16);
  // The metallic logo the owner supplied (September 2026), byte for byte. The
  // -240/-480 files beside them are scaled copies for the page.
  assert.equal(sha('brand/tara-salon-logo.png'), LOGO_PNG_SHA);
  assert.equal(sha('brand/tara-salon-logo-2000.webp'), LOGO_WEBP_SHA);
});

test('branches: Парк Од shows the shared line and placeholders, never Яармаг\'s own details', () => {
  const html = rendered('contact.html');
  const park = html.slice(html.indexOf('id="branch-parkod"'), html.indexOf('</article>', html.indexOf('id="branch-parkod"')));
  assert.ok(park.includes('10:00 – 20:00') && park.includes('11:00 – 19:00'), 'Парк Од hours (Mon–Sat 10–20, Sun 11–19)');
  assert.ok(park.includes('Баянзүрх дүүрэг, 26-р хороо, Парк-Од молл, 4 давхар, 405 тоот'), 'Парк Од address');
  const footer = html.slice(html.indexOf('<footer'));
  assert.ok(footer.includes('Парк-Од молл, 4 давхар, 405 тоот') && !footer.includes('Хаяг удахгүй нэмэгдэнэ'), 'footer address');
  // 76001888 is the shared main line of both branches; 91005498 is Яармаг's own.
  assert.ok(park.includes('tel:+97676001888'), 'Парк Од must show the shared main line');
  assert.ok(!park.includes('9100') && !park.includes('8090') && !park.includes('Номин'), 'Яармаг details on Парк Од');
  assert.ok(!park.includes('/booking.html?branch=parkod'), 'no booking button before Парк Од is connected');
});

test('photos: every feature photo exists at every listed width; the «Бүтээл» gallery and its photos are gone', () => {
  const g = require('../data/gallery.json');
  for (const item of g.items) {
    assert.ok(item.alt && item.alt.length > 5, `${item.slug} needs a description`);
    for (const w of item.widths) {
      assert.ok(fs.existsSync(path.join(ROOT, `img/photos/${item.slug}-${w}.webp`)), `${item.slug}-${w}.webp missing`);
      assert.ok(w <= 1200, 'no file wider than 1200 px');
    }
  }
  // Only listed photos ship: nothing left over from the removed gallery.
  // hero-mauve is the home hero (index.html), not a catalogue entry.
  const listed = new Set([...g.items.map((i) => i.slug), 'hero-mauve']);
  for (const f of fs.readdirSync(path.join(ROOT, 'img/photos'))) {
    assert.ok(listed.has(f.replace(/-\d+\.webp$/, '')), `${f} is not a listed photo`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'photos-inbox')), 'photos-inbox must not be in the site');
  assert.ok(!fs.existsSync(path.join(ROOT, 'zurag.html')), 'the gallery page is removed');
  for (const page of PAGES) {
    const html = rendered(page);
    assert.ok(!html.includes('zurag.html') && !html.includes('data-gallery'), `${page} still links the gallery`);
    assert.ok(!/Pictures_Page|img\/gallery\//.test(html), 'old low-resolution gallery still referenced');
  }
});

test('footer: the maker\'s credit is DalaTech\'s wordmark only, labelled, with tracked link', () => {
  for (const page of PAGES) {
    const html = rendered(page);
    assert.ok(!html.includes('Гүйцэтгэсэн'), `${page} still has the text credit`);
    const a = html.match(/<a class="footer-credit"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(a, `${page} has no footer credit`);
    assert.ok(a[0].includes('href="https://dalatech.online/?utm_source=tara-salon&amp;utm_medium=footer&amp;utm_campaign=credit"'));
    assert.ok(a[0].includes('target="_blank"') && a[0].includes('rel="noopener"') && a[0].includes('aria-label="DalaTech"'));
    assert.ok(a[0].includes('src="/brand/dalatech-wordmark.svg"') && a[0].includes('alt=""'));
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'brand/dalatech-wordmark.svg')));
});

test('imagery: every feature photo is one of the salon\'s own vetted photos, and is drawn', () => {
  const g = require('../data/gallery.json');
  const { slots } = require('../data/imagery.json');
  const pages = PAGES.map(rendered).join('\n');
  for (const [name, slot] of Object.entries(slots)) {
    if (slot.photo === null) continue;
    const item = g.items.find((i) => i.slug === slot.photo);
    assert.ok(item, `${name}: ${slot.photo} is not in data/gallery.json`);
    assert.ok(pages.includes(`data-slot="${name}"`), `${name} is set but no page shows it`);
  }
  assert.ok(!/<!-- @image:/.test(pages), 'an image marker was left unrendered');
});

test('TARA LUMI: the name toggles its description, which is in the page without JavaScript', () => {
  const html = rendered('services.html');
  const btn = html.match(/<button type="button" class="svc svc-toggle" aria-expanded="true" aria-controls="([^"]+)" data-disclosure>TARA LUMI/);
  assert.ok(btn, 'TARA LUMI is not a disclosure button');
  assert.ok(html.includes(`<div class="svc-details" id="${btn[1]}">`), 'the button does not control the description');
  const script = fs.readFileSync(path.join(ROOT, 'assets/site.js'), 'utf8');
  assert.ok(script.includes('[data-disclosure]') && script.includes('panel.hidden = true'));
});

test('team: «Манай үсчид» shows every current hairdresser of both branches with photo, short name, title and branch', () => {
  const html = rendered('index.html');
  const team = html.slice(html.indexOf('id="team"'), html.indexOf('</section>', html.indexOf('id="team"')));
  const yaarmag = ['Oyunaa', 'Badamaa', 'Anand', 'Uyanga', 'Zaya', 'Chimgee'];
  const parkod = ['Boloroo', 'Saraa', 'Tomoo', 'Bulgaa', 'Enhuush', 'Chimegee', 'Tuchku'];
  const names = [...team.matchAll(/<h4 class="team-name">([^<]+)<\/h4>/g)].map((m) => m[1]);
  assert.deepEqual(names, [...yaarmag, ...parkod]);
  for (const old of ['Оюунсүрэн', 'Бадамцэцэг', 'Батзаяа', 'Уранчимэг', 'Отгонжаргал', 'Otgonjargal', 'hair salonner', 'стилист']) {
    assert.ok(!team.includes(old), `team section still says ${old}`);
  }
  assert.ok(team.includes('SPECIAL Hair Stylist') && team.includes('Master Hair Stylist'));
  for (const m of team.matchAll(/src="(\/img\/stylists\/[^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${m[1]} missing`);
  }
  for (const m of team.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of m[1].split(',')) assert.ok(fs.existsSync(path.join(ROOT, part.trim().split(' ')[0])), part);
  }
  assert.equal((team.match(/class="team-branch">Парк Од салбар</g) || []).length, 7);
});

test('photos: no 4K originals ship from the site root', () => {
  for (const f of ['Boloroo.jpg', 'Saraa.jpg', 'Tomoo.jpg', 'Bulgaa.jpg', 'Enhuush.jpg', 'Chimegee.jpg', 'Tuchku.jpg']) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} is still at the root`);
  }
});
