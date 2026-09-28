/* Tara Salon — the Amos and Keune product pages. Carried over from the
 * previous site (same data files, filters, pagination and detail view),
 * rebuilt with DOM APIs instead of HTML strings. */
(function () {
  "use strict";

  const mnt = new Intl.NumberFormat("en-US");
  const price = (n) => `${mnt.format(n)}₮`;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const failed = (grid) => {
    grid.replaceChildren(el("p", "notice", "Бүтээгдэхүүнийг ачаалж чадсангүй. Хуудсаа шинэчилнэ үү."));
  };

  // ── Amos (data/products.json) ────────────────────────────────────────
  const grid = document.getElementById("products-grid");
  if (grid) {
    const PER_PAGE = 15;
    const filters = document.getElementById("products-filters");
    const pager = document.getElementById("products-pagination");
    let all = [];
    let shown = [];
    let page = 1;

    // Category names start with a line number ("01 Pro basic style"); the
    // filter groups by it, as the salon's catalogue does. Others are «Бусад».
    const prefixOf = (category) => {
      const m = /^(\d+)\s/.exec(category || "");
      return m ? m[1] : null;
    };

    const renderPage = (p) => {
      const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
      page = Math.min(Math.max(p, 1), pages);
      grid.replaceChildren(...shown.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((product) => {
        const card = el("article", "product-card");
        const imgWrap = el("div", "product-image");
        const img = el("img");
        img.src = product.image;
        img.alt = product.name;
        img.loading = "lazy";
        img.addEventListener("error", () => { imgWrap.textContent = "Amos"; }, { once: true });
        imgWrap.append(img);
        const info = el("div", "product-info");
        info.append(el("div", "product-category", product.category), el("h3", "product-name", product.name), el("div", "product-price", price(product.price)));
        card.append(imgWrap, info);
        return card;
      }));
      pager.replaceChildren();
      pager.hidden = pages <= 1;
      for (let i = 1; i <= pages; i += 1) {
        const b = el("button", "page-btn", String(i));
        b.type = "button";
        if (i === page) { b.classList.add("active"); b.setAttribute("aria-current", "page"); }
        b.addEventListener("click", () => {
          renderPage(i);
          grid.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        pager.append(b);
      }
    };

    const setFilter = (key, btn) => {
      shown = key === "all" ? all
        : key === "other" ? all.filter((p) => prefixOf(p.category) === null)
        : all.filter((p) => prefixOf(p.category) === key);
      filters.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      renderPage(1);
    };

    const renderFilters = () => {
      const prefixes = [...new Set(all.map((p) => prefixOf(p.category)).filter(Boolean))].sort((a, b) => a - b);
      const hasOther = all.some((p) => prefixOf(p.category) === null);
      const keys = [["all", "Бүгд"], ...prefixes.map((p) => [p, p]), ...(hasOther ? [["other", "Бусад"]] : [])];
      filters.replaceChildren(...keys.map(([key, label], i) => {
        const b = el("button", "filter-btn" + (i === 0 ? " active" : ""), label);
        b.type = "button";
        b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        b.addEventListener("click", () => setFilter(key, b));
        return b;
      }));
    };

    fetch("/data/products.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        all = Array.isArray(data.products) ? data.products : [];
        shown = all;
        renderFilters();
        renderPage(1);
      })
      .catch((err) => { console.error("Amos products:", err); failed(grid); });
  }

  // ── Keune (data/keune-products.json) ─────────────────────────────────
  const keuneGrid = document.getElementById("keune-grid");
  if (keuneGrid) {
    const keuneFilters = document.getElementById("keune-filters");
    let all = [];
    let modal = null;
    let opener = null;

    const ensureModal = () => {
      if (modal) return modal;
      modal = el("div", "keune-modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "keune-modal-title");
      modal.innerHTML =
        '<div class="keune-modal-backdrop" data-close></div>' +
        '<div class="keune-modal-body">' +
        '<button class="keune-modal-close" type="button" aria-label="Хаах" data-close>✕</button>' +
        '<div class="keune-modal-scroll">' +
        '<h2 class="keune-modal-title" id="keune-modal-title"></h2><p class="keune-modal-desc"></p>' +
        '<div class="keune-modal-subproducts"></div>' +
        '<div class="keune-modal-image-wrap"><img alt="" /></div>' +
        "</div></div>";
      document.body.append(modal);
      modal.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("is-open")) close(); });
      return modal;
    };
    const close = () => {
      modal.classList.remove("is-open");
      if (opener) opener.focus();
    };
    const open = ({ title = "", desc = "", subs = [], image = "", alt = "" }, from) => {
      const m = ensureModal();
      opener = from || null;
      m.querySelector(".keune-modal-title").textContent = title;
      m.querySelector(".keune-modal-desc").textContent = desc;
      const subWrap = m.querySelector(".keune-modal-subproducts");
      subWrap.replaceChildren();
      if (subs.length) {
        const table = el("table", "keune-sub-table");
        const head = el("tr");
        ["Бүтээгдэхүүн", "Хэмжээ", "Үнэ"].forEach((h) => head.append(el("th", "", h)));
        table.append(el("thead"), el("tbody"));
        table.tHead.append(head);
        subs.forEach((s) => {
          const tr = el("tr");
          const name = el("td");
          name.append(el("div", "keune-sub-name", s.name), el("div", "keune-sub-name-mn", s.nameMn));
          tr.append(name, el("td", "keune-sub-vol", s.volume), el("td", "keune-sub-price", price(s.price)));
          table.tBodies[0].append(tr);
        });
        subWrap.append(table);
      }
      const imgWrap = m.querySelector(".keune-modal-image-wrap");
      imgWrap.hidden = !image;
      if (image) { imgWrap.querySelector("img").src = image; imgWrap.querySelector("img").alt = alt; }
      m.classList.add("is-open");
      m.querySelector(".keune-modal-close").focus();
      m.querySelector(".keune-modal-scroll").scrollTop = 0;
    };

    document.querySelectorAll(".keune-brand-img").forEach((img) => {
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      const show = () => open({ image: img.src, alt: img.alt }, img);
      img.addEventListener("click", show);
      img.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } });
    });

    const renderGrid = (list) => {
      keuneGrid.replaceChildren(...list.map((product) => {
        const subs = product.subProducts || [];
        const hasMore = !!product.detailImage || subs.length > 0;
        const card = el("article", "keune-card");
        const img = el("img", "keune-card-img");
        img.src = product.image;
        img.alt = product.name;
        img.loading = "lazy";
        const body = el("div", "keune-card-body");
        body.append(el("span", "keune-card-cat", product.category), el("h3", "keune-card-name", product.name), el("p", "keune-card-desc", product.description));
        if (hasMore) {
          const more = el("button", "keune-card-badge", "Дэлгэрэнгүй харах");
          more.type = "button";
          more.setAttribute("aria-label", `${product.name} — дэлгэрэнгүй харах`);
          more.addEventListener("click", () => open({
            title: product.name, desc: product.description, subs,
            image: product.detailImage || "", alt: `${product.name} дэлгэрэнгүй`,
          }, more));
          body.append(more);
        }
        card.append(img, body);
        return card;
      }));
    };

    const renderFilters = () => {
      const cats = [...new Set(all.map((p) => p.category))].sort();
      const keys = [null, ...cats];
      keuneFilters.replaceChildren(...keys.map((cat, i) => {
        const b = el("button", "filter-btn" + (i === 0 ? " active" : ""), cat || "Бүгд");
        b.type = "button";
        b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        b.addEventListener("click", () => {
          keuneFilters.querySelectorAll(".filter-btn").forEach((x) => {
            x.classList.toggle("active", x === b);
            x.setAttribute("aria-pressed", x === b ? "true" : "false");
          });
          renderGrid(cat ? all.filter((p) => p.category === cat) : all);
        });
        return b;
      }));
    };

    fetch("/data/keune-products.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        all = Array.isArray(data.products) ? data.products : [];
        renderFilters();
        renderGrid(all);
      })
      .catch((err) => { console.error("Keune products:", err); failed(keuneGrid); });
  }
})();
