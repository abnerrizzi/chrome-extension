const DEFAULT_API_URL = "http://localhost:8000";

const $count   = document.getElementById("m-count");
const $domain  = document.getElementById("m-domain");
const $tab     = document.getElementById("m-tab");
const $statusPill = document.getElementById("status-pill");
const $apiLabel   = document.getElementById("api-label");

const $previewSection = document.getElementById("preview-section");
const $previewAux     = document.getElementById("preview-aux");
const $itemsList      = document.getElementById("items-list");

const $resultSection = document.getElementById("result-section");
const $resultTitle   = document.getElementById("result-title");
const $resultAux     = document.getElementById("result-aux");
const $resTag        = document.getElementById("res-tag");
const $resMsg        = document.getElementById("res-msg");
const $resDetail     = document.getElementById("res-detail");

const $send         = document.getElementById("send");
const $endpointPath = document.getElementById("endpoint-path");

const MAX_PREVIEW = 8;

const $hdrVer = document.getElementById("hdr-ver");
$hdrVer.textContent = `v${chrome.runtime.getManifest().version}`;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getApiBase() {
  const { apiUrl } = await chrome.storage.sync.get({ apiUrl: DEFAULT_API_URL });
  return apiUrl.replace(/\/+$/, "");
}

async function getAutoSend() {
  const { autoSend } = await chrome.storage.sync.get({ autoSend: false });
  return !!autoSend;
}

async function setAutoSend(on) {
  await chrome.storage.sync.set({ autoSend: !!on });
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
  // default
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

async function load() {
  const tab = await currentTab();
  $tab.textContent = tab ? `#${tab.id}` : "—";

  const base = await getApiBase();
  $endpointPath.textContent = `${stripScheme(base)}/api/v1/ingest`;
  pingApi(base);

  if (!tab) return;
  const key = `tab:${tab.id}`;
  const data = (await chrome.storage.session.get(key))[key];
  if (!data || !data.count) {
    $domain.textContent = "—";
    return;
  }

  $domain.textContent = data.domain;
  $count.textContent = String(data.count);

  if (data.items && data.items.length) {
    $previewSection.hidden = false;
    renderItems(data.domain, data.items);
  }

  $send.disabled = data.count === 0;
  $send.dataset.payload = JSON.stringify({
    domain_id: data.domain,
    raw_data: { items: data.items || [] },
  });
}

function stripScheme(url) {
  return url.replace(/^https?:\/\//, "");
}

function showResult(httpStatus, body) {
  $resultSection.hidden = false;
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

async function initAutoSendToggle() {
  const btn = document.getElementById("autosend-toggle");
  const state = document.getElementById("autosend-state");
  if (!btn) return;
  const render = (on) => {
    btn.setAttribute("aria-checked", on ? "true" : "false");
    state.textContent = on ? "enabled" : "disabled";
  };
  render(await getAutoSend());
  btn.addEventListener("click", async () => {
    const next = btn.getAttribute("aria-checked") !== "true";
    render(next);
    await setAutoSend(next);
  });
}

initAutoSendToggle();
load();
