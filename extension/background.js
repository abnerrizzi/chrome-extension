// Service worker (MV3). Efêmero: só executa em resposta a eventos.
// Não armazene estado em variáveis globais — use chrome.storage.session.

const DOMAIN_REGISTRY = [
  {
    id: "linkedin",
    js: ["parsers/linkedin_parser.js"],
    matches: ["*://*.linkedin.com/*"],
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

async function registerAllParsers() {
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const existingIds = new Set(existing.map((s) => s.id));
  const toAdd = DOMAIN_REGISTRY.filter((d) => !existingIds.has(d.id));
  if (toAdd.length === 0) return;
  await chrome.scripting.registerContentScripts(toAdd);
}

chrome.runtime.onInstalled.addListener(() => {
  registerAllParsers().catch((err) => console.error("register error", err));
});

chrome.runtime.onStartup.addListener(() => {
  registerAllParsers().catch((err) => console.error("register error", err));
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "DOM_COUNT") return false;
  const tabId = sender.tab && sender.tab.id;
  setBadge(tabId, msg.count).catch((err) => console.error("setBadge", err));

  // Persiste o último payload por aba para o popup recuperar.
  if (tabId) {
    const key = `tab:${tabId}`;
    chrome.storage.session.set({
      [key]: {
        domain: msg.domain,
        count: msg.count,
        items: msg.items || [],
        capturedAt: Date.now(),
      },
    });
  }
  sendResponse({ ok: true });
  return true;
});

// Limpa storage da aba quando ela é fechada (o badge é zerado automaticamente pelo Chromium).
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {});
});
