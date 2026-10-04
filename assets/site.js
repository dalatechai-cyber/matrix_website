/* Tara Salon — shared page behaviour: menu, header, booking bar, maps on
 * demand. No dependencies; everything degrades to plain
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

})();
