const DEFAULT_API_URL = "http://localhost:8000";

const $count = document.getElementById("count");
const $domain = document.getElementById("domain-pill");
const $send = document.getElementById("send");
const $status = document.getElementById("status");

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getApiBase() {
  const { apiUrl } = await chrome.storage.sync.get({ apiUrl: DEFAULT_API_URL });
  return apiUrl.replace(/\/+$/, "");
}

async function load() {
  const tab = await currentTab();
  if (!tab) return;
  const key = `tab:${tab.id}`;
  const data = (await chrome.storage.session.get(key))[key];
  if (!data) {
    $status.textContent = "Aguardando contagem do parser na aba ativa…";
    return;
  }
  $count.textContent = String(data.count);
  $domain.textContent = data.domain;
  $send.disabled = data.count === 0;
  $send.dataset.payload = JSON.stringify({
    domain_id: data.domain,
    raw_data: { items: data.items },
  });
}

$send.addEventListener("click", async () => {
  $send.disabled = true;
  $status.textContent = "Enviando…";
  try {
    const base = await getApiBase();
    const res = await fetch(`${base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: $send.dataset.payload,
    });
    const body = await res.json();
    $status.textContent = `HTTP ${res.status}\n${JSON.stringify(body, null, 2)}`;
  } catch (err) {
    $status.textContent = `Erro: ${err.message}\n(configure a URL em Opções da extensão)`;
  } finally {
    $send.disabled = false;
  }
});

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
