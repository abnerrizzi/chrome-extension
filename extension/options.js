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
  $test.disabled = true;
  setStatus(`GET ${url}/healthz …`);
  const t0 = performance.now();
  try {
    const res = await fetch(`${url}/healthz`, { method: "GET" });
    const elapsed = Math.round(performance.now() - t0);
    const body = await res.text();
    if (res.ok) {
      setStatus(`HTTP ${res.status} em ${elapsed} ms\n${body}`, "ok");
    } else {
      setStatus(`HTTP ${res.status} em ${elapsed} ms\n${body}`, "err");
    }
  } catch (err) {
    setStatus(`Falhou: ${err.message}\n(verifique CORS, permissão de host e se a API está rodando)`, "err");
  } finally {
    $test.disabled = false;
  }
});

load();
