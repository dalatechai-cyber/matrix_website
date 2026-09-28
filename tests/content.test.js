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
const pricing = require('../data/pricing.json');

/** Every service in the price list, flattened across categories/subcategories. */
function allServices() {
  const out = [];
  for (const category of Object.values(pricing)) {
    for (const sub of category.subcategories || []) out.push(...(sub.services || []));
    out.push(...(category.services || []));
  }
  return out;
}

function serviceNamed(name) {
  return allServices().find((s) => s.name === name);
}

// ---------------------------------------------------------------------------
// Contact numbers
// ---------------------------------------------------------------------------

const PAGES = ['index.html', 'services.html', 'zurag.html', 'products.html', 'keune-products.html', 'booking.html', 'contact.html'];
const { renderPage } = require('../lib/pages');
/** A page as visitors get it: shared header, footer and branch details included. */
const rendered = (file) => renderPage(file.replace(/\.html$/, '')) || '';
const RETIRED_NUMBER = /7741[^0-9]{0,2}7777/;
const CURRENT_NUMBERS = ['76001888', '80905498'];

test('contact: the retired booking number appears on no page', () => {
  for (const page of PAGES) {
    const html = rendered(page);
    assert.ok(html.length > 0, `${page} did not render`);
    assert.ok(!RETIRED_NUMBER.test(html), `${page} still shows the retired number`);
    // Digits only, so a number split by markup or an entity cannot hide.
    assert.ok(!RETIRED_NUMBER.test(html.replace(/[^0-9]/g, '')), `${page} hides the retired number between other characters`);
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
// The three price-list corrections
// ---------------------------------------------------------------------------

test('price list: every entry carries exactly one way of stating its price', () => {
  for (const service of allServices()) {
    assert.ok(service.name, 'a service has no name');
    const hasSingle = service.price !== undefined;
    const hasRange = service.min !== undefined && service.max !== undefined;
    const hasVariants = Array.isArray(service.variants) && service.variants.length > 0;
    assert.equal(
      [hasSingle, hasRange, hasVariants].filter(Boolean).length,
      1,
      `${service.name} must state a price, a range, or variants — exactly one`,
    );
    if (hasRange) assert.ok(service.max > service.min, `${service.name}: max must exceed min`);
    for (const variant of service.variants || []) {
      assert.ok(variant.type, `${service.name} has a variant with no label`);
      assert.ok(variant.price !== undefined || (variant.min !== undefined && variant.max !== undefined),
        `${service.name} / ${variant.type} has no price`);
    }
  }
});

test('price list: no service conflates CICA with the treatment perm', () => {
  // «CICA эмчилгээний хими» does not exist. The two real treatments are
  // «Эмчилгээний хими» and «CICA нөхөн сэргээх эмчилгээ».
  for (const service of allServices()) {
    const name = service.name.toLowerCase();
    assert.ok(!(name.includes('cica') && name.includes('хими')),
      `"${service.name}" reads as a CICA perm, which the salon does not offer`);
  }
  assert.ok(serviceNamed('Эмчилгээний хими'), 'Эмчилгээний хими is missing from the price list');
});

test('price list: the CICA treatment is priced per session and per course, not as a range', () => {
  const cica = serviceNamed('CICA нөхөн сэргээх эмчилгээ');
  assert.ok(cica, 'CICA нөхөн сэргээх эмчилгээ is missing from the price list');
  assert.equal(cica.min, undefined, 'the CICA treatment must not be shown as a range');
  assert.equal(cica.max, undefined, 'the CICA treatment must not be shown as a range');
  assert.deepEqual(cica.variants.map((v) => v.price), [198000, 154000], 'one session 198k, course 154k');
});

test('price list: roots is its own service, separate from dye by length', () => {
  // «Үг» and «Үндэс» name the same thing. The salon sells roots on its own at
  // 135,000₮ AND sells a full dye priced by length whose shortest tier happens to
  // cost the same — two services, one shared figure. Collapsing them loses the
  // roots price, which is what happened the first time round.
  const roots = serviceNamed('Үндэс');
  assert.ok(roots, 'Үндэс is missing from the price list');
  assert.equal(roots.price, 135000);
  assert.equal(roots.variants, undefined, 'roots is a single price, not a tiered service');
  assert.ok(roots.note, 'the card must say the price covers roots only');
});

test('price list: dye is priced by hair length, not as a range', () => {
  const dye = serviceNamed('Будаг');
  assert.ok(dye, 'Будаг is missing from the price list');
  assert.equal(dye.min, undefined, 'dye must not be shown as a range');
  assert.equal(dye.max, undefined, 'dye must not be shown as a range');
  assert.deepEqual(dye.variants.map((v) => v.price), [135000, 176000, 200000],
    'neck-length 135k, above the shoulder 176k, below the shoulder 200k');
  assert.ok(dye.variantsNote, 'the card must say the prices go by length');
  // The range the salon corrected must not come back under any name.
  for (const service of allServices()) {
    assert.ok(!(service.min === 176000 && service.max === 200000),
      `"${service.name}" still quotes dye as a 176,000–200,000 range`);
  }
});

test('price list: Сор and Оффис колор are separate services', () => {
  const sor = serviceNamed('Сор');
  const office = serviceNamed('Оффис колор');
  assert.ok(sor, 'Сор is missing from the price list');
  assert.ok(office, 'Оффис колор is missing from the price list');
  assert.equal(sor.min, 120000);
  assert.equal(sor.max, 190000);
  assert.equal(office.min, 380000);
  assert.equal(office.max, 460000);
  assert.ok(office.note, 'Оффис колор must say what it is (three dyes combined)');
  for (const service of allServices()) {
    const name = service.name.toLowerCase();
    assert.ok(!(name.includes('оффис') && name.includes('сор')),
      `"${service.name}" runs the two services together under one label`);
  }
});

// ---------------------------------------------------------------------------
// The price list and the booking list have to mean the same services
// ---------------------------------------------------------------------------

test('price list: renamed services still resolve to a booking duration', () => {
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
  for (const c of Object.values(pricing)) assert.ok(!MANICURE_WORDS.test(c.category), c.category);
  const durations = require('../data/serviceDurations.json');
  for (const s of durations.services) assert.ok(!MANICURE_WORDS.test(s.name), `durations still has ${s.name}`);
  const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  assert.ok(!MANICURE_WORDS.test(script), 'script.js still mentions manicure');
  assert.ok(!fs.existsSync(path.join(ROOT, 'hairstylist_pic/munkhzaya.jpeg')), 'manicurist photo is still served');
});

// ---------------------------------------------------------------------------
// Customer gender and the non-refundable deposit (owner-approved wording)
// ---------------------------------------------------------------------------
const GENDER_NOTE = 'Эмэгтэй үйлчлүүлэгчид эмэгтэй үсчин, эрэгтэй үйлчлүүлэгчид эрэгтэй үсчин үйлчилнэ.';
const DEPOSIT_TERMS = 'Урьдчилгаа төлбөр нь цагаа цуцалсан эсвэл ирээгүй тохиолдолд буцаан олгогдохгүй гэдгийг ойлгож, зөвшөөрч байна.';

test('booking: the gender step and note use the approved wording', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('<legend>Үйлчлүүлэгч:</legend>'));
  assert.ok(html.includes('value="female"') && html.includes('<span>Эмэгтэй</span>'));
  assert.ok(html.includes('value="male"') && html.includes('<span>Эрэгтэй</span>'));
  assert.ok(html.includes(GENDER_NOTE));
  // No hairdresser is listed in the markup: script.js adds only matching ones.
  assert.ok(!/<option value="[^"]+">/.test(html.slice(html.indexOf('id="stylist-select"'), html.indexOf('</select>'))));
});

test('booking: the deposit box and the recorded agreement use the approved wording', () => {
  const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  assert.ok(script.includes(DEPOSIT_TERMS));
  assert.equal(require('../services/bookingRules').DEPOSIT_TERMS_TEXT, DEPOSIT_TERMS);
});

test('booking: the browser list of hairdressers matches the server, gender included', () => {
  const { STYLIST_CONFIG } = require('../config/stylists');
  const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const block = script.slice(script.indexOf('const STYLIST_CONFIG_CLIENT = {'), script.indexOf('};', script.indexOf('const STYLIST_CONFIG_CLIENT = {')));
  const entries = [...block.matchAll(/'([^']+)':\s*\{\s*price:\s*(\d+),\s*level:\s*'([^']+)',\s*gender:\s*'(female|male)'\s*\}/g)];
  assert.equal(entries.length, 7, 'seven hairdressers in the booking list');
  for (const [, id, price, level, gender] of entries) {
    const server = STYLIST_CONFIG[id];
    assert.ok(server, `${id} is not bookable on the server`);
    assert.equal(server.gender, gender, `${id} gender differs between browser and server`);
    assert.equal(server.price, Number(price), `${id} price differs`);
    assert.equal(server.level, level, `${id} level differs`);
  }
});

test('booking: the QR expiry wording is the approved text', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  assert.ok(html.includes('QR кодын хугацаа дууслаа. Шинэ QR код авах бол доорх товчийг дарна уу.'));
  assert.ok(html.includes('>Шинэ QR код авах</button>'));
  assert.ok(script.includes('`QR код ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} хүчинтэй`'));
  assert.ok(script.includes('Уучлаарай, энэ цаг өөр хүнд захиалагдсан байна. Өөр цаг сонгоно уу.'));
});
