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
      img.src = source.currentSrc || source.src;
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
