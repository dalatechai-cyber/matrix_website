/* Tara Salon — shared page behaviour: menu, header, booking bar, gallery
 * lightbox, maps on demand. No dependencies; everything degrades to plain
 * links when this file does not load. */
(function () {
  "use strict";

  // ── Mobile menu ──────────────────────────────────────────────────────
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (toggle && nav) {
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Цэс хаах" : "Цэс нээх");
      document.body.classList.toggle("nav-locked", open);
    };
    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 961px)").addEventListener("change", (e) => { if (e.matches) setOpen(false); });
  }

  // ── Header hairline once the page scrolls ────────────────────────────
  const header = document.querySelector(".site-header");
  if (header) {
    const update = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  // ── Phone booking bar: shown once the first screen has scrolled away ──
  const bar = document.querySelector(".book-bar");
  const firstScreen = document.querySelector(".hero, .page-intro");
  if (bar && firstScreen && "IntersectionObserver" in window) {
    document.body.classList.add("has-book-bar");
    const link = bar.querySelector("a");
    new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting;
      bar.classList.toggle("is-visible", show);
      bar.setAttribute("aria-hidden", show ? "false" : "true");
      if (link) link.tabIndex = show ? 0 : -1;
    }).observe(firstScreen);
  }

  // ── Maps load only when asked (no Google request on page load) ───────
  document.querySelectorAll("[data-map-load]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const frame = btn.closest("[data-map-src]");
      if (!frame) return;
      const iframe = document.createElement("iframe");
      iframe.src = frame.dataset.mapSrc;
      iframe.title = frame.dataset.mapTitle || "Газрын зураг";
      iframe.loading = "lazy";
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      iframe.setAttribute("allowfullscreen", "");
      frame.replaceChildren(iframe);
    });
  });

  // ── Gallery filter (Бүгд / Эмэгтэй / Эрэгтэй) ─────────────────────────
  const filterRow = document.querySelector(".filter-row [data-filter]") && document.querySelector(".filter-row");
  const filterGrid = document.querySelector(".gallery-grid[data-gallery]");
  if (filterRow && filterGrid) {
    filterRow.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      const cat = chip.dataset.filter;
      filterRow.querySelectorAll("[data-filter]").forEach((c) => c.setAttribute("aria-pressed", c === chip ? "true" : "false"));
      filterGrid.querySelectorAll("button[data-cat]").forEach((b) => { b.hidden = cat !== "all" && b.dataset.cat !== cat; });
    });
  }

  // ── Disclosure: a service name that opens its description (TARA LUMI) ─
  // The page arrives open, so the text is there without JavaScript; here it
  // closes, and each toggle eases the height. Closed text is `hidden`, so
  // screen readers and keyboard users never land inside it.
  document.querySelectorAll("[data-disclosure]").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (!panel) return;
    let timer = null;
    const set = (open, animate) => {
      clearTimeout(timer);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        panel.hidden = false;
        if (animate) void panel.offsetHeight; // start from the closed size
        panel.classList.remove("is-closed");
      } else {
        panel.classList.add("is-closed");
        if (!animate) { panel.hidden = true; return; }
        timer = setTimeout(() => { if (btn.getAttribute("aria-expanded") === "false") panel.hidden = true; }, 420);
      }
    };
    set(false, false);
    btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true", true));
  });

  // ── Sections ease in as they reach the screen ─────────────────────────
  // Only below the first screen, only once, and never with reduced motion.
  const revealables = document.querySelectorAll("[data-reveal], [data-reveal-group]");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (revealables.length && !calm && "IntersectionObserver" in window) {
    const below = Array.from(revealables).filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.92);
    if (below.length) {
      below.forEach((el) => {
        if (el.hasAttribute("data-reveal-group")) Array.from(el.children).forEach((c, i) => c.style.setProperty("--i", Math.min(i, 6)));
      });
      document.documentElement.classList.add("has-motion");
      revealables.forEach((el) => { if (!below.includes(el)) el.classList.add("is-in"); });
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      below.forEach((el) => io.observe(el));
      // Printing shows everything, scrolled to or not.
      window.addEventListener("beforeprint", () => revealables.forEach((el) => el.classList.add("is-in")));
    }
  }

  // ── Gallery lightbox ─────────────────────────────────────────────────
  const galleries = document.querySelectorAll("[data-gallery]");
  if (galleries.length) {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Зураг томруулж харах");
    box.innerHTML =
      '<button class="lightbox-close" type="button" aria-label="Хаах">✕</button>' +
      '<button class="lightbox-nav" type="button" data-dir="-1" aria-label="Өмнөх зураг">‹</button>' +
      '<img alt="" />' +
      '<button class="lightbox-nav" type="button" data-dir="1" aria-label="Дараагийн зураг">›</button>';
    document.body.appendChild(box);
    const img = box.querySelector("img");
    let items = [];
    let index = 0;
    let opener = null;

    const show = (i) => {
      index = (i + items.length) % items.length;
      const source = items[index].querySelector("img");
      img.src = source.dataset.full || source.currentSrc || source.src;
      img.alt = source.alt;
    };
    const close = () => {
      box.classList.remove("is-open");
      document.body.classList.remove("nav-locked");
      if (opener) opener.focus();
    };
    box.addEventListener("click", (e) => {
      const nav = e.target.closest(".lightbox-nav");
      if (nav) return show(index + Number(nav.dataset.dir));
      if (e.target === box || e.target.closest(".lightbox-close")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (!box.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") show(index + 1);
      if (e.key === "ArrowLeft") show(index - 1);
    });
    galleries.forEach((gallery) => {
      gallery.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn || !gallery.contains(btn)) return;
        items = Array.from(gallery.querySelectorAll("button")).filter((b) => !b.hidden);
        opener = btn;
        show(items.indexOf(btn));
        box.classList.add("is-open");
        document.body.classList.add("nav-locked");
        box.querySelector(".lightbox-close").focus();
      });
    });
  }
})();
