const DEFAULT_API_URL = "http://localhost:8000";

const $url = document.getElementById("apiUrl");
const $form = document.getElementById("form");
const $save = document.getElementById("save");
const $test = document.getElementById("test");
const $status = document.getElementById("status");

function setStatus(text, kind = "") {
  $status.textContent = text;
  $status.className = "status" + (kind ? " " + kind : "");
}

function normalize(raw) {
  return (raw || "").trim().replace(/\/+$/, "");
}

function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

async function load() {
  const { apiUrl } = await chrome.storage.sync.get({ apiUrl: DEFAULT_API_URL });
  $url.value = apiUrl;
}

$form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = normalize($url.value);
  let pattern;
  try {
    pattern = originPattern(url);
  } catch {
    setStatus("URL inválida.", "err");
    return;
  }
  $save.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      setStatus(`Permissão para ${pattern} negada. Salvo mesmo assim — chamadas vão falhar até você autorizar.`, "err");
    }
    await chrome.storage.sync.set({ apiUrl: url });
    if (granted) setStatus(`Salvo. Permissão concedida para ${pattern}.`, "ok");
  } catch (err) {
    setStatus("Erro ao salvar: " + err.message, "err");
  } finally {
    $save.disabled = false;
  }
});

$test.addEventListener("click", async () => {
  const url = normalize($url.value);
  let pattern;
  try {
    pattern = originPattern(url);
  } catch {
    setStatus("URL inválida.", "err");
    return;
  }

  $test.disabled = true;
  // 1. Garante permissão de host antes do fetch.
  const hasPerm = await chrome.permissions.contains({ origins: [pattern] });
  if (!hasPerm) {
    setStatus(`Solicitando permissão para ${pattern}…`);
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      setStatus(`Permissão para ${pattern} negada — sem ela o navegador bloqueia o fetch.`, "err");
      $test.disabled = false;
      return;
    }
  }

  setStatus(`GET ${url}/healthz …`);
  const t0 = performance.now();
  try {
    const res = await fetch(`${url}/healthz`, { method: "GET" });
    const elapsed = Math.round(performance.now() - t0);
    const body = await res.text();
    setStatus(`HTTP ${res.status} em ${elapsed} ms\n${body}`, res.ok ? "ok" : "err");
  } catch (err) {
    setStatus(diagnose(url, err), "err");
  } finally {
    $test.disabled = false;
  }
});

function diagnose(url, err) {
  const msg = err.message || String(err);
  const lines = [`Falhou: ${msg}`, ""];
  if (/Failed to fetch/i.test(msg)) {
    lines.push("Causas comuns de 'Failed to fetch':");
    lines.push(`  • API não está no ar em ${url} (rode 'docker compose up -d api')`);
    lines.push("  • Host não resolve por DNS (intranet? VPN ligada?)");
    lines.push("  • Servidor não respondeu com headers CORS para o origin chrome-extension://");
    lines.push("  • Mixed content (página HTTPS chamando HTTP)");
  }
  lines.push("");
  lines.push("Abra DevTools (F12) → aba Network → reenvia para ver o erro exato.");
  return lines.join("\n");
}

load();
