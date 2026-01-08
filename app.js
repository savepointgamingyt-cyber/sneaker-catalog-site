
// =========================
// НАСТРОЙКИ (поменяй 2 строки)
// =========================
const DEFAULT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR0jBSjWhb8LlSj_nyeq_yQhRh889UhEwV-HjQM1MFNsA6Ou3ISYiaZYpBkBdPdxVJbwlB4TxsYHuiK/pub?gid=185458680&single=true&output=csv";
// You can set CSV link without editing code:
// 1) Add ?csv=YOUR_LINK to the site URL, or
// 2) Paste it once into the in-page prompt (it will be saved in this browser).
function resolveCsvUrl(){
  const qs = new URLSearchParams(location.search);
  const fromQs = qs.get("csv");
  const fromWin = window.__CSV_URL__;
  const fromLs = localStorage.getItem("CSV_URL");
  return (fromWin || fromQs || fromLs || DEFAULT_CSV_URL || "").trim();
}
let CSV_URL = resolveCsvUrl();

const TG_USERNAME = "Kuharen7"; // без @
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
  setMeta(`Показано: ${FILTERED.length} из ${PRODUCTS.length}`);

  if (!FILTERED.length) {
    el.grid.innerHTML = `<div class="skeleton">
  <b>Каталог не загружается — нет правильной CSV‑ссылки.</b><br>
  1) Открой Google Sheets → <b>Файл → Опубликовать в интернете</b> → формат <b>CSV</b>.<br>
  2) Скопируй ссылку и вставь сюда:
  <div class="csv-setup">
    <input id="csvUrlInput" class="input" placeholder="Вставь CSV ссылку из Google Sheets" />
    <button id="csvUrlSave" class="btn primary">Сохранить</button>
  </div>
  <div class="muted">Лайфхак: можно также открыть сайт так: <code>?csv=ВАША_ССЫЛКА</code>. Ссылка сохранится в браузере.</div>
</div>`;
const inp = document.getElementById("csvUrlInput");
const btn = document.getElementById("csvUrlSave");
if (inp) inp.value = (CSV_URL && !CSV_URL.startsWith("PASTE_")) ? CSV_URL : "";
btn?.addEventListener("click", () => {
  const val = (inp?.value || "").trim();
  if (!val || !val.includes("pub") || !val.includes("output=csv")) {
    alert("Похоже, это не CSV ссылка. В конце должно быть output=csv");
    return;
  }
  localStorage.setItem("CSV_URL", val);
  location.href = location.pathname + "?v=" + Date.now();
});
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
        const msg = encodeURIComponent(`Хочу ${code}${sizePart}`);
        window.open(`https://t.me/${TG_USERNAME}?text=${msg}`, "_blank");
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

  return `
    <article class="card">
      ${photoBlock}
      <div class="pad">
        <div class="title">${escapeHtml(p.brand)} · ${escapeHtml(p.model)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
        <div class="row">
          <div class="price">${money(p.price)} ₽</div>
          <div class="badge ${st.cls}">${st.text}</div>
        </div>
        <div class="sizes"><b>Размеры:</b></div>
        <div class="chips" data-chips="${escapeHtml(code)}">${sizeChips}</div>
      </div>
      <div class="cta">
        <button class="btn" data-buy="${escapeHtml(code)}">Написать в Telegram</button>
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
  if (!CSV_URL || CSV_URL.startsWith("PASTE_") || CSV_URL.includes("...") || CSV_URL.includes("PASTE_CSV")) {
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


// =========================
// mobile controls toggle
// =========================
(function setupMobileControls(){
  const btnOpen = document.getElementById("filtersToggle");
  const btnClose = document.getElementById("filtersClose");
  const controls = document.getElementById("controls");
  if (!btnOpen || !controls) return;

  const setState = (isOpen) => {
    document.body.classList.toggle("show-controls", isOpen);
    btnOpen.setAttribute("aria-expanded", String(isOpen));
  };

  btnOpen.addEventListener("click", () => {
    const isOpen = !document.body.classList.contains("show-controls");
    setState(isOpen);
    if (isOpen) controls.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  if (btnClose) {
    btnClose.addEventListener("click", () => setState(false));
  }

  // Close filters after selecting something on mobile (optional UX)
  const closeOnMobile = () => {
    if (window.matchMedia("(max-width: 720px)").matches) setState(false);
  };
  ["change"].forEach(evt => {
    el.sex.addEventListener(evt, closeOnMobile);
    el.brand.addEventListener(evt, closeOnMobile);
    el.size.addEventListener(evt, closeOnMobile);
    el.status.addEventListener(evt, closeOnMobile);
    el.sort.addEventListener(evt, closeOnMobile);
  });

  window.addEventListener("resize", () => {
    // On desktop, always show controls without needing the toggle
    if (!window.matchMedia("(max-width: 720px)").matches) {
      document.body.classList.remove("show-controls");
      btnOpen.setAttribute("aria-expanded", "false");
    }
  });
})();

fetchProducts(false);
