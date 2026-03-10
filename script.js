const embeddedPricing = [];

const pricingGrid = document.getElementById("pricing-grid");
const serviceSelect = document.getElementById("service-select");
let selectedDate = null;
let selectedTime = null;
const dayStrip = document.getElementById("day-strip");
const todayBtn = document.getElementById("today-btn");

// Default text for the confirm payment button — single source of truth.
const CONFIRM_BTN_DEFAULT_TEXT = "Баталгаажуулж төлөх";
let qpayPollInterval = null;
// Track the active confirm button and its original text so the close handler
// can re-enable it if the user dismisses the QR panel before paying.
let qpayActiveConfirmBtn = null;
let qpayActiveConfirmBtnText = "";

const formatter = new Intl.NumberFormat("mn-MN");
const PRODUCTS_PER_PAGE = 15;

let productsCache = [];
let allProductsCache = [];
let currentProductsPage = 1;

// Services offered by hairdressers
const HAIR_SERVICES = [
  "Том хүн", "Хүүхэд", "Хэлбэрт", "Хуйхны цэвэрлэгээ", "Толгойн тос",
  "Хими / Sika", "Будаг (Уг)", "Будаг (Бүтэн)", "Омбре / Колор",
  "Эрэгтэй хими", "Чолк тайралт", "Угаалт", "Хусалт", "Сор",
  "Афра хими", "Гоёл / Засалт", "Хурим", "Сахал", "Шулуун хими",
  "Тэжээл", "Хими арчилгаа", "CICA нөхөн сэргээх эмчилгээ", "CMC тэжээл",
];

// Services offered by the manicurist
const MANICURE_SERVICES = [
  "Гелэн будалт", "Дип будаг", "Будаггүй маникюр", "Хумс нөхөлт (1 хумс)",
  "Хумсны гоёл (1 хумс)", "Будаг арилгалт", "Хумс салгалт", "Смарт хумс",
  "Гелин хумс", "Будаггүй педикюр", "Гель педикюр", "Гарын спа",
];

// Holds a reference to the current booking form's validation function so that
// service-checkbox change events (outside the summary panel) can trigger it.
let _validateBookingFn = null;

// Client-side copy of stylist prices/levels (mirrors config/stylists.js).
// Note: keep this in sync with the server-side config when stylist pricing changes.
const STYLIST_CONFIG_CLIENT = {
  'Оюунсүрэн':       { price: 20000, level: 'Мастер үсчин' },
  'Бадамцэцэг':      { price: 20000, level: 'Мастер үсчин' },
  'Ананд':           { price: 20000, level: 'Мастер үсчин' },
  'Мухлай':          { price: 20000, level: 'Мастер үсчин' },
  'Батзаяа':         { price: 10000, level: '1-р зэргийн үсчин' },
  'Уянга':           { price: 10000, level: '1-р зэргийн үсчин' },
  'Отгонжаргал':     { price: 10000, level: '1-р зэргийн үсчин' },
  'Тэргэл':          { price: 10000, level: '1-р зэргийн үсчин' },
  'Г. Мөнхзаяа':     { price: 20000, level: 'Маникюр', durationMinutes: 90 },
};

const SERVICE_IMAGE_MAP = {
  "будаг": ["files/Budag.jpeg"],
  "оффис колор": ["files/OfficeColor.png"],
  "холливуд ороолт": ["files/HollywoodOroolt.jpeg"],
  "элегант ороолт": ["files/EleganceOroolt.jpeg"],
  "оффис ороолт": ["files/OfficeOroolt.jpeg"],
  "эмчилгээний хими": [
    "files/EmchilgeeHimi.jpeg",
    "files/EmchilgeeHimi1.jpg",
    "files/EmchilgeeHimi2.jpg",
  ],
};

let serviceImageModal;
let serviceImageModalTitle;
let serviceImageModalRow;

function normalizeServiceName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function getServiceImages(serviceName) {
  const key = normalizeServiceName(serviceName);
  return SERVICE_IMAGE_MAP[key] || [];
}

function createServiceImageButtonMarkup(serviceName) {
  const images = getServiceImages(serviceName);
  if (images.length === 0) return "";
  return `<button class="service-image-btn" type="button" data-service="${encodeURIComponent(serviceName)}">Зураг харах</button>`;
}

function ensureServiceImageModal() {
  if (serviceImageModal) return;

  serviceImageModal = document.createElement("div");
  serviceImageModal.className = "service-image-modal";
  serviceImageModal.setAttribute("aria-hidden", "true");
  serviceImageModal.setAttribute("role", "dialog");
  serviceImageModal.innerHTML = `
    <div class="service-image-modal-backdrop" data-service-image-close></div>
    <div class="service-image-modal-content" role="document">
      <button class="service-image-modal-close" type="button" aria-label="Close" data-service-image-close>×</button>
      <h3 class="service-image-modal-title"></h3>
      <div class="service-image-modal-row"></div>
    </div>
  `;

  document.body.appendChild(serviceImageModal);
  serviceImageModalTitle = serviceImageModal.querySelector(".service-image-modal-title");
  serviceImageModalRow = serviceImageModal.querySelector(".service-image-modal-row");

  serviceImageModal.addEventListener("click", (event) => {
    const target = event.target;
    if (target?.matches("[data-service-image-close]")) {
      closeServiceImageModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && serviceImageModal?.classList.contains("is-open")) {
      closeServiceImageModal();
    }
  });
}

function closeServiceImageModal() {
  if (!serviceImageModal) return;
  serviceImageModal.classList.remove("is-open");
  serviceImageModal.setAttribute("aria-hidden", "true");
  if (serviceImageModalRow) {
    serviceImageModalRow.innerHTML = "";
  }
}

function openServiceImageModal(serviceName) {
  const images = getServiceImages(serviceName);
  if (images.length === 0) return;

  ensureServiceImageModal();

  if (serviceImageModalTitle) {
    serviceImageModalTitle.textContent = serviceName;
  }

  if (serviceImageModalRow) {
    serviceImageModalRow.innerHTML = "";
    images.forEach((src, index) => {
      const img = document.createElement("img");
      img.className = "service-image-modal-item";
      img.src = src;
      img.alt = `${serviceName} зураг ${index + 1}`;
      img.loading = "lazy";
      serviceImageModalRow.appendChild(img);
    });
  }

  serviceImageModal.classList.add("is-open");
  serviceImageModal.setAttribute("aria-hidden", "false");
}

function formatRange(min, max) {
  if (min === undefined || min === null) {
    // Single price mode
    return `${formatter.format(max)} ₮`;
  }
  if (min === max) {
    return `${formatter.format(min)} ₮`;
  }
  return `${formatter.format(min)} – ${formatter.format(max)} ₮`;
}

function formatPrice(price) {
  return `${formatter.format(price)} ₮`;
}

function renderPricing(pricingData) {
  if (!pricingGrid) return;
  pricingGrid.innerHTML = "";
  
  if (serviceSelect) {
    serviceSelect.innerHTML = '<option value="">Үйлчилгээ сонгох</option>';
  }

  // Render each category
  Object.values(pricingData).forEach((category, categoryIndex) => {
    // Category header
    const categoryHeader = document.createElement("div");
    categoryHeader.className = "pricing-category-header";
    categoryHeader.textContent = category.category;
    pricingGrid.appendChild(categoryHeader);

    // Check if category has subcategories (new structure)
    if (category.subcategories) {
      category.subcategories.forEach((subcategory, subIndex) => {
        const subcategoryId = `subcategory-${categoryIndex}-${subIndex}`;

        // Subcategory header (always visible)
        const subcategoryHeader = document.createElement("div");
        subcategoryHeader.className = "pricing-subcategory-header";
        subcategoryHeader.innerHTML = `
          <div class="subcategory-label">
            <div class="group-header">
              <h3>${subcategory.name}</h3>
            </div>
          </div>
        `;
        pricingGrid.appendChild(subcategoryHeader);

        const subcategoryContainer = document.createElement("div");
        subcategoryContainer.id = subcategoryId;
        subcategoryContainer.className = "subcategory-services";

        // Render services in subcategory
        subcategory.services.forEach((service) => {
          const imageButtonMarkup = createServiceImageButtonMarkup(service.name);
          if (service.variants) {
            // Service with variants - collapsible
            const groupId = `group-${service.name.replace(/\s+/g, "-")}`;
            const groupCard = document.createElement("div");
            groupCard.className = "price-card price-group";

            // Calculate min/max from variants (or just use first price if single price)
            let minPrice = Infinity;
            let maxPrice = 0;
            service.variants.forEach((variant) => {
              if (variant.price !== undefined) {
                minPrice = Math.min(minPrice, variant.price);
                maxPrice = Math.max(maxPrice, variant.price);
              } else {
                minPrice = Math.min(minPrice, variant.min);
                maxPrice = Math.max(maxPrice, variant.max);
              }
            });

            const priceDisplay = minPrice === maxPrice ? formatPrice(maxPrice) : formatRange(minPrice, maxPrice);

            groupCard.innerHTML = `
              <div class="group-header-label">
                <div class="group-header">
                  <h4>${service.name}</h4>
                </div>
                <div class="price">${priceDisplay}</div>
                <div class="muted">${service.variants.length} сонголт</div>
              </div>
              ${imageButtonMarkup}
            `;
            subcategoryContainer.appendChild(groupCard);

            // Variants container
            const variantsContainer = document.createElement("div");
            variantsContainer.id = groupId;
            variantsContainer.className = "price-variants";

            service.variants.forEach((variant) => {
              const variantCard = document.createElement("div");
              variantCard.className = "price-variant";
              const priceText = variant.price !== undefined ? formatPrice(variant.price) : formatRange(variant.min, variant.max);
              variantCard.innerHTML = `
                <div class="variant-name">${variant.type}</div>
                <div class="price">${priceText}</div>
              `;
              variantsContainer.appendChild(variantCard);

              // Add to service select
              if (serviceSelect) {
                const option = document.createElement("option");
                option.value = `${service.name} - ${variant.type}`;
                option.textContent = `${service.name} (${variant.type}) - ${priceText}`;
                serviceSelect.appendChild(option);
              }
            });

            groupCard.appendChild(variantsContainer);
          } else {
            // Single service without variants
            const card = document.createElement("div");
            card.className = "price-card";
            const priceText = service.price !== undefined ? formatPrice(service.price) : formatRange(service.min, service.max);
            card.innerHTML = `
              <h4>${service.name}</h4>
              <div class="price">${priceText}</div>
              <div class="muted">Үнэ</div>
              ${imageButtonMarkup}
            `;
            subcategoryContainer.appendChild(card);

            // Add to service select
            if (serviceSelect) {
              const option = document.createElement("option");
              option.value = service.name;
              option.textContent = `${service.name} - ${priceText}`;
              serviceSelect.appendChild(option);
            }
          }
        });

        pricingGrid.appendChild(subcategoryContainer);
      });
    } else {
      // Old structure with services or variants
      category.services.forEach((service) => {
        const imageButtonMarkup = createServiceImageButtonMarkup(service.name);
        if (service.variants) {
          // Service with variants - collapsible
          const groupId = `group-${service.name.replace(/\s+/g, "-")}`;
          const groupCard = document.createElement("div");
          groupCard.className = "price-card price-group";

          // Calculate min/max from variants
          let minPrice = Infinity;
          let maxPrice = 0;
          service.variants.forEach((variant) => {
            if (variant.price !== undefined) {
              minPrice = Math.min(minPrice, variant.price);
              maxPrice = Math.max(maxPrice, variant.price);
            } else {
              minPrice = Math.min(minPrice, variant.min);
              maxPrice = Math.max(maxPrice, variant.max);
            }
          });

          const priceDisplay = minPrice === maxPrice ? formatPrice(maxPrice) : formatRange(minPrice, maxPrice);

          groupCard.innerHTML = `
            <div class="group-header-label">
              <div class="group-header">
                <h4>${service.name}</h4>
              </div>
              <div class="price">${priceDisplay}</div>
              <div class="muted">${service.variants.length} сонголт</div>
            </div>
            ${imageButtonMarkup}
          `;
          pricingGrid.appendChild(groupCard);

          // Variants container
          const variantsContainer = document.createElement("div");
          variantsContainer.id = groupId;
          variantsContainer.className = "price-variants";

          service.variants.forEach((variant) => {
            const variantCard = document.createElement("div");
            variantCard.className = "price-variant";
            const priceText = variant.price !== undefined ? formatPrice(variant.price) : formatRange(variant.min, variant.max);
            variantCard.innerHTML = `
              <div class="variant-name">${variant.type}</div>
              <div class="price">${priceText}</div>
            `;
            variantsContainer.appendChild(variantCard);

            // Add to service select
            if (serviceSelect) {
              const option = document.createElement("option");
              option.value = `${service.name} - ${variant.type}`;
              option.textContent = `${service.name} (${variant.type}) - ${priceText}`;
              serviceSelect.appendChild(option);
            }
          });

          groupCard.appendChild(variantsContainer);
        } else {
          // Single service without variants
          const card = document.createElement("div");
          card.className = "price-card";
          const priceText = service.price !== undefined ? formatPrice(service.price) : formatRange(service.min, service.max);
          card.innerHTML = `
            <h4>${service.name}</h4>
            <div class="price">${priceText}</div>
            <div class="muted">Үнэ</div>
            ${imageButtonMarkup}
          `;
          pricingGrid.appendChild(card);

          // Add to service select
          if (serviceSelect) {
            const option = document.createElement("option");
            option.value = service.name;
            option.textContent = `${service.name} - ${priceText}`;
            serviceSelect.appendChild(option);
          }
        }
      });
    }
  });

  // Attach image button listeners
  document.querySelectorAll(".service-image-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const serviceName = decodeURIComponent(btn.dataset.service || "");
      openServiceImageModal(serviceName);
    });
  });
}

async function loadPricing() {
  try {
    const response = await fetch("data/pricing.json");
    if (!response.ok) throw new Error("Failed to load pricing");
    const data = await response.json();
    renderPricing(data);
  } catch (error) {
    console.error("Error loading pricing:", error);
  }
}

async function loadProducts() {
  try {
    const response = await fetch("data/products.json");
    if (!response.ok) throw new Error("Failed to load products");
    const data = await response.json();
    renderProducts(data);
  } catch (error) {
    console.error("Error loading products:", error);
  }
}

function getProductPrefix(category) {
  const match = category.match(/^(\d+)\s/);
  return match ? match[1] : null;
}

function renderProductFilters(products) {
  const filtersContainer = document.getElementById("products-filters");
  if (!filtersContainer) return;

  // Extract unique prefixes and sort them
  const prefixes = new Set();
  let hasOther = false;
  
  products.forEach((product) => {
    const prefix = getProductPrefix(product.category);
    if (prefix) {
      prefixes.add(prefix);
    } else {
      hasOther = true;
    }
  });

  const sortedPrefixes = Array.from(prefixes).sort((a, b) => parseInt(a) - parseInt(b));

  filtersContainer.innerHTML = '<div class="filter-buttons">';
  
  // Add "All" button
  const allBtn = document.createElement("button");
  allBtn.className = "filter-btn active";
  allBtn.dataset.filter = "all";
  allBtn.textContent = "Бүгд";
  filtersContainer.appendChild(allBtn);

  // Add prefix buttons
  sortedPrefixes.forEach((prefix) => {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = prefix;
    btn.textContent = prefix;
    filtersContainer.appendChild(btn);
  });

  // Add "Бусад" (Other) button if there are products without numeric prefix
  if (hasOther) {
    const otherBtn = document.createElement("button");
    otherBtn.className = "filter-btn";
    otherBtn.dataset.filter = "other";
    otherBtn.textContent = "Бусад";
    filtersContainer.appendChild(otherBtn);
  }

  filtersContainer.innerHTML += "</div>";

  // Add filter event listeners
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter;
      filterProducts(filter);
      
      // Update active button
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function filterProducts(prefix) {
  if (prefix === "all") {
    productsCache = allProductsCache;
  } else if (prefix === "other") {
    productsCache = allProductsCache.filter((product) => {
      return getProductPrefix(product.category) === null;
    });
  } else {
    productsCache = allProductsCache.filter((product) => {
      return getProductPrefix(product.category) === prefix;
    });
  }
  currentProductsPage = 1;
  renderProductsPage(currentProductsPage);
}

function renderProducts(data) {
  const productsGrid = document.getElementById("products-grid");
  if (!productsGrid) return;
  allProductsCache = Array.isArray(data.products) ? data.products : [];
  productsCache = allProductsCache;
  currentProductsPage = 1;
  renderProductFilters(allProductsCache);
  renderProductsPage(currentProductsPage);
}

function renderProductsPage(page) {
  const productsGrid = document.getElementById("products-grid");
  if (!productsGrid) return;
  productsGrid.innerHTML = "";

  const totalProducts = productsCache.length;
  const totalPages = Math.ceil(totalProducts / PRODUCTS_PER_PAGE) || 1;
  const safePage = Math.min(Math.max(page, 1), totalPages);
  currentProductsPage = safePage;

  const startIndex = (safePage - 1) * PRODUCTS_PER_PAGE;
  const visibleProducts = productsCache.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);

  visibleProducts.forEach((product) => {
    const productCard = document.createElement("div");
    productCard.className = "product-card";
    const priceDisplay = formatter.format(product.price);
    productCard.innerHTML = `
      <div class="product-image">
        <img src="${product.image}" alt="${product.name}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23161f1a%22 width=%22200%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2214%22 fill=%22%2364d39a%22 text-anchor=%22middle%22 dy=%22.3em%22%3EAmos Professional%3C/text%3E%3C/svg%3E'" />
      </div>
      <div class="product-info">
        <div class="product-category">${product.category}</div>
        <h4>${product.name}</h4>
        <div class="product-price">${priceDisplay} ₮</div>
      </div>
    `;
    productsGrid.appendChild(productCard);
  });

  renderProductsPagination(totalPages);
}

function renderProductsPagination(totalPages) {
  const pagination = document.getElementById("products-pagination");
  if (!pagination) return;
  pagination.innerHTML = "";

  if (totalPages <= 1) {
    pagination.style.display = "none";
    return;
  }

  pagination.style.display = "flex";

  for (let page = 1; page <= totalPages; page += 1) {
    const pageButton = document.createElement("button");
    pageButton.type = "button";
    pageButton.className = "page-btn";
    if (page === currentProductsPage) {
      pageButton.classList.add("active");
      pageButton.setAttribute("aria-current", "page");
    }
    pageButton.textContent = page;
    pageButton.addEventListener("click", () => {
      renderProductsPage(page);
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    });
    pagination.appendChild(pageButton);
  }
}

function getDayLabel(date) {
  const MN_WEEKDAYS = ['Ням', 'Дав', 'Мяг', 'Лха', 'Пүр', 'Баа', 'Бям'];
  const dayName = MN_WEEKDAYS[date.getDay()];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${dayName}, ${month}/${day}`;
}

function formatDateInput(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split("T")[0];
}

function renderDayStrip(startDate = new Date()) {
  dayStrip.innerHTML = "";
  const today = new Date(startDate);
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(today);
    day.setDate(today.getDate() + i);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-btn";
    btn.dataset.date = formatDateInput(day);
    btn.innerHTML = `<div>${getDayLabel(day)}</div>`;
    btn.addEventListener("click", () => selectDay(btn.dataset.date));
    dayStrip.appendChild(btn);
  }
  selectDay(formatDateInput(today));
}

/**
 * Generate all possible booking time slot strings for the given date.
 *
 * For the manicurist (Г. Мөнхзаяа / Маникюр service), a fixed set of slots is
 * returned. On Sundays (salon opens at 11:00) a different set is used:
 *   Mon–Sat: ["10:00", "11:30", "13:00", "14:30", "16:00", "18:00"]  (6 slots)
 *   Sun:     ["11:00", "12:30", "14:00", "15:30", "17:30"]            (5 slots)
 *
 * For all other stylists, 1-hour slots are generated from business hours:
 *   Mon–Sat (getDay 1–6): 10:00–19:00  (10 slots)
 *   Sun     (getDay 0):   11:00–18:00  ( 8 slots)
 *
 * @param {string} dateStr        YYYY-MM-DD
 * @param {number} durationMinutes
 * @param {string} [stylistId]    Stylist identifier (used to detect manicurist)
 * @returns {string[]}  e.g. ["10:00", "11:00", ..., "19:00"]
 */
function generateTimeSlots(dateStr, durationMinutes = 60, stylistId = "") {
  // Use noon to avoid UTC-midnight timezone shift affecting getDay()
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const isSunday = dayOfWeek === 0;

  // Hardcoded slots for the manicurist: exact times requested by the salon.
  // On Sundays the salon opens at 11:00, so a different set of slots is used.
  if (stylistId.includes("Мөнхзаяа") || stylistId.includes("Маникюр")) {
    const hardcodedSlots = isSunday
      ? ["11:00", "12:30", "14:00", "15:30", "17:30"]
      : ["10:00", "11:30", "13:00", "14:30", "16:00", "18:00"];
    const now = new Date();
    const todayStr = formatDateInput(now);
    if (dateStr !== todayStr) return hardcodedSlots;
    return hardcodedSlots.filter((slot) => {
      const [hour, minute] = slot.split(":").map(Number);
      const slotDate = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
      return slotDate >= now;
    });
  }

  const startHour = isSunday ? 11 : 10;
  const workEndHour = isSunday ? 19 : 20;
  const lastSlotHour = workEndHour - durationMinutes / 60;
  const slots = [];

  // For today, skip slots that have already started.
  // Note: this fallback uses the browser's local time. The backend API
  // is the authoritative source and always uses the salon's UTC+8 timezone.
  const now = new Date();
  const todayStr = formatDateInput(now);
  const isToday = dateStr === todayStr;

  for (let h = startHour; h <= lastSlotHour; h++) {
    if (isToday) {
      const slotDate = new Date(`${dateStr}T${String(h).padStart(2, "0")}:00:00`);
      if (slotDate < now) continue;
    }
    slots.push(`${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

/**
 * Fetch available slots from the backend calendar API and render them.
 * Slot duration is 90 minutes for the manicurist (Г. Мөнхзаяа) and 60 minutes
 * for all other stylists. Triggered whenever the user changes the date or stylist.
 */
async function fetchAvailableSlots(date, stylistId) {
  const container = document.getElementById("available-time-slots");
  if (!container) return;
  container.innerHTML = '<p class="slots-hint">Уншиж байна...</p>';
  const summaryEl = document.getElementById("booking-summary");
  if (summaryEl) summaryEl.style.display = "none";

  const stylistSel = document.getElementById("stylist-select");
  if (stylistSel) stylistSel.disabled = true;

  const durationMinutes = (STYLIST_CONFIG_CLIENT[stylistId] || {}).durationMinutes || 60;

  try {
    const res = await fetch(
      `/api/calendar/available-slots?date=${encodeURIComponent(date)}&stylistId=${encodeURIComponent(stylistId)}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.details || err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderAvailableSlots(data.availableSlots, stylistId, date);
  } catch (err) {
    console.error("Failed to fetch available slots:", err);
    // Fall back to showing all business-hours slots for the day (booked-slot
    // filtering is unavailable without the API, but the correct hours are shown).
    renderAvailableSlots(generateTimeSlots(date, durationMinutes, stylistId), stylistId, date);
  } finally {
    if (stylistSel) stylistSel.disabled = false;
  }
}

/**
 * Render the array of available time strings as clickable slot buttons.
 */
function renderAvailableSlots(slots, stylistId, date) {
  const container = document.getElementById("available-time-slots");
  if (!container) return;
  container.innerHTML = "";

  // Client-side guard: hide any slot that has already passed when viewing today.
  const now = new Date();
  const todayStr = formatDateInput(now);
  const isToday = date === todayStr;
  const filteredSlots = isToday
    ? (slots || []).filter((time) => new Date(`${date}T${time}:00`) >= now)
    : (slots || []);

  if (filteredSlots.length === 0) {
    container.innerHTML = '<p class="slots-hint">Тухайн өдөрт чөлөөт цаг байхгүй байна.</p>';
    return;
  }

  filteredSlots.forEach((time) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "time-slot";
    btn.textContent = time;
    btn.addEventListener("click", () => {
      Array.from(container.querySelectorAll(".time-slot")).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTime = time;
      showBookingSummary(stylistId, date, time);
    });
    container.appendChild(btn);
  });
}

/**
 * Display a booking summary panel with customer inputs and a "Confirm & Pay" button that
 * triggers QPay when clicked.
 */
function showBookingSummary(stylistId, date, time) {
  const summaryEl = document.getElementById("booking-summary");
  if (!summaryEl) return;
  const stylist = STYLIST_CONFIG_CLIENT[stylistId] || { price: 10000, level: "" };
  const levelText = stylist.level ? ` (${stylist.level})` : "";

  // Determine price based on the stylist's tier name (text-based conditional logic).
  const levelStr = stylist.level;
  let price;
  if (levelStr.includes("Мастер") || levelStr.includes("Маникюр")) {
    price = 20000;
  } else if (levelStr.includes("1-р зэргийн")) {
    price = 10000;
  } else {
    price = 10000;
  }
  const priceText = `${formatter.format(price)} ₮`;

  summaryEl.innerHTML = `
    <h4 class="summary-title">Захиалгын мэдээлэл</h4>
    <div class="summary-item"><span>Үсчин:</span> <strong>${stylistId}${levelText}</strong></div>
    <div class="summary-item"><span>Өдөр:</span> <strong>${date}</strong></div>
    <div class="summary-item"><span>Цаг:</span> <strong>${time}</strong></div>
    <div class="summary-item"><span>Үнэ:</span> <strong>${priceText}</strong></div>
    <div class="customer-input-group">
      <label for="customer-name">Нэр</label>
      <input type="text" id="customer-name" name="customer-name" placeholder="Таны нэр" autocomplete="name" />
    </div>
    <div class="customer-input-group">
      <label for="customer-phone">Утасны дугаар</label>
      <input type="tel" id="customer-phone" name="customer-phone" placeholder="Утасны дугаар" autocomplete="tel" />
    </div>
    <button type="button" class="primary-btn confirm-pay-btn" disabled>Баталгаажуулж төлөх</button>
  `;
  summaryEl.style.display = "block";

  const confirmBtn = summaryEl.querySelector(".confirm-pay-btn");
  const nameInput  = document.getElementById("customer-name");
  const phoneInput = document.getElementById("customer-phone");

  function validateBookingForm() {
    const nameVal  = (nameInput?.value  || "").trim();
    const phoneVal = (phoneInput?.value || "").trim();
    const hasService = document.querySelectorAll(".service-checkbox:checked").length > 0;
    confirmBtn.disabled = !(nameVal.length > 0 && phoneVal.length > 0 && hasService);
  }

  // Register this summary's validation function so service-checkbox changes can trigger it.
  _validateBookingFn = validateBookingForm;

  nameInput?.addEventListener("input",  validateBookingForm);
  phoneInput?.addEventListener("input", validateBookingForm);

  summaryEl.querySelector(".confirm-pay-btn").onclick = () => {
    const customerName  = (nameInput?.value  || "").trim();
    const customerPhone = (phoneInput?.value || "").trim();

    if (!customerName || !customerPhone) {
      alert("Нэр болон утасны дугаараа оруулна уу.");
      return;
    }

    const checkedServices = Array.from(
      document.querySelectorAll(".service-checkbox:checked")
    ).map((cb) => cb.value);

    if (checkedServices.length === 0) {
      alert("Дор хаяж нэг үйлчилгээ сонгоно уу.");
      return;
    }

    const selectedServices = checkedServices.join(", ");

    initiateQPayPayment({
      amount: price,
      name: customerName,
      phone: customerPhone,
      description: `Matrix Eco: ${stylistId} - ${date} ${time} - ${customerName} - ${customerPhone}`,
      staffName: stylistId,
      selectedServices,
      confirmBtn,
      bookingDetails: { stylistId, date, time },
    });
  };

  try {
    summaryEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (_) {
    summaryEl.scrollIntoView();
  }
}

function selectDay(dateString) {
  selectedDate = dateString;
  Array.from(dayStrip.children).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.date === dateString);
  });
  selectedTime = null;

  const stylistSel = document.getElementById("stylist-select");
  if (stylistSel && stylistSel.value) {
    fetchAvailableSlots(dateString, stylistSel.value);
  } else {
    const avail = document.getElementById("available-time-slots");
    if (avail) avail.innerHTML = '<p class="slots-hint">Үсчинг сонгоно уу.</p>';
  }
  const summaryEl = document.getElementById("booking-summary");
  if (summaryEl) summaryEl.style.display = "none";
}

/**
 * Render service checkboxes inside #service-checkboxes based on the selected stylist.
 * Uses MANICURE_SERVICES for Г. Мөнхзаяа, HAIR_SERVICES for all others.
 * Clears the container when no stylist is selected.
 */
function renderServiceCheckboxes(stylistId) {
  const container = document.getElementById("service-checkboxes");
  if (!container) return;

  if (!stylistId) {
    container.innerHTML = "";
    return;
  }

  const stylistCfg = STYLIST_CONFIG_CLIENT[stylistId];
  const services =
    stylistCfg?.level === "Маникюр" ? MANICURE_SERVICES : HAIR_SERVICES;

  container.innerHTML = "";

  const title = document.createElement("div");
  title.className = "service-checkboxes-title";
  title.textContent = "Үйлчилгээ сонгох";
  container.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "service-checkboxes-grid";

  services.forEach((s) => {
    const label = document.createElement("label");
    label.className = "service-checkbox-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "service-checkbox";
    input.value = s;

    const text = document.createTextNode(s);

    label.appendChild(input);
    label.appendChild(text);
    grid.appendChild(label);
  });

  container.appendChild(grid);
}

/**
 * Reset the booking form to its initial state.
 * Called after a successful payment or when the user navigates back.
 */
function resetBookingForm() {
  selectedTime = null;
  selectedDate = null;
  _validateBookingFn = null;
  const successEl = document.getElementById("booking-success-message");
  if (successEl) successEl.style.display = "none";
  const summaryEl = document.getElementById("booking-summary");
  if (summaryEl) summaryEl.style.display = "none";
  const stylistSel = document.getElementById("stylist-select");
  if (stylistSel) stylistSel.value = "";
  renderServiceCheckboxes("");
  const avail = document.getElementById("available-time-slots");
  if (avail) avail.innerHTML = '<p class="slots-hint">Үсчин болон өдрийг сонгоно уу.</p>';
  renderDayStrip(new Date());
}

todayBtn?.addEventListener("click", () => {
  renderDayStrip(new Date());
});

document.getElementById("stylist-select")?.addEventListener("change", (event) => {
  const summaryEl = document.getElementById("booking-summary");
  if (summaryEl) summaryEl.style.display = "none";
  renderServiceCheckboxes(event.target.value);
  if (event.target.value && selectedDate) {
    fetchAvailableSlots(selectedDate, event.target.value);
  } else {
    const avail = document.getElementById("available-time-slots");
    if (avail) avail.innerHTML = '<p class="slots-hint">Үсчин болон өдрийг сонгоно уу.</p>';
  }
});

// Re-validate the booking form whenever a service checkbox is toggled.
document.addEventListener("change", (event) => {
  if (event.target?.classList.contains("service-checkbox")) {
    if (typeof _validateBookingFn === "function") {
      _validateBookingFn();
    }
  }
});

// Only load pricing if element exists on this page
if (document.getElementById("pricing-grid")) {
  loadPricing();
}

// Only load products if element exists on this page
if (document.getElementById("products-grid")) {
  loadProducts();
}

// Initialize booking calendar and time slots (only on pages that contain booking UI)
if (dayStrip) {
  renderDayStrip(new Date());
  const avail = document.getElementById("available-time-slots");
  if (avail) avail.innerHTML = '<p class="slots-hint">Үсчин болон өдрийг сонгоно уу.</p>';
}

// Team modal functionality - only initialize if elements exist on this page
const teamModal = document.getElementById("team-modal");
const teamModalName = document.getElementById("team-modal-name");
const teamModalRole = document.getElementById("team-modal-role");
const teamModalSkill = document.getElementById("team-modal-skill");
const teamModalEducation = document.getElementById("team-modal-education");
const teamModalQualification = document.getElementById("team-modal-qualification");
const teamButtons = document.querySelectorAll(".team-more-btn");

if (teamButtons.length > 0 && teamModal) {
  function openTeamModal(button) {
    if (!teamModal || !button) return;
    teamModalName.textContent = button.dataset.name || "";
    teamModalRole.textContent = button.dataset.role || "";
    teamModalSkill.textContent = button.dataset.skill || "";
    teamModalEducation.textContent = button.dataset.education || "";
    teamModalQualification.textContent = button.dataset.qualification || "";
    teamModal.classList.add("is-open");
    teamModal.setAttribute("aria-hidden", "false");
  }

  function closeTeamModal() {
    if (!teamModal) return;
    teamModal.classList.remove("is-open");
    teamModal.setAttribute("aria-hidden", "true");
  }

  teamButtons.forEach((button) => {
    button.addEventListener("click", () => openTeamModal(button));
  });

  teamModal?.addEventListener("click", (event) => {
    const target = event.target;
    if (target?.matches("[data-team-modal-close]")) {
      closeTeamModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && teamModal?.classList.contains("is-open")) {
      closeTeamModal();
    }
  });
}

// Video popup support for stylist profiles
const videoButtons = document.querySelectorAll(".video-toggle");

if (videoButtons.length > 0) {
  const videoModal = document.createElement("div");
  videoModal.className = "video-popup-modal";
  videoModal.setAttribute("aria-hidden", "true");
  videoModal.setAttribute("role", "dialog");
  videoModal.innerHTML = `
    <div class="video-popup-backdrop" data-video-close></div>
    <div class="video-popup-content" role="document">
      <button class="video-popup-close" type="button" aria-label="Close" data-video-close>×</button>
      <video class="video-popup-player" controls playsinline preload="metadata"></video>
    </div>
  `;
  document.body.appendChild(videoModal);

  const videoPlayer = videoModal.querySelector(".video-popup-player");

  function closeVideoModal() {
    videoModal.classList.remove("is-open");
    videoModal.setAttribute("aria-hidden", "true");
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.removeAttribute("src");
      videoPlayer.load();
    }
  }

  function openVideoModal(videoSrc) {
    if (!videoPlayer || !videoSrc) return;
    videoPlayer.src = videoSrc;
    videoModal.classList.add("is-open");
    videoModal.setAttribute("aria-hidden", "false");

    const playPromise = videoPlayer.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // If autoplay is blocked, keep modal open and let user press play.
      });
    }
  }

  videoButtons.forEach((btn) => {
    const videoSrc = btn.dataset.video?.trim();
    if (!videoSrc) {
      btn.style.display = "none";
      return;
    }

    btn.addEventListener("click", () => openVideoModal(videoSrc));
  });

  videoModal.addEventListener("click", (event) => {
    const target = event.target;
    if (target?.matches("[data-video-close]")) {
      closeVideoModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && videoModal.classList.contains("is-open")) {
      closeVideoModal();
    }
  });
}

// ─── Keune Products ─────────────────────────────────────────
(function initKeune() {
  const keuneGrid = document.getElementById("keune-grid");
  const keuneFilters = document.getElementById("keune-filters");
  if (!keuneGrid) return; // Not on the Keune page

  let keuneAll = [];
  let keuneFiltered = [];

  // Detail modal (created once)
  let keuneModal = null;

  function ensureKeuneModal() {
    if (keuneModal) return;
    keuneModal = document.createElement("div");
    keuneModal.className = "keune-modal";
    keuneModal.setAttribute("aria-hidden", "true");
    keuneModal.innerHTML = `
      <div class="keune-modal-backdrop" data-keune-close></div>
      <div class="keune-modal-body">
        <button class="keune-modal-close" type="button" aria-label="Close" data-keune-close>×</button>
        <div class="keune-modal-scroll">
          <div class="keune-modal-header">
            <h3 class="keune-modal-title"></h3>
            <p class="keune-modal-desc"></p>
          </div>
          <div class="keune-modal-subproducts"></div>
          <div class="keune-modal-image-wrap">
            <img src="" alt="" />
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(keuneModal);

    keuneModal.addEventListener("click", (e) => {
      if (e.target.matches("[data-keune-close]")) closeKeuneModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && keuneModal?.classList.contains("is-open")) closeKeuneModal();
    });
  }

  function formatPrice(price) {
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "₮";
  }

  function openKeuneDetail(product) {
    ensureKeuneModal();
    const title = keuneModal.querySelector(".keune-modal-title");
    const desc = keuneModal.querySelector(".keune-modal-desc");
    const subWrap = keuneModal.querySelector(".keune-modal-subproducts");
    const imgWrap = keuneModal.querySelector(".keune-modal-image-wrap");
    const img = imgWrap.querySelector("img");

    title.textContent = product.name;
    desc.textContent = product.description;

    // Subproducts table
    const subs = product.subProducts || [];
    if (subs.length > 0) {
      subWrap.innerHTML = `
        <table class="keune-sub-table">
          <thead>
            <tr>
              <th>Бүтээгдэхүүн</th>
              <th>Хэмжээ</th>
              <th>Үнэ</th>
            </tr>
          </thead>
          <tbody>
            ${subs.map(s => `
              <tr>
                <td>
                  <div class="keune-sub-name">${s.name}</div>
                  <div class="keune-sub-name-mn">${s.nameMn}</div>
                </td>
                <td class="keune-sub-vol">${s.volume}</td>
                <td class="keune-sub-price">${formatPrice(s.price)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      subWrap.style.display = "block";
    } else {
      subWrap.innerHTML = "";
      subWrap.style.display = "none";
    }

    // Detail image
    if (product.detailImage) {
      img.src = product.detailImage;
      img.alt = product.name + " дэлгэрэнгүй";
      imgWrap.style.display = "block";
    } else {
      imgWrap.style.display = "none";
    }

    keuneModal.classList.add("is-open");
    keuneModal.setAttribute("aria-hidden", "false");
    // scroll to top
    keuneModal.querySelector(".keune-modal-scroll").scrollTop = 0;
  }

  function openKeuneModal(src, alt) {
    ensureKeuneModal();
    const title = keuneModal.querySelector(".keune-modal-title");
    const desc = keuneModal.querySelector(".keune-modal-desc");
    const subWrap = keuneModal.querySelector(".keune-modal-subproducts");
    const imgWrap = keuneModal.querySelector(".keune-modal-image-wrap");
    const img = imgWrap.querySelector("img");

    title.textContent = "";
    desc.textContent = "";
    subWrap.innerHTML = "";
    subWrap.style.display = "none";
    img.src = src;
    img.alt = alt;
    imgWrap.style.display = "block";

    keuneModal.classList.add("is-open");
    keuneModal.setAttribute("aria-hidden", "false");
  }

  function closeKeuneModal() {
    if (!keuneModal) return;
    keuneModal.classList.remove("is-open");
    keuneModal.setAttribute("aria-hidden", "true");
  }

  // Brand image lightbox
  document.querySelectorAll(".keune-brand-img").forEach((img) => {
    img.addEventListener("click", () => openKeuneModal(img.src, img.alt || "Keune"));
  });

  // Category filters
  function renderKeuneFilters() {
    if (!keuneFilters) return;
    const categories = [...new Set(keuneAll.map((p) => p.category))].sort();
    keuneFilters.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.className = "filter-btn active";
    allBtn.textContent = "Бүгд";
    allBtn.addEventListener("click", () => {
      keuneFiltered = keuneAll;
      renderKeuneGrid();
      setActiveFilter(allBtn);
    });
    keuneFilters.appendChild(allBtn);

    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        keuneFiltered = keuneAll.filter((p) => p.category === cat);
        renderKeuneGrid();
        setActiveFilter(btn);
      });
      keuneFilters.appendChild(btn);
    });
  }

  function setActiveFilter(activeBtn) {
    keuneFilters.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    activeBtn.classList.add("active");
  }

  // Product grid
  function renderKeuneGrid() {
    keuneGrid.innerHTML = "";

    keuneFiltered.forEach((product) => {
      const card = document.createElement("div");
      card.className = "keune-card";

      const hasDetail = !!product.detailImage;
      const hasSubs = product.subProducts && product.subProducts.length > 0;
      const hasMore = hasDetail || hasSubs;

      card.innerHTML = `
        <img class="keune-card-img" src="${product.image}" alt="${product.name}"
             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22260%22 height=%22260%22%3E%3Crect fill=%22%23121f1a%22 width=%22260%22 height=%22260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-size=%2214%22 fill=%22%2364d39a%22 text-anchor=%22middle%22 dy=%22.3em%22%3EKeune%3C/text%3E%3C/svg%3E'" />
        <div class="keune-card-body">
          <span class="keune-card-cat">${product.category}</span>
          <h4>${product.name}</h4>
          <p class="keune-card-desc">${product.description}</p>
          ${hasMore ? '<span class="keune-card-badge">Дэлгэрэнгүй харах →</span>' : ""}
        </div>
      `;

      if (hasMore) {
        card.addEventListener("click", () => openKeuneDetail(product));
      }

      keuneGrid.appendChild(card);
    });
  }

  // Load data
  async function loadKeuneProducts() {
    try {
      const res = await fetch("data/keune-products.json");
      if (!res.ok) throw new Error("Failed to load Keune products");
      const data = await res.json();
      keuneAll = Array.isArray(data.products) ? data.products : [];
      keuneFiltered = keuneAll;
      renderKeuneFilters();
      renderKeuneGrid();
    } catch (err) {
      console.error("Error loading Keune products:", err);
      keuneGrid.innerHTML = '<p style="text-align:center;color:var(--muted);">Бүтээгдэхүүнийг ачаалахад алдаа гарлаа.</p>';
    }
  }

  loadKeuneProducts();
})();

// ---------------------------------------------------------------------------
// QPay Payment Integration
// ---------------------------------------------------------------------------

/**
 * Fetch a QPay QR code + mobile deep-links for the given booking and render
 * them inside #qpay-panel.
 *
 * @param {object} params
 * @param {string|number} params.amount        - Amount in MNT
 * @param {string} params.name                 - Customer's full name
 * @param {string} params.phone                - Customer's phone number
 * @param {string} params.description          - Full booking description for calendar (stored server-side)
 * @param {HTMLButtonElement} [params.confirmBtn] - The button that triggered the call (for loading state)
 * @param {object} [params.bookingDetails]     - { stylistId, date, time } for the success screen
 */
async function initiateQPayPayment({ amount, name, phone, description, staffName, selectedServices, confirmBtn, bookingDetails }) {
  const panel     = document.getElementById("qpay-panel");
  const qrImg     = document.getElementById("qpay-qr-img");
  const bankBtns  = document.getElementById("qpay-bank-buttons");
  const errorEl   = document.getElementById("qpay-error");
  const successEl = document.getElementById("booking-success-message");

  // Show loading state on the Confirm button
  const confirmBtnOriginalText = confirmBtn ? confirmBtn.textContent : "";
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Түр хүлээнэ үү...";
  }

  // Track the active confirm button globally so the close handler can re-enable it
  // when the user dismisses the QR panel before completing payment.
  qpayActiveConfirmBtn = confirmBtn;
  qpayActiveConfirmBtnText = confirmBtnOriginalText;

  // Cancel any previous poll that may be running
  if (qpayPollInterval) {
    clearInterval(qpayPollInterval);
    qpayPollInterval = null;
  }

  // Reset previous state
  errorEl.style.display = "none";
  errorEl.textContent   = "";
  bankBtns.innerHTML    = "";
  qrImg.src             = "";
  panel.style.display   = "block";

  // Add a close button to the panel if it doesn't already have one
  if (!panel.querySelector(".qpay-panel-close")) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "qpay-panel-close";
    closeBtn.setAttribute("aria-label", "Хаах");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => {
      if (qpayPollInterval) {
        clearInterval(qpayPollInterval);
        qpayPollInterval = null;
      }
      // Re-enable the confirm button so the user can retry the payment
      if (qpayActiveConfirmBtn) {
        qpayActiveConfirmBtn.disabled = false;
        qpayActiveConfirmBtn.textContent = qpayActiveConfirmBtnText || CONFIRM_BTN_DEFAULT_TEXT;
        qpayActiveConfirmBtn = null;
        qpayActiveConfirmBtnText = "";
      }
      panel.style.display = "none";
    });
    panel.insertBefore(closeBtn, panel.firstChild);
  }

  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const response = await fetch("/api/qpay/create-payment", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ amount, name, phone, description, staffName }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Display the Base64 QR code image
    if (data.qr_image) {
      qrImg.src = data.qr_image.startsWith("data:")
        ? data.qr_image
        : `data:image/png;base64,${data.qr_image}`;
      qrImg.alt = "QPay QR код";
    }

    // Render a clickable button for each bank deep-link
    if (Array.isArray(data.urls) && data.urls.length > 0) {
      data.urls.forEach(function (entry) {
        const a = document.createElement("a");
        a.href      = entry.link;
        a.className = "qpay-bank-btn";
        a.target    = "_blank";
        a.rel       = "noopener noreferrer";
        a.textContent = entry.name || "Банкны апп";
        a.setAttribute("aria-label", entry.name ? `Pay with ${entry.name}` : "Pay with bank app");
        bankBtns.appendChild(a);
      });
    }

    // Normalise across the different field names the API may return.
    const invoice_id = data.invoice_id || data.qpay_invoice_id || data.id || null;

    // Start polling for payment confirmation if we have an invoice_id
    try {
      if (invoice_id) {
        const MAX_POLL_ATTEMPTS = 100; // 5 minutes at 3-second intervals
        let pollAttempts = 0;
        console.log("QR rendered. Starting poll for invoice:", invoice_id);
        qpayPollInterval = setInterval(async () => {
          if (!invoice_id) {
            console.error("No invoice ID to check!");
            clearInterval(qpayPollInterval);
            qpayPollInterval = null;
            return;
          }
          pollAttempts++;
          if (pollAttempts > MAX_POLL_ATTEMPTS) {
            clearInterval(qpayPollInterval);
            qpayPollInterval = null;
            console.warn('QPay polling timed out for invoice:', invoice_id);
            return;
          }
          try {
            const pollRes = await fetch("/api/qpay/check-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ invoice_id: invoice_id }),
            });
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();
          console.log("QPay Check Response:", pollData);
          // QPay may return success in several different shapes depending on
          // the API version or endpoint used.  Check all known variants:
          //   invoice_status  – /check-payment in-memory status
          //   status          – top-level status field
          //   payment_status  – flat payment_status field
          //   payment_info.payment_status – nested payment info object
          //   paid            – boolean shorthand
          //   rows[0].payment_status – array-based response
          const isPaid =
            pollData.invoice_status === "PAID" ||
            pollData.status === "PAID" ||
            pollData.payment_status === "PAID" ||
            pollData.payment_info?.payment_status === "PAID" ||
            pollData.paid === true ||
            (pollData.rows && pollData.rows.length > 0 && pollData.rows[0].payment_status === "PAID");
          if (isPaid) {
            clearInterval(qpayPollInterval);
            qpayPollInterval = null;

            // Payment confirmed — clear the tracked confirm button reference so
            // the close handler no longer attempts to re-enable it.
            qpayActiveConfirmBtn = null;
            qpayActiveConfirmBtnText = "";

            // Hide the QR panel and booking summary immediately
            panel.style.display = "none";
            const summaryEl = document.getElementById("booking-summary");
            if (summaryEl) summaryEl.style.display = "none";

            // Show a loading/confirming message while we register the booking
            if (successEl) {
              successEl.innerHTML = `
                <div class="booking-confirming">
                  <div class="booking-spinner"></div>
                  <p class="booking-confirming-text">Төлбөр баталгаажиж байна. Түр хүлээнэ үү...</p>
                </div>
              `;
              successEl.style.display = "block";
              try {
                successEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
              } catch (_) {
                successEl.scrollIntoView();
              }
            }

            // Trigger the Google Calendar booking
            const { stylistId = "", date = "", time = "" } = bookingDetails || {};
            const startTime = date && time ? `${date}T${time}:00+08:00` : "";
            const calendarErrorMsg = "Төлбөр төлөгдсөн ч цаг бүртгэхэд алдаа гарлаа. Бидэнтэй холбогдоно уу.";

            function showCalendarError() {
              if (!successEl) return;
              successEl.innerHTML = `
                <p class="booking-error-text">${calendarErrorMsg}</p>
                <button type="button" class="primary-btn booking-close-btn">Хаах</button>
              `;
              successEl.querySelector(".booking-close-btn")?.addEventListener("click", () => {
                resetBookingForm();
              });
            }

            try {
              const bookRes = await fetch("/api/calendar/book", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  stylistId,
                  startTime,
                  customerName: name,
                  customerPhone: phone,
                  selectedServices,
                }),
              });

              if (successEl) {
                if (bookRes.ok) {
                  // Final confirmed success state
                  successEl.innerHTML = `
                    <span class="booking-success-icon">✓</span>
                    <h3 class="booking-success-title">Амжилттай! Таны цаг захиалга баталгаажлаа.</h3>
                    <div class="booking-success-details">
                      <div class="summary-item"><span>Үсчин:</span> <strong class="js-success-stylist"></strong></div>
                      <div class="summary-item"><span>Өдөр:</span>  <strong class="js-success-date"></strong></div>
                      <div class="summary-item"><span>Цаг:</span>   <strong class="js-success-time"></strong></div>
                    </div>
                    <button type="button" class="primary-btn booking-close-btn">Хаах</button>
                  `;
                  successEl.querySelector(".js-success-stylist").textContent = stylistId;
                  successEl.querySelector(".js-success-date").textContent    = date;
                  successEl.querySelector(".js-success-time").textContent    = time;
                  successEl.querySelector(".booking-close-btn")?.addEventListener("click", () => {
                    resetBookingForm();
                  });
                } else {
                  // Calendar API returned a non-OK status
                  showCalendarError();
                }
              }
            } catch (_) {
              // Network error calling the calendar endpoint
              showCalendarError();
            }
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 3000);
      }
    } catch (e) {
      console.error("Error setting up QR/Polling:", e);
    }
  } catch (err) {
    console.error("QPay payment error:", err);
    errorEl.textContent  = `Төлбөр үүсгэхэд алдаа гарлаа: ${err.message}`;
    errorEl.style.display = "block";
    // Revert loading state on error so the user can try again
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = confirmBtnOriginalText || CONFIRM_BTN_DEFAULT_TEXT;
    }
  }
}

// ── Mobile Navigation Toggle ──────────────────────────────────────────────────
(function () {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (!navToggle || !nav) return;

  navToggle.addEventListener('click', function () {
    const isOpen = nav.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    navToggle.innerHTML = isOpen ? '&#10005;' : '&#9776;';
  });

  // Close the menu when any nav link is clicked
  nav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      nav.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.innerHTML = '&#9776;';
    });
  });
}());
