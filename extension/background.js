// Service worker (MV3). Efêmero: só executa em resposta a eventos.
// Não armazene estado em variáveis globais — use chrome.storage.session.

const DOMAIN_REGISTRY = [
  {
    // Lista de busca: cards rasos com data-job-id.
    id: "linkedin-search",
    js: ["parsers/linkedin_search_parser.js"],
    matches: [
      "*://*.linkedin.com/jobs/search/*",
      "*://*.linkedin.com/jobs/search*",
      "*://*.linkedin.com/jobs/collections/*",
      "*://*.linkedin.com/jobs/",
    ],
    allFrames: false,
    runAt: "document_idle",
  },
  {
    // Detalhe: enriquece a linha via upsert por external_id.
    // /jobs/view/<id> e o painel direito em /jobs/search/?currentJobId=<id>.
    id: "linkedin-detail",
    js: ["parsers/linkedin_detail_parser.js"],
    matches: [
      "*://*.linkedin.com/jobs/view/*",
      "*://*.linkedin.com/jobs/search/*",
      "*://*.linkedin.com/jobs/search*",
    ],
    allFrames: false,
    runAt: "document_idle",
  },
  {
    id: "olx",
    js: ["parsers/olx_parser.js"],
    matches: ["*://*.olx.com.br/*"],
    allFrames: false,
    runAt: "document_idle",
  },
  {
    id: "auctions",
    js: ["parsers/auctions_parser.js"],
    matches: ["*://*.auctions.example/*"],
    allFrames: true,
    runAt: "document_idle",
  },
];

// Reconcile o registro de content scripts com DOMAIN_REGISTRY:
//   1. Remove órfãos (IDs que existem no Chrome mas saíram do registry — ex.:
//      "linkedin" depois do split em search/detail).
//   2. Atualiza IDs que já existem (cobre mudanças de `matches` / `js` entre
//      versões sem trocar o ID).
//   3. Registra IDs novos.
//
// O try/catch cobre o race entre onInstalled e onStartup quando os dois
// disparam concorrentemente. Como o reconcile agora também (des)registra e
// atualiza, o erro benigno pode ser "Duplicate script ID" (registrar id que o
// outro já criou) OU "Nonexistent script ID" (des/atualizar id que o outro já
// removeu). Em ambos a invocação que perdeu o race só constata que o trabalho
// já foi feito e segue silenciosa.
async function registerAllParsers() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const existingIds = new Set(existing.map((s) => s.id));
    const wantedIds   = new Set(DOMAIN_REGISTRY.map((d) => d.id));

    const orphanIds = [...existingIds].filter((id) => !wantedIds.has(id));
    if (orphanIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: orphanIds });
    }

    const toUpdate = DOMAIN_REGISTRY.filter((d) => existingIds.has(d.id));
    const toAdd    = DOMAIN_REGISTRY.filter((d) => !existingIds.has(d.id));

    if (toUpdate.length > 0) await chrome.scripting.updateContentScripts(toUpdate);
    if (toAdd.length    > 0) await chrome.scripting.registerContentScripts(toAdd);
  } catch (err) {
    if (isBenignRaceError(err)) {
      console.debug("registerAllParsers: race (já reconciliado)", err && err.message);
      return;
    }
    throw err;
  }
}

// Erros esperados quando onInstalled e onStartup reconciliam concorrentemente:
// registrar um id que o outro já criou, ou (des)atualizar um id que o outro já
// removeu. O `|| ""` evita TypeError caso o throw não seja um Error.
function isBenignRaceError(err) {
  return /Duplicate script ID|Nonexistent script ID|does not exist/i.test(
    (err && err.message) || ""
  );
}

chrome.runtime.onInstalled.addListener(() => {
  registerAllParsers().catch((err) => console.error("register error", err));
});

chrome.runtime.onStartup.addListener(() => {
  registerAllParsers().catch((err) => console.error("register error", err));
});

function urlMatchesDomain(url, domain) {
  if (!url) return false;
  return domain.matches.some((pattern) => {
    const rx = new RegExp(
      "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*") +
        "$"
    );
    return rx.test(url);
  });
}

// SPA pagination: pushState/replaceState não dispara um novo document, então
// os content scripts registrados não rodam de novo. Re-injetamos manualmente.
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const domain = DOMAIN_REGISTRY.find((d) => urlMatchesDomain(details.url, d));
  if (!domain) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: domain.js,
    });
  } catch (err) {
    // Silenciar: pode falhar em URLs sem permissão de host ainda concedida.
    console.debug("SPA re-inject skipped:", err.message);
  }
});

async function setBadge(tabId, count) {
  if (typeof tabId !== "number") return;
  if (!count || count <= 0) {
    // Limpa o badge apenas na aba — não polui outras.
    await chrome.action.setBadgeText({ text: "", tabId });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: "#D32F2F", tabId });
  await chrome.action.setBadgeText({ text: String(count), tabId });
}

function payloadHash(domain, items) {
  // Identidade do snapshot: domínio + lista de external_id (estável entre
  // re-injeções e MutationObserver no mesmo conteúdo).
  const ids = (items || [])
    .map((i) => (i && i.external_id != null ? String(i.external_id) : ""))
    .join(",");
  return `${domain}|${ids}`;
}

async function autoSendIfEnabled(tabId, domain, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const { autoSend, apiUrl } = await chrome.storage.sync.get({
    autoSend: false,
    apiUrl: "http://localhost:8000",
  });
  if (!autoSend) return;

  const hash = payloadHash(domain, items);
  const lastKey = `tab:${tabId}:lastSentHash`;
  const last = (await chrome.storage.session.get(lastKey))[lastKey];
  if (last === hash) return; // dedupe — já enviado este snapshot

  const base = apiUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/v1/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain_id: domain, raw_data: { items } }),
    });
    const body = await res.json().catch(() => ({}));
    await chrome.storage.session.set({ [lastKey]: hash });
    console.info(`[auto-send] ${domain} status=${res.status} session=${body.session_id ?? "-"}`);
  } catch (err) {
    console.warn("[auto-send] falhou:", err.message);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "DOM_COUNT") return false;
  const tabId = sender.tab && sender.tab.id;
  setBadge(tabId, msg.count).catch((err) => console.error("setBadge", err));

  // Persiste o último payload por aba para o popup recuperar.
  if (tabId) {
    const key = `tab:${tabId}`;
    const stored = {
      domain: msg.domain,
      count: msg.count,
      items: msg.items || [],
      capturedAt: Date.now(),
    };
    // Metadata opcional: total de resultados disponíveis na página
    // (ex.: LinkedIn mostra "1.234 vagas"). Útil para popup exibir
    // "mostrando N de TOTAL".
    if (typeof msg.totalAvailable === "number") stored.totalAvailable = msg.totalAvailable;
    chrome.storage.session.set({ [key]: stored });
    autoSendIfEnabled(tabId, msg.domain, msg.items || []).catch((err) =>
      console.error("autoSend", err),
    );
  }
  sendResponse({ ok: true });
  return true;
});

// Limpa storage da aba quando ela é fechada (o badge é zerado automaticamente pelo Chromium).
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([`tab:${tabId}`, `tab:${tabId}:lastSentHash`]).catch(() => {});
});
