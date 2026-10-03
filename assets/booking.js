/* Tara Salon — the booking page.
 *
 * Six steps: branch → services → stylist (customer gender first) → date and
 * time → details and deposit agreement → QPay. It drives the same booking
 * engine as the previous site, and every protection there is kept:
 *
 *   - the server decides everything that matters (deposit amount, duration,
 *     free times, closures, gender rule, branch → calendar and QPay account);
 *     this page only asks and shows;
 *   - no invoice without the non-refundable-deposit agreement, whose time is
 *     sent with the payment and written on the calendar event;
 *   - the QR shows «QR код m:ss хүчинтэй», and once it expires offers
 *     «Шинэ QR код авах» — only if the old invoice is unpaid and the time is
 *     still free;
 *   - payment is watched every 3 s for 5 min, then every 12 s up to 30 min;
 *     a payment after that (or with the page closed) is booked by QPay's own
 *     callback to the server;
 *   - one calendar event per booking whichever path writes it (server side).
 */
(function () {
  "use strict";

  // ── Customer-facing wording (owner-approved strings kept verbatim) ────
  const QPAY_QR_VALID_MS = 5 * 60 * 1000;
  const SLOT_TAKEN_RENEW_MSG = "Уучлаарай, энэ цаг өөр хүнд захиалагдсан байна. Өөр цаг сонгоно уу.";
  const CALENDAR_ERROR_MSG = "Төлбөр төлөгдсөн ч цаг бүртгэхэд алдаа гарлаа. Бидэнтэй холбогдоно уу.";
  const SLOT_TAKEN_PAID_MSG = "Төлбөр тань амжилттай орсон. Харамсалтай нь сонгосон цаг тань энэ хооронд өөр хүнд захиалагдсан байна. Салоны ажилтан тантай удахгүй холбогдож өөр цаг тохирно.";
  const GENDER_LABELS = { female: "Эмэгтэй", male: "Эрэгтэй" };
  const WEEKDAYS = ["Ням", "Дав", "Мяг", "Лха", "Пүр", "Баа", "Бям"];
  const DAYS_SHOWN = 14;

  const $ = (id) => document.getElementById(id);
  const mnt = new Intl.NumberFormat("en-US");
  const money = (n) => `${mnt.format(n)}₮`;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ── State ─────────────────────────────────────────────────────────────
  const state = {
    step: 1,
    branches: [],
    branch: null,          // branch object from /api/branches
    services: [],          // service names, in menu order
    gender: null,          // "female" | "male"
    stylist: null,         // stylist object
    date: null,            // YYYY-MM-DD
    time: null,            // HH:MM
    durationMinutes: null, // as the server resolved it for the chosen services
    termsAcceptedAt: null, // ISO time the deposit box was ticked
    testDeposit: null,     // 100 in the tester's browser (display only)
  };
  let menu = { categories: [] };
  let durations = new Map();
  let defaultMinutes = 60;
  let closures = [];
  let slotsRequest = 0;
  const pay = { poll: null, countdown: null, invoiceId: null, request: null, done: false };

  // ── Small helpers ─────────────────────────────────────────────────────
  // Same as normalizeServiceName() in config/serviceDurations.js.
  const normalizeName = (name) => String(name || "").toLowerCase().replace(/ё/g, "е")
    .replace(/[()/,]/g, " ").replace(/\s+/g, " ").trim();
  const minutesFor = (names) => names.reduce((sum, n) => sum + (durations.get(normalizeName(n)) || defaultMinutes), 0);
  const formatDuration = (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h && r) return `${h} цаг ${r} мин`;
    return h ? `${h} цаг` : `${r} мин`;
  };
  // Salon dates are Ulaanbaatar dates (UTC+8, no DST), whatever the phone's zone.
  const salonToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const addDays = (ymd, n) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dayLabel = (ymd) => {
    const d = new Date(`${ymd}T12:00:00Z`);
    return { weekday: WEEKDAYS[d.getUTCDay()], date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
  };
  const longDate = (ymd) => {
    const [, m, d] = ymd.split("-").map(Number);
    return `${m} сарын ${d}, ${dayLabel(ymd).weekday}`;
  };
  const closureFor = (ymd) => closures.find((c) => ymd >= c.start && ymd <= c.end) || null;
  const deposit = () => (state.testDeposit || (state.stylist ? state.stylist.deposit : 0));
  const phoneDigits = () => ($("customer-phone").value || "").replace(/\D/g, "");

  // A request that hangs must not freeze the page (the payment poll waits on
  // each check before sending the next), so every call gives up after 15 s.
  async function getJSON(url, opts = {}) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    let r;
    try {
      r = await fetch(url, ctrl ? { ...opts, signal: ctrl.signal } : opts);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  // ── Steps and navigation ──────────────────────────────────────────────
  function canEnter(step) {
    if (step <= 1) return true;
    if (step === 2) return !!(state.branch && state.branch.ready);
    if (step === 3) return canEnter(2) && state.services.length > 0;
    if (step === 4) {
      const level = requiredLevel(state.services);
      return canEnter(3) && !!state.stylist && state.stylist.gender === state.gender
        && (!level || state.stylist.levelKey === level);
    }
    if (step === 5) return canEnter(4) && !!state.date && !!state.time && !closureFor(state.date);
    if (step === 6) return canEnter(5) && !!pay.request;
    return false;
  }

  function showStep(step, { push = true, focus = true, force = false } = {}) {
    while (!force && step > 1 && !canEnter(step)) step -= 1;
    if (state.step === 6 && step !== 6) {
      // Leaving the QR drops it; «Баталгаажуулж төлөх» makes a new one.
      stopPayment();
      pay.request = null;
    }
    state.step = step;
    document.body.dataset.step = String(step);
    document.querySelectorAll(".step").forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
    document.querySelectorAll("#stepper li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("is-current", n === step);
      li.classList.toggle("is-done", n < step);
      const b = li.querySelector("button");
      b.disabled = pay.done || !(n < step && n < 6);
      if (n === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    if (step === 3) renderStylists();
    if (step === 4) enterDateStep();
    if (step === 5) renderDetails();
    updateActions();
    renderSummary();
    if (push) {
      try { history.pushState({ step }, "", `#${step}`); } catch (_) { /* file:// or sandbox */ }
    }
    if (focus) {
      const title = document.querySelector(`.step[data-step="${step}"] .step-title`);
      if (title) title.focus({ preventScroll: true });
      const top = document.querySelector(".booking-top");
      if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function updateActions() {
    const back = $("back-btn");
    const next = $("next-btn");
    const s = state.step;
    back.hidden = s === 1 || (s === 6 && pay.done);
    back.textContent = s === 6 ? "Буцах, мэдээллээ засах" : "Буцах";
    next.hidden = s === 6;
    if (s === 5) {
      next.textContent = "Баталгаажуулж төлөх";
      next.disabled = !detailsValid();
    } else {
      next.textContent = "Үргэлжлүүлэх";
      next.disabled = !canEnter(s + 1);
    }
  }

  function renderSummary() {
    const box = $("booking-summary");
    const list = $("summary-list");
    const rows = [];
    if (state.branch) rows.push(["Салбар", state.branch.name]);
    if (state.services.length) rows.push(["Үйлчилгээ", state.services.join(", ")]);
    if (state.stylist && state.step >= 4) rows.push(["Үсчин", `${state.stylist.id} (${state.stylist.title || state.stylist.level})`]);
    if (state.date && state.time && state.step >= 5) rows.push(["Цаг", `${longDate(state.date)}, ${state.time}`]);
    if (state.services.length) {
      const m = state.durationMinutes || minutesFor(state.services);
      rows.push(["Хугацаа", `ойролцоогоор ${formatDuration(m)}`]);
    }
    if (state.stylist && state.step >= 4) rows.push(["Урьдчилгаа", money(deposit())]);
    list.replaceChildren(...rows.flatMap(([k, v]) => [el("dt", "", k), el("dd", "", v)]));
    box.hidden = rows.length === 0;
  }

  // ── Step 1: branch ────────────────────────────────────────────────────
  function renderBranches() {
    const wrap = $("branch-options");
    wrap.replaceChildren(...state.branches.map((b) => {
      const label = el("label", "option option--branch" + (b.ready ? "" : " is-disabled"));
      const input = el("input");
      input.type = "radio";
      input.name = "branch";
      input.value = b.id;
      input.disabled = !b.ready;
      input.checked = !!(state.branch && state.branch.id === b.id);
      input.addEventListener("change", () => selectBranch(b));
      const body = el("span", "option-body");
      body.append(el("span", "option-title", b.name));
      if (b.address) body.append(el("span", "option-meta", b.address));
      if (Array.isArray(b.hoursText) && b.hoursText.length) {
        body.append(el("span", "option-meta", b.hoursText.map((h) => `${h.days}: ${h.time}`).join("; ")));
      }
      if (!b.ready) body.append(el("span", "option-note", "Онлайн захиалга удахгүй нээгдэнэ."));
      label.append(input, body);
      return label;
    }));
  }

  function selectBranch(b) {
    if (!b.ready) return;
    const changed = !state.branch || state.branch.id !== b.id;
    state.branch = b;
    if (changed) {
      // Hairdressers, times and a pending payment belong to one branch only,
      // and so do level-named services (a level the branch lacks is hidden).
      state.stylist = null;
      state.date = null;
      state.time = null;
      resetPaymentRequest();
      renderServices();
      state.services = Array.from(document.querySelectorAll(".service-checkbox:checked")).map((i) => i.value);
    }
    updateActions();
    renderSummary();
  }

  // ── Step 2: services ──────────────────────────────────────────────────
  // Each choice posts its `key` from data/services.json — unique across the
  // menu, unlike the names (the price list repeats some in two sections at
  // two prices). A service priced by hair length offers one choice per
  // length; at most one of them can be ticked.
  function serviceChoice(key, title, price, meta) {
    const label = el("label", "option option--check");
    const input = el("input");
    input.type = "checkbox";
    input.value = key;
    input.className = "service-checkbox";
    input.checked = state.services.includes(key);
    input.addEventListener("change", onServicesChanged);
    const body = el("span", "option-body");
    body.append(el("span", "option-title", title));
    if (typeof price === "number") body.append(el("span", "option-price", money(price)));
    if (meta) body.append(el("span", "option-meta", meta));
    label.append(input, body);
    return label;
  }

  function renderServices() {
    const wrap = $("service-options");
    wrap.replaceChildren(...menu.categories.map((c) => {
      const group = el("fieldset", "service-group");
      group.append(el("legend", "", c.name));
      const grid = el("div", "options options--services");
      c.services.forEach((s) => {
        // A level-named haircut nobody at this branch holds (e.g. 1-р зэрэг at
        // Парк Од) is not offered.
        const lv = levelOfService(s.key || s.name);
        if (lv && state.branch && !state.branch.stylists.some((x) => x.levelKey === lv)) return;
        if (!Array.isArray(s.prices)) {
          grid.append(serviceChoice(s.key, s.name, s.price, s.note));
          return;
        }
        const tiers = el("fieldset", "service-tiers");
        tiers.append(el("legend", "", s.name));
        if (s.details && s.details.footnote) tiers.append(el("p", "option-meta", s.details.footnote));
        const row = el("div", "tier-options");
        s.prices.forEach((p) => {
          const choice = serviceChoice(p.key, p.length, p.price);
          choice.querySelector("input").addEventListener("change", (e) => {
            if (!e.target.checked) return;
            row.querySelectorAll(".service-checkbox").forEach((i) => { if (i !== e.target) i.checked = false; });
            onServicesChanged();
          });
          row.append(choice);
        });
        tiers.append(row);
        grid.append(tiers);
      });
      group.append(grid);
      return group;
    }));
  }

  function onServicesChanged() {
    state.services = Array.from(document.querySelectorAll(".service-checkbox:checked")).map((i) => i.value);
    // A different length changes which start times fit: choose the time again.
    state.time = null;
    state.durationMinutes = null;
    resetPaymentRequest();
    updateActions();
    renderSummary();
  }

  // Level-named haircuts go only to a hairdresser of that level (the server
  // refuses any other); services/bookingRules.js has the same markers.
  const LEVEL_MARKERS = [[/\/\s*SPECIAL\s*\//iu, "special"], [/\/\s*МАСТЕР\s*\//iu, "master"], [/\/\s*1-р зэрэг\s*\//iu, "first"]];
  function levelOfService(key) {
    const hit = LEVEL_MARKERS.find(([re]) => re.test(String(key).normalize("NFC")));
    return hit ? hit[1] : null;
  }
  function requiredLevel(keys) {
    const levels = new Set(keys.map(levelOfService).filter(Boolean));
    if (levels.size === 0) return null;
    return levels.size === 1 ? [...levels][0] : "conflict";
  }

  // ── Step 3: customer gender, then only matching hairdressers ──────────
  function selectedGender() {
    const c = document.querySelector('input[name="customer-gender"]:checked');
    return c && (c.value === "female" || c.value === "male") ? c.value : null;
  }

  function renderStylists() {
    state.gender = selectedGender();
    const wrap = $("stylist-options");
    const level = requiredLevel(state.services);
    const fits = (s) => s.gender === state.gender && (!level || s.levelKey === level);
    const list = (state.branch ? state.branch.stylists : []).filter(fits);
    // The salon's rules: a hairdresser who does not serve this customer, or
    // not at the level the chosen haircut names, can never stay selected (the
    // server refuses such a payment as well).
    if (state.stylist && !fits(state.stylist)) {
      state.stylist = null;
      state.date = null;
      state.time = null;
      resetPaymentRequest();
    }
    if (!state.gender) {
      wrap.replaceChildren(el("p", "step-hint", "Эхлээд Эмэгтэй эсвэл Эрэгтэй гэдгээ сонгоно уу."));
    } else if (list.length === 0) {
      wrap.replaceChildren(el("p", "notice", `${state.branch.name}-д одоогоор ${GENDER_LABELS[state.gender].toLowerCase()} үйлчлүүлэгчид үйлчлэх үсчин онлайн захиалгад бүртгэгдээгүй байна. Салбарын утсаар холбогдоно уу.`));
    } else {
      wrap.replaceChildren(...list.map((s) => {
        const label = el("label", "option option--stylist");
        const input = el("input");
        input.type = "radio";
        input.name = "stylist";
        input.value = s.id;
        input.checked = !!(state.stylist && state.stylist.id === s.id);
        input.addEventListener("change", () => {
          if (!state.stylist || state.stylist.id !== s.id) {
            state.stylist = s;
            state.time = null;
            resetPaymentRequest();
          }
          updateActions();
          renderSummary();
        });
        let face;
        if (s.photo) {
          face = el("img", "stylist-photo");
          face.src = s.photo;
          face.alt = "";
          face.width = 72;
          face.height = 90;
          face.loading = "lazy";
        } else {
          face = el("span", "stylist-photo stylist-initial", s.id.slice(0, 1));
          face.setAttribute("aria-hidden", "true");
        }
        const body = el("span", "option-body");
        body.append(el("span", "option-title", s.id), el("span", "option-meta", s.title || s.level), el("span", "option-price", `Урьдчилгаа ${money(state.testDeposit || s.deposit)}`));
        label.append(input, face, body);
        return label;
      }));
    }
    updateActions();
    renderSummary();
  }

  // ── Step 4: date and time ─────────────────────────────────────────────
  function enterDateStep() {
    const today = salonToday();
    if (!state.date || state.date < today) state.date = today;
    renderDays();
    loadSlots();
  }

  function renderDays() {
    const strip = $("day-strip");
    const today = salonToday();
    const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i));
    if (!days.includes(state.date)) days.unshift(state.date);
    strip.replaceChildren(...days.map((ymd) => {
      const b = el("button", "day");
      b.type = "button";
      const { weekday, date } = dayLabel(ymd);
      b.append(el("span", "day-w", ymd === today ? "Өнөөдөр" : weekday), el("span", "day-d", date));
      const closure = closureFor(ymd);
      if (closure) {
        b.classList.add("is-closed");
        b.append(el("span", "day-note", "Амарна"));
        b.title = closure.title;
      }
      b.setAttribute("aria-pressed", ymd === state.date ? "true" : "false");
      b.setAttribute("aria-label", `${longDate(ymd)}${closure ? ", салон амарна" : ""}`);
      b.addEventListener("click", () => {
        state.date = ymd;
        state.time = null;
        resetPaymentRequest();
        strip.querySelectorAll(".day").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
        loadSlots();
        updateActions();
      });
      return b;
    }));
    const current = strip.querySelector('[aria-pressed="true"]');
    if (current) current.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function renderClosure(closure) {
    const box = el("div", "closure");
    box.append(el("h3", "", closure.title), el("p", "", closure.message));
    const reopen = el("p", "closure-reopen", `Захиалга нээгдэх өдөр: ${longDate(closure.reopenDate)}`);
    const btn = el("button", "btn btn--outline", "Нээгдэх өдрийг сонгох");
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.date = closure.reopenDate;
      state.time = null;
      renderDays();
      loadSlots();
    });
    box.append(reopen, btn);
    $("slots").replaceChildren(box);
  }

  // Opening hours, used only if the calendar cannot be reached — the server
  // still refuses any time that is taken (and alerts staff if it must).
  function fallbackSlots(ymd, minutes) {
    const b = state.branch;
    const sunday = new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;
    const hours = (b && b.workHours) || { weekday: [10, 20], sunday: [11, 19] };
    const [open, close] = sunday ? hours.sunday : hours.weekday;
    const salonNow = new Date(Date.now() + 8 * 3600 * 1000);
    const nowMin = ymd === salonToday() ? salonNow.getUTCHours() * 60 + salonNow.getUTCMinutes() : -1;
    const out = [];
    for (let t = open * 60; t <= close * 60 - minutes; t += 60) {
      if (t < nowMin) continue;
      out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:00`);
    }
    return out;
  }

  async function loadSlots({ notice } = {}) {
    const box = $("slots");
    const ymd = state.date;
    const known = closureFor(ymd);
    if (known) { renderClosure(known); return; }
    const request = ++slotsRequest;
    box.replaceChildren(el("p", "step-hint", "Чөлөөт цагийг шалгаж байна…"));
    const minutes = minutesFor(state.services);
    let slots;
    let resolved = minutes;
    try {
      const params = new URLSearchParams({ date: ymd, stylistId: state.stylist.id, branch: state.branch.id });
      if (state.services.length) params.set("services", state.services.join(","));
      const r = await getJSON(`/api/calendar/available-slots?${params}`);
      if (request !== slotsRequest) return; // the customer has moved on
      if (!r.ok) throw new Error(r.data.error || `HTTP ${r.status}`);
      if (r.data.closure) {
        if (!closureFor(ymd)) closures.push(r.data.closure);
        renderDays();
        renderClosure(r.data.closure);
        return;
      }
      slots = r.data.availableSlots || [];
      resolved = r.data.durationMinutes || minutes;
    } catch (err) {
      if (request !== slotsRequest) return;
      console.error("available-slots:", err);
      if (closureFor(ymd)) { renderClosure(closureFor(ymd)); return; }
      slots = fallbackSlots(ymd, minutes);
    }
    state.durationMinutes = resolved;
    renderSummary();

    const nodes = [];
    if (notice) {
      const n = el("p", "notice notice--error", notice);
      n.setAttribute("role", "alert");
      nodes.push(n);
    }
    nodes.push(el("p", "slots-hint", `Сонгосон үйлчилгээ: ойролцоогоор ${formatDuration(resolved)}`));
    if (!slots.length) {
      nodes.push(el("p", "notice", `Сонгосон үйлчилгээ (${formatDuration(resolved)}) багтах чөлөөт цаг тухайн өдөрт байхгүй байна. Өөр өдөр сонгох эсвэл үйлчилгээгээ цөөрүүлж үзнэ үү.`));
    } else {
      const grid = el("div", "slot-grid");
      slots.forEach((t) => {
        const b = el("button", "slot", t);
        b.type = "button";
        b.setAttribute("aria-pressed", t === state.time ? "true" : "false");
        b.addEventListener("click", () => {
          state.time = t;
          resetPaymentRequest();
          grid.querySelectorAll(".slot").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
          updateActions();
          renderSummary();
        });
        grid.append(b);
      });
      nodes.push(grid);
    }
    if (state.time && !slots.includes(state.time)) state.time = null;
    box.replaceChildren(...nodes);
    updateActions();
  }

  // ── Step 5: details and the deposit agreement ─────────────────────────
  function detailsValid() {
    return ($("customer-name").value || "").trim().length > 0
      && phoneDigits().length >= 8
      && $("deposit-terms").checked
      && !!state.termsAcceptedAt;
  }

  function renderDetails() {
    $("deposit-amount").textContent = money(deposit());
    $("pay-error").hidden = true;
  }

  // ── Step 6: QPay ──────────────────────────────────────────────────────
  function resetPaymentRequest() {
    pay.request = null;
  }

  function stopTimers() {
    if (pay.poll) { clearInterval(pay.poll); pay.poll = null; }
    if (pay.countdown) { clearInterval(pay.countdown); pay.countdown = null; }
  }

  /** Leave the QR (back button, or a new choice). The late-payment callback
   *  still books a payment made after this. */
  function stopPayment() {
    stopTimers();
    $("deposit-terms").disabled = false;
    $("next-btn").disabled = !detailsValid();
  }

  function setQrExpired(expired) {
    $("qpay-qr-wrapper").hidden = expired;
    $("qpay-bank-buttons").hidden = expired;
    $("qpay-countdown").hidden = expired;
    $("qpay-expired").hidden = !expired;
  }

  function showQrCountdown(expiresAt) {
    if (pay.countdown) clearInterval(pay.countdown);
    const out = $("qpay-countdown");
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      out.textContent = `QR код ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} хүчинтэй`;
      if (left <= 0) {
        clearInterval(pay.countdown);
        pay.countdown = null;
        // The poll keeps running: a payment made in the last seconds is still booked.
        setQrExpired(true);
      }
    };
    tick();
    pay.countdown = setInterval(tick, 1000);
  }

  function buildPaymentRequest() {
    const name = $("customer-name").value.trim();
    const phone = $("customer-phone").value.trim();
    const { stylist, date, time, branch } = state;
    return {
      amount: deposit(),
      name,
      phone,
      // Internal booking record; the server reads the stylist, date and time
      // from it (services/lateBooking.js). The «Matrix Eco:» prefix is the
      // format the server parses, not shown to the customer.
      description: `Matrix Eco: ${stylist.id} - ${date} ${time} - ${name} - ${phone}`,
      staffName: stylist.id,
      branch: branch.id,
      bookingDate: date,
      bookingTime: time, // kept with the invoice; the server reads the time from `description`
      selectedServices: state.services.join(", "),
      customerGender: state.gender,
      depositTermsAccepted: !!state.termsAcceptedAt,
      depositTermsAcceptedAt: state.termsAcceptedAt,
    };
  }

  async function startPayment() {
    // Re-checked here, not trusted from earlier: the answers may have changed.
    if (!detailsValid()) { updateActions(); return; }
    if (closureFor(state.date)) { showStep(4); return; }
    if (!state.stylist || state.stylist.gender !== selectedGender()) { showStep(3); return; }
    pay.request = buildPaymentRequest();
    pay.done = false;
    showStep(6);
    await createInvoice();
  }

  async function createInvoice() {
    const req = pay.request;
    stopTimers();
    setQrExpired(false);
    $("booking-result").hidden = true;
    $("qpay-panel").hidden = false;
    $("qpay-status").textContent = "QR код үүсгэж байна…";
    $("qpay-qr-img").removeAttribute("src");
    $("qpay-bank-buttons").replaceChildren();
    $("qpay-countdown").textContent = "";
    $("qpay-amount").textContent = money(req.amount);
    $("deposit-terms").disabled = true; // the agreement stands for this invoice

    let r;
    try {
      r = await getJSON("/api/qpay/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch (err) {
      r = { ok: false, status: 0, data: { error: "Сүлжээний алдаа. Холболтоо шалгаад дахин оролдоно уу." } };
    }
    if (pay.request !== req) return; // the customer left meanwhile

    if (!r.ok) {
      if (r.status === 409 && r.data.closure) {
        if (!closureFor(r.data.closure.start)) closures.push(r.data.closure);
        showStep(4);
        return;
      }
      if (r.status === 409 && r.data.slotTaken) {
        // Someone (here or in Messenger) holds or booked this time: pick another.
        stopTimers();
        pay.request = null;
        state.time = null;
        showStep(4, { focus: false });
        await loadSlots({ notice: SLOT_TAKEN_RENEW_MSG });
        return;
      }
      pay.request = null;
      showStep(5);
      const e = $("pay-error");
      e.textContent = `Төлбөр үүсгэхэд алдаа гарлаа: ${r.data.error || `HTTP ${r.status}`}`;
      e.hidden = false;
      return;
    }

    const data = r.data;
    if (data.qr_image) {
      const img = $("qpay-qr-img");
      img.src = data.qr_image.startsWith("data:") ? data.qr_image : `data:image/png;base64,${data.qr_image}`;
      img.alt = "QPay QR код";
      // QPay's clock started a moment before this response arrived.
      showQrCountdown(Date.now() + QPAY_QR_VALID_MS - 1000);
    }
    const banks = $("qpay-bank-buttons");
    (Array.isArray(data.urls) ? data.urls : []).forEach((u) => {
      const a = el("a", "bank-link");
      a.href = u.link;
      a.rel = "noopener noreferrer";
      if (u.logo) {
        const logo = el("img");
        logo.src = u.logo;
        logo.alt = "";
        logo.width = 28;
        logo.height = 28;
        logo.loading = "lazy";
        a.append(logo);
      }
      a.append(el("span", "", u.description || u.name || "Банкны апп"));
      banks.append(a);
    });
    $("qpay-status").textContent = "Төлбөр орохыг хүлээж байна. Төлсний дараа энэ хуудас автоматаар шинэчлэгдэнэ.";

    const invoiceId = data.invoice_id || data.qpay_invoice_id || data.id || null;
    pay.invoiceId = invoiceId;
    $("qpay-renew-btn").disabled = false;
    $("qpay-renew-btn").onclick = () => renewQr(invoiceId);
    if (invoiceId) startPolling(invoiceId, req);
  }

  async function isInvoicePaid(invoiceId, branchId) {
    const r = await getJSON("/api/qpay/check-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: invoiceId, branch: branchId }),
    });
    if (!r.ok) return false;
    const d = r.data;
    return d.invoice_status === "PAID" || d.status === "PAID" || d.payment_status === "PAID"
      || (d.payment_info && d.payment_info.payment_status === "PAID") || d.paid === true
      || (Array.isArray(d.rows) && d.rows.some((row) => row && row.payment_status === "PAID"));
  }

  function startPolling(invoiceId, req) {
    // Every 3 s for the first 5 minutes, then every 12 s up to 30 minutes.
    const FAST_TICKS = 100;
    const MAX_TICKS = 600;
    let ticks = 0;
    let busy = false;
    pay.poll = setInterval(async () => {
      ticks += 1;
      if (ticks > MAX_TICKS) { clearInterval(pay.poll); pay.poll = null; return; }
      if (ticks > FAST_TICKS && ticks % 4 !== 0) return;
      if (busy || pay.done) return;
      busy = true;
      try {
        if (await isInvoicePaid(invoiceId, req.branch)) {
          if (pay.done) return;
          await confirmBooking(invoiceId, req);
        }
      } catch (err) {
        console.error("check-payment:", err);
      } finally {
        busy = false;
      }
    }, 3000);
  }

  function showResult(kind, title, lines) {
    $("qpay-panel").hidden = true;
    const box = $("booking-result");
    box.className = `booking-result booking-result--${kind}`;
    const nodes = [el("h3", "", title), ...lines.map((l) => (typeof l === "string" ? el("p", "", l) : l))];
    if (kind !== "wait") {
      const again = el("a", "btn btn--primary", "Нүүр хуудас");
      again.href = "/";
      nodes.push(again);
    }
    box.replaceChildren(...nodes);
    box.hidden = false;
    box.focus({ preventScroll: true });
    updateActions();
  }

  /** Paid: book it and show the outcome — even if the customer had stepped
   *  back from the QR meanwhile, so they never pay a second time for it. */
  async function confirmBooking(invoiceId, req) {
    if (pay.done) return;
    pay.done = true;
    stopTimers();
    pay.request = req;
    if (state.step !== 6) showStep(6, { force: true, push: false });
    showResult("wait", "Төлбөр баталгаажиж байна. Түр хүлээнэ үү...", []);
    let r;
    try {
      r = await getJSON("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stylistId: req.staffName,
          branch: req.branch,
          startTime: `${req.bookingDate}T${req.bookingTime}:00+08:00`,
          customerName: req.name,
          customerPhone: req.phone,
          selectedServices: req.selectedServices,
          customerGender: req.customerGender,
          depositTermsAccepted: req.depositTermsAccepted,
          depositTermsAcceptedAt: req.depositTermsAcceptedAt,
          invoiceId,
        }),
      });
    } catch (_) {
      r = { ok: false, status: 0, data: {} };
    }
    if (r.ok) {
      const dl = el("dl", "result-list");
      [["Салбар", state.branch.name], ["Үсчин", req.staffName], ["Өдөр", longDate(req.bookingDate)], ["Цаг", req.bookingTime],
        ["Үйлчилгээ", req.selectedServices]].forEach(([k, v]) => dl.append(el("dt", "", k), el("dd", "", v)));
      showResult("ok", "Амжилттай! Таны цаг захиалга баталгаажлаа.", [dl, "Захиалсан цагтаа ирэхийг хүсье. Цагаа өөрчлөх шаардлагатай бол салбарын утсаар холбогдоно уу."]);
    } else if (r.status === 409 && r.data.conflict) {
      showResult("warn", "Төлбөр орсон", [SLOT_TAKEN_PAID_MSG]);
    } else {
      showResult("warn", "Төлбөр орсон", [CALENDAR_ERROR_MSG]);
    }
  }

  /** «Шинэ QR код авах»: a fresh invoice for the same booking — only if the
   *  expired one was not paid after all, and only if the time is still free. */
  async function renewQr(oldInvoiceId) {
    const req = pay.request;
    if (!req) return;
    $("qpay-renew-btn").disabled = true;
    if (oldInvoiceId) {
      try {
        if (await isInvoicePaid(oldInvoiceId, req.branch)) {
          // Paid after all: the poll books it; if the poll has already
          // stopped (30 minutes), book it from here.
          if (!pay.poll) await confirmBooking(oldInvoiceId, req);
          return;
        }
      } catch (_) { /* cannot tell: carry on; the server still books once */ }
    }
    if (pay.request !== req) return;
    // The server holds the time again for this customer before the new QR,
    // or answers «taken» (handled in createInvoice), so no separate check here:
    // a check would see this customer's own hold and call the time taken.
    await createInvoice();
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  function wire() {
    $("next-btn").addEventListener("click", () => {
      if (state.step === 5) return startPayment();
      if (canEnter(state.step + 1)) showStep(state.step + 1);
    });
    $("back-btn").addEventListener("click", () => showStep(Math.max(1, state.step - 1)));
    document.querySelectorAll("#stepper button").forEach((b) => {
      b.addEventListener("click", () => showStep(Number(b.closest("li").dataset.step)));
    });
    window.addEventListener("popstate", (e) => {
      if (pay.done) return; // booked: nothing to go back to
      showStep((e.state && e.state.step) || 1, { push: false });
    });
    document.querySelectorAll('input[name="customer-gender"]').forEach((r) => r.addEventListener("change", renderStylists));
    ["customer-name", "customer-phone"].forEach((id) => $(id).addEventListener("input", () => {
      resetPaymentRequest();
      $("phone-error").hidden = !($("customer-phone").value && phoneDigits().length < 8);
      updateActions();
    }));
    $("deposit-terms").addEventListener("change", (e) => {
      // The time of agreement is recorded for this booking (sent with the
      // payment and written on the calendar event).
      state.termsAcceptedAt = e.target.checked ? new Date().toISOString() : null;
      updateActions();
    });
    // Back/forward cache: never let the list disagree with the answer shown.
    window.addEventListener("pageshow", () => { if (state.step === 3) renderStylists(); });
  }

  async function init() {
    wire();
    const fatal = (msg) => {
      $("booking-loading").hidden = true;
      const f = $("booking-fatal");
      f.textContent = msg;
      f.hidden = false;
      $("step-actions").hidden = true;
    };
    let branchesRes;
    let menuRes;
    try {
      [branchesRes, menuRes] = await Promise.all([getJSON("/api/branches"), getJSON("/data/services.json")]);
    } catch (_) {
      return fatal("Захиалгын мэдээллийг ачаалж чадсангүй. Интернэт холболтоо шалгаад хуудсаа шинэчилнэ үү.");
    }
    if (!branchesRes.ok || !menuRes.ok) {
      return fatal(branchesRes.status === 503 ? (branchesRes.data.error || "Вэбсайт түр засвартай байна.")
        : "Захиалгын мэдээллийг ачаалж чадсангүй. Хуудсаа шинэчилнэ үү.");
    }
    state.branches = branchesRes.data.branches || [];
    menu = menuRes.data;

    // Not blocking: durations only refine the «≈ N цаг» hint, closures only
    // mark days early — the server enforces both regardless.
    getJSON("/data/serviceDurations.json").then((r) => {
      if (!r.ok) return;
      const map = new Map();
      (r.data.services || []).forEach((s) => {
        if (!s || !(s.minutes > 0)) return;
        map.set(normalizeName(s.name), s.minutes);
        (s.aliases || []).forEach((a) => map.set(normalizeName(a), s.minutes));
      });
      durations = map;
      if (r.data.defaultMinutes > 0) defaultMinutes = r.data.defaultMinutes;
      renderSummary();
    }).catch(() => {});
    getJSON("/api/calendar/closures").then((r) => {
      if (r.ok && Array.isArray(r.data.closures)) closures = r.data.closures;
      if (state.step === 4) { renderDays(); loadSlots(); }
    }).catch(() => {});
    getJSON("/api/site-mode", { cache: "no-store" }).then((r) => {
      if (!r.ok || !r.data.test) return;
      state.testDeposit = r.data.testDeposit || 100;
      const banner = $("test-banner");
      banner.textContent = `ТЕСТ ГОРИМ — урьдчилгаа ${state.testDeposit}₮, захиалга «ТЕСТ» гэж тэмдэглэгдэнэ.`;
      banner.hidden = false;
      renderSummary();
    }).catch(() => {});

    renderBranches();
    renderServices();
    // A branch link (/booking.html?branch=yaarmag) preselects it.
    const wanted = new URLSearchParams(location.search).get("branch");
    const pre = state.branches.find((b) => b.id === wanted && b.ready);
    if (pre) {
      selectBranch(pre);
      const input = document.querySelector(`input[name="branch"][value="${pre.id}"]`);
      if (input) input.checked = true;
    }
    $("booking-loading").hidden = true;
    try { history.replaceState({ step: 1 }, "", location.pathname + location.search); } catch (_) { /* ignore */ }
    showStep(1, { push: false, focus: false });
  }

  init();
})();
