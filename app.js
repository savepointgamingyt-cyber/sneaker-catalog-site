
// =========================
// НАСТРОЙКИ (поменяй 2 строки)
// =========================
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jBSjWhb8LlSj_nyeq_yQhRh889UhEwV-HjQM1MFNsA6Ou3ISYiaZYpBkBdPdxVJbwlB4TxsYHuiK/pub?gid=185458680&single=true&output=csv";
const TG_USERNAME = "Kuharen7"; // без @
const TG_CHANNEL_URL = `https://t.me/${TG_USERNAME}`; // ссылка на канал/профиль для кнопки "забрать код"
// (необязательно) CSV с промокодами (лист PROMO → Опубликовать в интернете → CSV)
// Колонки: code,type,value,min_price,active
// Пример: ROOM300,fixed,300,2500,TRUE
const PROMO_CSV_URL = ""; // вставь CSV ссылку на лист PROMO (если хочешь управлять кодами из таблицы)

// (запасной вариант) промокоды прямо здесь (работает даже без PROMO_CSV_URL)
// fixed = скидка в рублях, percent = процент
const PROMO_FALLBACK = {
  ROOM200: { type: "fixed", value: 200, min_price: 0, active: true },
  ROOM300: { type: "fixed", value: 300, min_price: 0, active: true },
  OTZIV500: { type: "fixed", value: 500, min_price: 3000, active: true },
  SALE7: { type: "percent", value: 7, min_price: 4000, active: true },
};

const PROMO_STORAGE_KEY = "sneaker_catalog_promo_v1";
// (необязательно) ссылка на саму таблицу (для кнопки "Таблица")
const SHEET_URL = "";

// =========================
// CSV parser (корректно читает кавычки)
// =========================
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === ',' || ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') continue;
      row.push(cur);
      cur = "";
      if (ch === '\n') {
        rows.push(row);
        row = [];
      }
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  rows.push(row);

  const cleaned = rows
    .filter(r => r.some(c => String(c).trim() !== ""))
    .map(r => r.map(c => String(c ?? "").trim()));

  if (cleaned.length < 2) return [];
  const headers = cleaned[0].map(h => h.trim());

  return cleaned.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = cols[idx] ?? "");
    return obj;
  });
}

function norm(s) { return String(s ?? "").trim(); }

function parseList(str) {
  if (!str) return [];
  return String(str).split(",").map(s => s.trim()).filter(Boolean);
}

function buildPairs(euStr, cmStr) {
  const eu = parseList(euStr);
  const cm = parseList(cmStr);
  if (cm.length === 0) return eu.map(v => ({ eu: v, cm: "" }));
  const n = Math.min(eu.length, cm.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push({ eu: eu[i], cm: cm[i] });
  return pairs;
}

function statusText(s) {
  if (s === "in_stock") return { text: "✅ В наличии", cls: "good" };
  if (s === "preorder") return { text: "⏳ Под заказ", cls: "warn" };
  return { text: "❌ Нет", cls: "bad" };
}

function money(v) {
  const n = Number(String(v).replace(/\s+/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("ru-RU") : v;
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/\s+/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// =========================
// PROMO (логика)
// =========================
let PROMO_MAP = new Map();
let APPLIED_PROMO = null; // {code,type,value,min_price,active}
// последнее, что вводил пользователь (для понятного сообщения в Telegram,
// даже если промокод не применился)
let LAST_PROMO_ATTEMPT = "";

function normalizePromoCode(s) {
  return String(s || "").trim().toUpperCase();
}

function setPromoStatus(text, ok = true) {
  const elStatus = document.getElementById("promoStatus");
  if (!elStatus) return;
  elStatus.textContent = text;
  elStatus.style.color = ok ? "#37d67a" : "#ff5a5a";
}

function computeDiscount(basePrice, promo) {
  if (!promo || !promo.active) return { final: basePrice, discount: 0 };
  const minPrice = toNumber(promo.min_price);
  if (minPrice && basePrice < minPrice) return { final: basePrice, discount: 0 };

  let discount = 0;
  if (promo.type === "fixed") discount = toNumber(promo.value);
  else if (promo.type === "percent") discount = Math.round(basePrice * (toNumber(promo.value) / 100));

  const final = Math.max(basePrice - discount, 0);
  return { final, discount };
}

function applyPromo(codeRaw) {
  const code = normalizePromoCode(codeRaw);
  const input = document.getElementById("promoInput");

  if (!code) {
    APPLIED_PROMO = null;
    try { localStorage.removeItem(PROMO_STORAGE_KEY); } catch {}
    if (input) input.value = "";
    setPromoStatus("Промокод сброшен.", true);
    render();
    return;
  }

  const promo = PROMO_MAP.get(code);
  if (!promo || !promo.active) {
    APPLIED_PROMO = null;
    try { localStorage.removeItem(PROMO_STORAGE_KEY); } catch {}
    LAST_PROMO_ATTEMPT = code;
    setPromoStatus("Промокод не найден или неактивен.", false);
    render();
    return;
  }

  APPLIED_PROMO = { ...promo, code };
  LAST_PROMO_ATTEMPT = code;
  try { localStorage.setItem(PROMO_STORAGE_KEY, code); } catch {}
  if (input) input.value = code;
  setPromoStatus(`Промокод применён: ${code}`, true);
  render();
}

async function loadPromos() {
  // 1) fallback
  PROMO_MAP = new Map();
  Object.entries(PROMO_FALLBACK || {}).forEach(([code, p]) => {
    const c = normalizePromoCode(code);
    PROMO_MAP.set(c, {
      type: String(p.type || "fixed"),
      value: toNumber(p.value),
      min_price: toNumber(p.min_price),
      active: Boolean(p.active),
    });
  });

  // 2) override from CSV (если задан)
  if (PROMO_CSV_URL && !PROMO_CSV_URL.startsWith("PASTE_")) {
    try {
      const res = await fetch(PROMO_CSV_URL, { cache: "no-store" });
      const text = await res.text();
      const rows = parseCSV(text);
      rows.forEach(r => {
        const c = normalizePromoCode(r.code);
        if (!c) return;
        const active = String(r.active).toUpperCase() === "TRUE" || String(r.active) === "1";
        PROMO_MAP.set(c, {
          type: String(r.type || "fixed").toLowerCase(),
          value: toNumber(r.value),
          min_price: toNumber(r.min_price),
          active,
        });
      });
    } catch (e) {
      console.warn("Не удалось загрузить PROMO_CSV_URL, использую PROMO_FALLBACK", e);
    }
  }

  // восстановим промокод
  try {
    const saved = localStorage.getItem(PROMO_STORAGE_KEY);
    const code = normalizePromoCode(saved);
    if (code && PROMO_MAP.has(code) && PROMO_MAP.get(code).active) {
      APPLIED_PROMO = { ...PROMO_MAP.get(code), code };
    }
  } catch {}
}

function ensurePromoBar() {
  if (document.getElementById("promoBar")) return;

  // вставим над каталогом
  const wrap = document.createElement("div");
  wrap.id = "promoBar";
  wrap.className = "promo-bar";
  wrap.innerHTML = `
    <div class="promo-head">
      <div class="promo-title">Промокод для подписчиков</div>
      <div class="promo-sub">Подписка не обязательна, но даёт скидки и доступ к кодам недели.</div>
    </div>
    <div class="promo-row">
      <input id="promoInput" class="promo-input" placeholder="Промокод (например ROOM300)" autocomplete="off" />
      <button id="promoApplyBtn" class="promo-btn" type="button">Применить</button>
      <button id="promoResetBtn" class="promo-btn promo-btn--ghost" type="button">Сбросить</button>
      <a id="promoCtaBtn" class="promo-cta" href="${TG_CHANNEL_URL}" target="_blank" rel="noreferrer">Забрать код в Telegram</a>
    </div>
    <div id="promoStatus" class="promo-status"></div>
  `;

  const parent = el.grid?.parentElement;
  if (parent) parent.insertBefore(wrap, el.grid);
  else document.body.prepend(wrap);

  // handlers
  const input = document.getElementById("promoInput");
  const applyBtn = document.getElementById("promoApplyBtn");
  const resetBtn = document.getElementById("promoResetBtn");

  if (input && APPLIED_PROMO?.code) input.value = APPLIED_PROMO.code;
  if (APPLIED_PROMO?.code) setPromoStatus(`Промокод применён: ${APPLIED_PROMO.code}`, true);

  if (applyBtn) applyBtn.addEventListener("click", () => applyPromo(input?.value || ""));
  if (resetBtn) resetBtn.addEventListener("click", () => applyPromo(""));
  if (input) input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyPromo(input.value);
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productSearchBlob(p) {
  return [
    p.code, p.sex, p.brand, p.model, p.price, p.status, p.sizes_eu, p.sizes_cm
  ].map(norm).join(" | ").toLowerCase();
}

// =========================
// UI
// =========================
const el = {
  grid: document.getElementById("grid"),
  meta: document.getElementById("meta"),
  q: document.getElementById("q"),
  sex: document.getElementById("sex"),
  brand: document.getElementById("brand"),
  size: document.getElementById("size"),
  status: document.getElementById("status"),
  sort: document.getElementById("sort"),
  refreshBtn: document.getElementById("refreshBtn"),
  openSheet: document.getElementById("openSheet"),
};

let PRODUCTS = [];
let FILTERED = [];

// per-product selected size and photo
const selectedSizeByCode = new Map();
const selectedPhotoIndexByCode = new Map();
const CURRENT_PHOTOS_BY_CODE = new Map();

function setMeta(text) { el.meta.textContent = text; }

function setOpenSheetLink() {
  if (SHEET_URL) {
    el.openSheet.href = SHEET_URL;
    el.openSheet.style.display = "inline-flex";
  } else {
    el.openSheet.style.display = "none";
  }
}

function fillBrandOptions(items) {
  const brands = Array.from(new Set(items.map(p => norm(p.brand)).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b));
  el.brand.innerHTML = '<option value="">Все</option>' +
    brands.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
}

function fillSizeOptions(items) {
  const sizes = new Set();
  items.forEach(p => parseList(p.sizes_eu).forEach(s => sizes.add(s)));
  const sorted = Array.from(sizes).sort((a,b)=>Number(a)-Number(b));
  el.size.innerHTML = '<option value="">Все</option>' +
    sorted.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}

function applyFilters() {
  const q = norm(el.q.value);
  const sex = norm(el.sex.value);
  const brand = norm(el.brand.value);
  const size = norm(el.size.value);
  const status = norm(el.status.value);
  const sort = norm(el.sort.value);

  let out = PRODUCTS;

  if (q) {
    const qq = q.toLowerCase();
    out = out.filter(p => productSearchBlob(p).includes(qq));
  }
  if (sex) out = out.filter(p => norm(p.sex) === sex);
  if (brand) out = out.filter(p => norm(p.brand) === brand);
  if (status) out = out.filter(p => norm(p.status) === status);
  if (size) out = out.filter(p => parseList(p.sizes_eu).includes(size));

  if (sort === "price_asc") out = [...out].sort((a,b)=>Number(a.price)-Number(b.price));
  if (sort === "price_desc") out = [...out].sort((a,b)=>Number(b.price)-Number(a.price));
  if (sort === "brand_asc") out = [...out].sort((a,b)=>norm(a.brand).localeCompare(norm(b.brand)));
  if (sort === "brand_desc") out = [...out].sort((a,b)=>norm(b.brand).localeCompare(norm(a.brand)));

  FILTERED = out;
  render();
}

function render() {
  ensurePromoBar();
  setMeta(`Показано: ${FILTERED.length} из ${PRODUCTS.length}`);

  if (!FILTERED.length) {
    el.grid.innerHTML = `<div class="skeleton">Ничего не найдено. Попробуй убрать фильтры или изменить запрос.</div>`;
    return;
  }

  el.grid.innerHTML = FILTERED.map(p => renderCard(p)).join("");
  attachCardEvents();
}

function attachCardEvents() {
  FILTERED.forEach(p => {
    const code = p.code;

    // size chips
    const chipWrap = document.querySelector(`[data-chips="${cssEsc(code)}"]`);
    if (chipWrap) {
      chipWrap.querySelectorAll(".chip").forEach(ch => {
        ch.addEventListener("click", () => {
          const eu = ch.getAttribute("data-eu") || "";
          const cm = ch.getAttribute("data-cm") || "";
          selectedSizeByCode.set(code, { eu, cm });
          chipWrap.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
          ch.classList.add("active");
        });
      });
    }

    // thumbs
    const thumbs = document.querySelector(`[data-thumbs="${cssEsc(code)}"]`);
    if (thumbs) {
      thumbs.querySelectorAll(".thumb").forEach(th => {
        th.addEventListener("click", () => {
          const idx = Number(th.getAttribute("data-idx"));
          selectPhoto(code, idx);
        });
      });
    }

    // prev/next
    const prevBtn = document.querySelector(`[data-prev="${cssEsc(code)}"]`);
    const nextBtn = document.querySelector(`[data-next="${cssEsc(code)}"]`);
    if (prevBtn) prevBtn.addEventListener("click", () => stepPhoto(code, -1));
    if (nextBtn) nextBtn.addEventListener("click", () => stepPhoto(code, +1));

    // buy
    const btn = document.querySelector(`[data-buy="${cssEsc(code)}"]`);
    if (btn) {
      btn.addEventListener("click", () => {
        const chosen = selectedSizeByCode.get(code);
        const sizePart = chosen && chosen.eu ? `, размер ${chosen.eu}${chosen.cm ? ` (${chosen.cm} см)` : ""}` : "";
        const basePrice = toNumber(p.price);
        const dd = computeDiscount(basePrice, APPLIED_PROMO);

        const lines = [];
        lines.push(`Хочу: ${p.brand} ${p.model}`);
        lines.push(`Код: ${code}`);
        if (chosen && chosen.eu) lines.push(`Размер: ${chosen.eu}${chosen.cm ? ` (${chosen.cm} см)` : ""}`);

        if (dd.discount > 0 && APPLIED_PROMO?.code) {
          lines.push(`Цена: ${money(basePrice)} ₽ → ${money(dd.final)} ₽`);
          lines.push(`Промокод: ${APPLIED_PROMO.code} (−${money(dd.discount)} ₽)`);
        } else {
          lines.push(`Цена: ${money(basePrice)} ₽`);
        }

        
        // статус промокода (чтобы было понятно в Telegram)
        if (!(dd.discount > 0 && APPLIED_PROMO?.code)) {
          if (LAST_PROMO_ATTEMPT) lines.push(`Промокод: ${LAST_PROMO_ATTEMPT} (не применился)`);
          else lines.push(`Промокод: нет`);
        }
const msg = encodeURIComponent(lines.join("\n"));
        const url = `https://t.me/${TG_USERNAME}?text=${msg}`;
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

    // copy
    const copyBtn = document.querySelector(`[data-copy="${cssEsc(code)}"]`);
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = "Скопировано ✅";
          setTimeout(()=>copyBtn.textContent="Код", 900);
        } catch {
          alert("Не удалось скопировать. Код: " + code);
        }
      });
    }
  });
}

function cssEsc(s) { return String(s).replaceAll('"', '\\"'); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function getPhotos(p) {
  const arr = [];
  for (let i = 1; i <= 8; i++) {
    const v = norm(p[`photo_${i}`]);
    if (v) arr.push(v);
  }
  return arr;
}

function selectPhoto(code, idx) {
  selectedPhotoIndexByCode.set(code, idx);
  const img = document.querySelector(`[data-mainphoto="${cssEsc(code)}"]`);
  const thumbs = document.querySelector(`[data-thumbs="${cssEsc(code)}"]`);
  const photos = CURRENT_PHOTOS_BY_CODE.get(code) || [];
  const safeIdx = clamp(idx, 0, Math.max(0, photos.length - 1));
  if (img && photos[safeIdx]) img.src = photos[safeIdx];

  if (thumbs) {
    thumbs.querySelectorAll(".thumb").forEach(t => t.classList.remove("active"));
    const active = thumbs.querySelector(`.thumb[data-idx="${safeIdx}"]`);
    if (active) active.classList.add("active");
  }
}

function stepPhoto(code, delta) {
  const photos = CURRENT_PHOTOS_BY_CODE.get(code) || [];
  if (photos.length <= 1) return;
  const cur = selectedPhotoIndexByCode.get(code) ?? 0;
  const next = (cur + delta + photos.length) % photos.length;
  selectPhoto(code, next);
}

function renderCard(p) {
  const code = norm(p.code);
  const pairs = buildPairs(p.sizes_eu, p.sizes_cm);
  const st = statusText(norm(p.status));
  const sub = [
    norm(p.sex) === "M" ? "Мужские" : norm(p.sex) === "W" ? "Женские" : "Унисекс",
    code
  ].filter(Boolean).join(" · ");

  // sizes
  const sizeChips = pairs.map((x, idx) => {
    const label = x.cm ? `${x.eu} (${x.cm} см)` : `${x.eu}`;
    const existing = selectedSizeByCode.get(code);
    const active = (!existing && idx === 0) || (existing && existing.eu === x.eu);
    if (!existing && idx === 0) selectedSizeByCode.set(code, { eu: x.eu, cm: x.cm });
    return `<span class="chip ${active ? "active" : ""}" data-eu="${escapeHtml(x.eu)}" data-cm="${escapeHtml(x.cm)}">${escapeHtml(label)}</span>`;
  }).join("");

  // photos 1..8
  const photos = getPhotos(p);
  CURRENT_PHOTOS_BY_CODE.set(code, photos);
  const initialIdx = clamp(selectedPhotoIndexByCode.get(code) ?? 0, 0, Math.max(0, photos.length - 1));
  const main = photos[initialIdx] || "";

  const thumbsHtml = photos.length > 1
    ? `<div class="thumbs" data-thumbs="${escapeHtml(code)}">
        ${photos.map((u, i) => `<img class="thumb ${i===initialIdx ? "active" : ""}" data-idx="${i}" src="${escapeHtml(u)}" alt="" loading="lazy">`).join("")}
      </div>`
    : "";

  const navHtml = photos.length > 1
    ? `<div class="nav">
         <button type="button" aria-label="Предыдущее фото" data-prev="${escapeHtml(code)}">‹</button>
         <button type="button" aria-label="Следующее фото" data-next="${escapeHtml(code)}">›</button>
       </div>`
    : "";

  const photoBlock = main
    ? `<div class="photoWrap">
         <img class="photo" data-mainphoto="${escapeHtml(code)}" src="${escapeHtml(main)}" alt="${escapeHtml(p.model)}" loading="lazy"
              onerror="this.style.display='none';">
         ${navHtml}
       </div>
       ${thumbsHtml}`
    : `<div class="photoWrap"><div class="photo" aria-hidden="true"></div></div>`;

  const basePrice = toNumber(p.price);
  const dd = computeDiscount(basePrice, APPLIED_PROMO);
  const priceHtml = dd.discount > 0
    ? `<div class="priceWrap">
         <div class="priceOld">${money(basePrice)} ₽</div>
         <div class="price">${money(dd.final)} ₽</div>
         <div class="priceSave">−${money(dd.discount)} ₽</div>
       </div>`
    : `<div class="price">${money(basePrice)} ₽</div>`;

  return `
    <article class="card">
      ${photoBlock}
      <div class="pad">
        <div class="title">${escapeHtml(p.brand)} · ${escapeHtml(p.model)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
        <div class="row">
          ${priceHtml}
          <div class="badge ${st.cls}">${st.text}</div>
        </div>
        <div class="sizes"><b>Размеры:</b></div>
        <div class="chips" data-chips="${escapeHtml(code)}">${sizeChips}</div>
      </div>
      <div class="cta">
        <button type="button" class="btn" data-buy="${escapeHtml(code)}">Написать в Telegram</button>
        <button class="btn btn--ghost" data-copy="${escapeHtml(code)}" title="Скопировать код">Код</button>
      </div>
    </article>
  `;
}

// =========================
// Data loading + caching
// =========================
function getCacheKey() { return "sneaker_catalog_cache_drive8_v1"; }

function loadCache() {
  try {
    const raw = localStorage.getItem(getCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items)) return null;
    return parsed;
  } catch { return null; }
}

function saveCache(items) {
  try { localStorage.setItem(getCacheKey(), JSON.stringify({ items, savedAt: Date.now() })); } catch {}
}

async function fetchProducts(force = false) {
  if (!CSV_URL || CSV_URL.startsWith("PASTE_")) {
    el.grid.innerHTML = `<div class="skeleton">
      <b>Нужно вставить CSV ссылку.</b><br>
      Google Sheets → Файл → Опубликовать в интернете → CSV.<br>
      Потом вставь ссылку в <code>CSV_URL</code> в <code>app.js</code> и залей на GitHub Pages.
    </div>`;
    return;
  }

  if (!force) {
    const cached = loadCache();
    if (cached?.items?.length) {
      PRODUCTS = cached.items;
      fillBrandOptions(PRODUCTS);
      fillSizeOptions(PRODUCTS);
      FILTERED = PRODUCTS;
      applyFilters();
      const dt = new Date(cached.savedAt);
      setMeta(`Показано: ${FILTERED.length} из ${PRODUCTS.length} · кеш: ${dt.toLocaleString("ru-RU")}`);
    }
  }

  try {
    setMeta("Обновляю данные…");
    const res = await fetch(CSV_URL, { cache: "no-store" });
    const csv = await res.text();
    const raw = parseCSV(csv);

    const items = raw
      .map(r => {
        const obj = {
          code: norm(r.code),
          sex: norm(r.sex),
          brand: norm(r.brand),
          model: norm(r.model),
          price: norm(r.price),
          sizes_eu: norm(r.sizes_eu),
          sizes_cm: norm(r.sizes_cm),
          status: norm(r.status),
        };
        for (let i = 1; i <= 8; i++) obj[`photo_${i}`] = norm(r[`photo_${i}`]);
        return obj;
      })
      .filter(p => p.code && p.brand && p.model);

    PRODUCTS = items;
    saveCache(items);

    fillBrandOptions(PRODUCTS);
    fillSizeOptions(PRODUCTS);
    FILTERED = PRODUCTS;
    applyFilters();
  } catch (e) {
    console.error(e);
    setMeta("Не удалось загрузить CSV. Проверь, что таблица опубликована и ссылка правильная.");
  }
}

// =========================
// init
// =========================
setOpenSheetLink();
el.refreshBtn.addEventListener("click", () => fetchProducts(true));

["input", "change"].forEach(evt => {
  el.q.addEventListener(evt, applyFilters);
  el.sex.addEventListener(evt, applyFilters);
  el.brand.addEventListener(evt, applyFilters);
  el.size.addEventListener(evt, applyFilters);
  el.status.addEventListener(evt, applyFilters);
  el.sort.addEventListener(evt, applyFilters);
});

// сначала промокоды, потом товары
(async function init() {
  await loadPromos();
  // бар появится при первом render(), но мы можем создать его заранее
  ensurePromoBar();

  // автоподстановка промокода из ссылки: ?promo=ROOM300
  try {
    const sp = new URLSearchParams(window.location.search);
    const qp = sp.get("promo");
    if (qp) applyPromo(qp);
  } catch {}

  fetchProducts(false);
})();

// ---------- PROMO styles fallback (если в style.css нет классов) ----------
// Ничего не сломает: просто добавит минимальный CSS.
(function injectPromoCss() {
  const id = "promoCssFallback";
  if (document.getElementById(id)) return;
  const css = `
    .promo-bar{display:flex;flex-direction:column;gap:10px;margin:10px 0 14px;padding:14px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(135deg, rgba(124,58,237,.18), rgba(34,197,94,.10))}
    .promo-head{display:flex;flex-direction:column;gap:2px}
    .promo-title{font-weight:800;font-size:15px}
    .promo-sub{font-size:13px;opacity:.82}
    .promo-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .promo-input{padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0f1720;color:#fff;min-width:220px}
    .promo-input::placeholder{color:#7a8797}
    .promo-btn{padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#7c3aed;color:#fff;font-weight:700;cursor:pointer}
    .promo-btn--ghost{background:transparent}
    .promo-cta{padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#22c55e;color:#052e20;font-weight:800;text-decoration:none}
    .promo-cta:hover{filter:brightness(1.05)}
    .promo-status{font-size:13px}
    .promo-status--ok{color:#22c55e}
    .promo-status--bad{color:#ef4444}
  `;
  const st = document.createElement("style");
  st.id = id;
  st.textContent = css;
  document.head.appendChild(st);
})();

