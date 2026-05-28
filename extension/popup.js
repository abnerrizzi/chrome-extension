const DEFAULT_API_URL = "http://localhost:8000";
const KNOWN_DOMAINS = ["olx", "auctions", "linkedin", "linkedin_detail"];

const $count   = document.getElementById("m-count");
const $domain  = document.getElementById("m-domain");
const $tab     = document.getElementById("m-tab");
const $version = document.getElementById("m-version");
const $statusPill = document.getElementById("status-pill");
const $apiLabel   = document.getElementById("api-label");

const $itemsList    = document.getElementById("items-list");
const $itemsEmpty   = document.getElementById("items-empty");
const $previewAux   = document.getElementById("preview-aux");

const $resultTitle = document.getElementById("result-title");
const $resultAux   = document.getElementById("result-aux");
const $resTag      = document.getElementById("res-tag");
const $resMsg      = document.getElementById("res-msg");
const $resDetail   = document.getElementById("res-detail");
const $resultBody  = document.getElementById("result-body");
const $resultEmpty = document.getElementById("result-empty");

const $send         = document.getElementById("send");
const $endpointPath = document.getElementById("endpoint-path");

const $siteSection = document.getElementById("site-section");
const $siteHost    = document.getElementById("site-host");
const $autosendBtn = document.getElementById("autosend-toggle");

const $tabItems    = document.getElementById("tab-items");
const $tabResponse = document.getElementById("tab-response");
const $tabInfo     = document.getElementById("tab-info");
const $responseDot = document.getElementById("response-dot");
const $panelItems    = document.getElementById("panel-items");
const $panelResponse = document.getElementById("panel-response");
const $panelInfo     = document.getElementById("panel-info");
const TABS = [
  [$tabItems,    $panelItems],
  [$tabResponse, $panelResponse],
  [$tabInfo,     $panelInfo],
];

const MAX_PREVIEW = 8;

const $hdrVer = document.getElementById("hdr-ver");
const VERSION_TEXT = `v${chrome.runtime.getManifest().version}`;
for (const el of [$hdrVer, $version]) el.textContent = VERSION_TEXT;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getApiBase() {
  const { apiUrl } = await chrome.storage.sync.get({ apiUrl: DEFAULT_API_URL });
  return apiUrl.replace(/\/+$/, "");
}

// One-shot migration: legacy `autoSend: boolean` → `autoSendDomains: Record<string, boolean>`.
// Returns the current map (after migration if it ran), so callers can avoid a second read.
async function ensureAutoSendMigration() {
  const stored = await chrome.storage.sync.get(["autoSend", "autoSendDomains"]);
  const existing = stored.autoSendDomains || {};
  if (stored.autoSend === undefined) return existing;
  const legacyOn = stored.autoSend === true;
  const seeded = Object.fromEntries(KNOWN_DOMAINS.map((d) => [d, legacyOn]));
  const next = { ...seeded, ...existing }; // existing entries win over the legacy seed
  await chrome.storage.sync.set({ autoSendDomains: next });
  await chrome.storage.sync.remove("autoSend");
  return next;
}

async function setAutoSendForDomain(domain, on) {
  const { autoSendDomains } = await chrome.storage.sync.get({ autoSendDomains: {} });
  const map = autoSendDomains || {};
  map[domain] = !!on;
  await chrome.storage.sync.set({ autoSendDomains: map });
}

function setStatus(state, label) {
  $statusPill.dataset.state = state;
  $apiLabel.textContent = label;
}

async function pingApi(base) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${base}/healthz`, { signal: ctrl.signal });
    clearTimeout(t);
    setStatus(res.ok ? "online" : "offline", res.ok ? "online" : `http ${res.status}`);
  } catch {
    setStatus("offline", "offline");
  }
}

function previewFields(domain, item) {
  if (domain === "auctions") {
    return {
      title: item.title || "",
      price: item.current_bid_raw || "",
      meta:  item.lot_code || shortenUrl(item.url),
    };
  }
  if (domain === "olx") {
    return {
      title: item.title || "",
      price: item.price_raw || "",
      meta:  [item.kind, shortenUrl(item.url)].filter(Boolean).join(" · "),
    };
  }
  if (domain === "linkedin") {
    return {
      title: item.title || "",
      price: item.company || "",
      meta:  [item.location, shortenUrl(item.url)].filter(Boolean).join(" · "),
    };
  }
  if (domain === "linkedin_detail") {
    return {
      title: item.title || "",
      price: item.seniority || "",
      meta:  [item.employment_type, item.applicants_raw || item.applicants]
               .filter(Boolean).join(" · "),
    };
  }
  return {
    title: item.title || "",
    price: item.price_raw || "",
    meta:  shortenUrl(item.url),
  };
}

function shortenUrl(u) {
  if (!u) return "";
  try {
    const url = new URL(u);
    const path = url.pathname.length > 36 ? url.pathname.slice(0, 33) + "…" : url.pathname;
    return url.host + path;
  } catch { return u; }
}

function renderItems(domain, items) {
  $itemsList.innerHTML = "";
  const shown = items.slice(0, MAX_PREVIEW);
  for (const it of shown) {
    const f = previewFields(domain, it);
    const li = document.createElement("li");
    const t = document.createElement("span"); t.className = "it-title"; t.textContent = f.title;
    const p = document.createElement("span"); p.className = "it-price"; p.textContent = f.price;
    const m = document.createElement("span"); m.className = "it-meta";  m.textContent = f.meta;
    li.append(t, p, m);
    $itemsList.appendChild(li);
  }
  $previewAux.textContent = items.length > MAX_PREVIEW
    ? `${shown.length} of ${items.length}`
    : `${items.length}`;
}

function setItemsCount(n) {
  $count.textContent = String(n);
  $tabItems.setAttribute("aria-label", `items, ${n}`);
}

function stripScheme(url) {
  return url.replace(/^https?:\/\//, "");
}

function hostFromTab(tab) {
  if (!tab || !tab.url) return "";
  try { return new URL(tab.url).host; } catch { return ""; }
}

function switchTab(name) {
  const target = TABS.find(([btn]) => btn.dataset.tab === name);
  if (!target || target[0].getAttribute("aria-disabled") === "true") return;
  for (const [btn, panel] of TABS) {
    const active = btn.dataset.tab === name;
    btn.setAttribute("aria-selected", active ? "true" : "false");
    panel.hidden = !active;
  }
  if (name === "response") $responseDot.hidden = true;
}

function renderSiteSection(data, tab, autoSendMap) {
  if (!data || !data.domain) {
    $siteSection.dataset.match = "false";
    return;
  }
  $siteSection.dataset.match = "true";
  $siteHost.textContent = hostFromTab(tab) || data.domain;
  $autosendBtn.setAttribute("aria-checked", autoSendMap[data.domain] ? "true" : "false");
}

async function load() {
  // Independent IO — fan out then merge.
  const [autoSendMap, tab, base] = await Promise.all([
    ensureAutoSendMigration(),
    currentTab(),
    getApiBase(),
  ]);

  $tab.textContent = tab ? `#${tab.id}` : "—";
  $endpointPath.textContent = `${stripScheme(base)}/api/v1/ingest`;
  pingApi(base);

  if (!tab) {
    renderSiteSection(null, null, autoSendMap);
    return;
  }
  const key = `tab:${tab.id}`;
  const data = (await chrome.storage.session.get(key))[key];

  renderSiteSection(data, tab, autoSendMap);

  if (!data || !data.count) {
    $domain.textContent = "—";
    $itemsEmpty.hidden = false;
    return;
  }

  $domain.textContent = data.domain;
  setItemsCount(data.count);

  if (data.items && data.items.length) {
    renderItems(data.domain, data.items);
    $itemsEmpty.hidden = true;
  } else {
    $itemsEmpty.hidden = false;
  }

  $send.disabled = data.count === 0;
  $send.dataset.payload = JSON.stringify({
    domain_id: data.domain,
    raw_data: { items: data.items || [] },
  });
}

function showResult(httpStatus, body) {
  const ok      = httpStatus >= 200 && httpStatus < 300;
  const persisted = !!(body && body.persisted);
  const errCount  = body && Array.isArray(body.errors) ? body.errors.length : 0;

  $resultTitle.textContent = ok ? "ingest.ok" : "ingest.err";
  $resultAux.textContent   = `status ${httpStatus}`;

  if (ok && persisted) {
    $resTag.textContent = "success";
    $resTag.classList.remove("err");
    $resMsg.textContent = "persisted";
  } else if (ok && !persisted) {
    $resTag.textContent = "warn";
    $resTag.classList.add("err");
    $resMsg.textContent = body.skipped_reason || "not persisted";
  } else {
    $resTag.textContent = "error";
    $resTag.classList.add("err");
    $resMsg.textContent = (body && body.detail) ? "validation failed" : "request failed";
  }

  const rows = ok && body ? [
    ["session_id", body.session_id ?? "—", "ok"],
    ["inserted",   body.validated ?? 0,    "ok"],
    ["errors",     errCount,                errCount ? "err" : "ok"],
    ["persisted",  String(persisted),       persisted ? "ok" : "err"],
  ] : [
    ["status",     httpStatus,             "err"],
    ["detail",     JSON.stringify(body || {}).slice(0, 80), "err"],
  ];

  $resDetail.innerHTML = "";
  for (const [k, v, kind] of rows) {
    const li = document.createElement("li");
    const dk = document.createElement("span"); dk.className = "dk"; dk.textContent = k;
    const dv = document.createElement("span"); dv.className = "dv" + (kind === "err" ? " dv-err" : ""); dv.textContent = v;
    li.append(dk, dv);
    $resDetail.appendChild(li);
  }

  $tabResponse.removeAttribute("aria-disabled");
  $resultBody.hidden = false;
  $resultEmpty.hidden = true;
  if ($tabResponse.getAttribute("aria-selected") !== "true") {
    $responseDot.hidden = false;
  }
}

$send.addEventListener("click", async () => {
  $send.disabled = true;
  $send.querySelector(".btn-label").textContent = "enviando…";
  try {
    const base = await getApiBase();
    const res = await fetch(`${base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: $send.dataset.payload,
    });
    const body = await res.json().catch(() => ({}));
    showResult(res.status, body);
  } catch (err) {
    showResult(0, { detail: err.message });
  } finally {
    $send.disabled = false;
    $send.querySelector(".btn-label").textContent = "Enviar para API";
  }
});

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

for (const [btn] of TABS) {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
}

// O domínio é resolvido a cada clique a partir do storage da aba ativa, para
// que mudanças de aba no underlying browser (popup persistente em alguns
// SOs) não façam a gravação cair no domínio errado.
$autosendBtn.addEventListener("click", async () => {
  const tab = await currentTab();
  if (!tab) return;
  const data = (await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`];
  const domain = data && data.domain;
  if (!domain) return;
  const next = $autosendBtn.getAttribute("aria-checked") !== "true";
  $autosendBtn.setAttribute("aria-checked", next ? "true" : "false");
  await setAutoSendForDomain(domain, next);
});

load();
