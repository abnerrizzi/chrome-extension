// Parser para a página de listagem do PNCP (pncp.gov.br/app/editais)
(async function () {
  const logPrefs = await chrome.storage.sync.get({ consoleLogEnabled: true, consoleLogLevel: "info" });
  const originalInfo = console.info;
  const originalDebug = console.debug;
  console.info = (...args) => { if (logPrefs.consoleLogEnabled) originalInfo.apply(console, args); };
  console.debug = (...args) => { if (logPrefs.consoleLogEnabled && logPrefs.consoleLogLevel === 'debug') originalDebug.apply(console, args); };

  let lastHash = "";
  runOnce();

  // Re-executa debounced quando o DOM muda (paginação SPA Angular, filtros, etc)
  if (window.__pncpListObserver) {
    window.__pncpListObserver.disconnect();
  }
  let timeout = null;
  const observer = new MutationObserver(() => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(runOnce, 800);
  });
  window.__pncpListObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });

  function runOnce() {
    const cards = Array.from(document.querySelectorAll('.br-list a.br-item, a.br-item[href*="/editais/"]'));
    if (cards.length === 0) {
      sendCount(0, [], "nenhum card de edital encontrado no DOM");
      return;
    }

    const itemsMap = new Map();
    for (const card of cards) {
      const item = toItem(card);
      if (item && item.external_id && !itemsMap.has(item.external_id)) {
        itemsMap.set(item.external_id, item);
      }
    }

    const items = Array.from(itemsMap.values());
    const currentHash = items.map(i => i.external_id).sort().join(',');

    if (currentHash === lastHash && items.length > 0) return;
    lastHash = currentHash;

    console.info(`[pncp_parser] ${items.length} editais parseados do DOM`);
    sendCount(items.length, items);
  }

  function sendCount(count, items, debug) {
    const msg = { type: "DOM_COUNT", domain: "pncp", count, items };
    if (debug) msg.debug = debug;
    chrome.runtime.sendMessage(msg);
  }

  function getFieldByLabel(card, label) {
    const elements = card.querySelectorAll('span, div, strong, p');
    let bestMatch = null;
    for (const el of elements) {
      const rawText = el.textContent || "";
      const idx = rawText.indexOf(label);
      if (idx !== -1) {
        const value = rawText.slice(idx + label.length).trim();
        if (!value) continue;
        if (!bestMatch || value.length < bestMatch.length) {
          bestMatch = value;
        }
      }
    }
    if (bestMatch) {
      // Split by common label headers to avoid leakage if we grabbed a parent container
      const nextLabelIndex = bestMatch.search(/(?:Id contratação PNCP|Modalidade da Contratação|Última Atualização|Órgão|Local|Objeto):/);
      if (nextLabelIndex !== -1) {
        bestMatch = bestMatch.slice(0, nextLabelIndex).trim();
      }
      return bestMatch.trim();
    }
    return null;
  }

  function getEditalNumber(card) {
    const elements = card.querySelectorAll('strong, div');
    for (const el of elements) {
      const text = el.textContent.trim();
      if (/^Edital\s*(?:n[oº]|nº)?\s*/i.test(text) && /\d+/.test(text)) {
        return text;
      }
    }
    return null;
  }

  function toItem(el) {
    const href = el.getAttribute('href') || "";
    const url = el.href || "";

    const pncp_id = getFieldByLabel(el, "Id contratação PNCP:") || "";
    // Se não achar pela label exata, tenta encontrar um padrão do ID do PNCP: CNPJ-1-SEQ/ANO
    let extId = pncp_id;
    if (!extId) {
      const hrefMatch = href.match(/\/editais\/(\d+)\/(\d+)\/(\d+)/);
      if (hrefMatch) {
        // Fallback: monta um ID consistente com o CNPJ/ANO/SEQ
        extId = `${hrefMatch[1]}/${hrefMatch[2]}/${hrefMatch[3]}`;
      }
    }

    if (!extId) return null;

    const numero_edital = getEditalNumber(el) || "";
    const modalidade = getFieldByLabel(el, "Modalidade da Contratação:") || "";
    const ultima_atualizacao_raw = getFieldByLabel(el, "Última Atualização:") || "";
    const orgao = getFieldByLabel(el, "Órgão:") || "";
    const local = getFieldByLabel(el, "Local:") || "";
    const objeto = getFieldByLabel(el, "Objeto:") || "";

    return {
      external_id: String(extId),
      pncp_id: String(pncp_id || extId),
      numero_edital: String(numero_edital),
      modalidade: String(modalidade),
      ultima_atualizacao_raw: String(ultima_atualizacao_raw),
      orgao: String(orgao),
      local: String(local),
      objeto: String(objeto),
      url: String(url),
    };
  }
})();
