// Parser OLX (imóveis / casas) atualizado para o novo layout (DOM Parser).
// A OLX migrou para o Next.js App Router, removendo o __NEXT_DATA__.
// Agora extraímos os dados diretamente dos AdCards no HTML.

(async function () {
  const logPrefs = await chrome.storage.sync.get({ consoleLogEnabled: true, consoleLogLevel: "info" });
  const originalInfo = console.info;
  const originalDebug = console.debug;
  console.info = (...args) => { if (logPrefs.consoleLogEnabled) originalInfo.apply(console, args); };
  console.debug = (...args) => { if (logPrefs.consoleLogEnabled && logPrefs.consoleLogLevel === 'debug') originalDebug.apply(console, args); };

  let lastHash = "";
  runOnce();

  // Re-executa o parser debounced quando o DOM mudar (ex: scroll infinito, navegação SPA)
  let timeout = null;
  const observer = new MutationObserver(() => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(runOnce, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ---------- main ----------

  function runOnce() {
    // Seletores dos cards de anúncio no novo layout
    const cards = Array.from(document.querySelectorAll('section.olx-adcard, div[data-ds-component="DS-AdCard"], a[data-ds-component="DS-AdCard"]'));
    if (cards.length === 0) {
      sendCount(0, [], "nenhum adcard encontrado no DOM");
      return;
    }

    const itemsMap = new Map();
    for (const card of cards) {
      const item = toItem(card);
      if (item && isVendaOuAluguel(item) && !itemsMap.has(item.external_id)) {
        itemsMap.set(item.external_id, item);
      }
    }

    const items = Array.from(itemsMap.values());
    const currentHash = items.map(i => i.external_id).join(',');
    
    // Evitar spam de mensagens se os anúncios não mudaram
    if (currentHash === lastHash && items.length > 0) return;
    lastHash = currentHash;

    console.info(`[olx_parser] ${items.length} ads parseados via DOM`);
    sendCount(items.length, items);
  }

  // ---------- helpers ----------

  function sendCount(count, items, debug) {
    const msg = { type: "DOM_COUNT", domain: "olx", count, items };
    if (debug) msg.debug = debug;
    chrome.runtime.sendMessage(msg);
  }

  function toItem(el) {
    const linkEl = el.tagName === 'A' ? el : el.querySelector('a[data-testid="adcard-link"], a.olx-adcard__link');
    if (!linkEl) return null;

    const url = linkEl.href;
    if (!url) return null;

    const idMatch = url.match(/-(\d+)(?:\?|$)/);
    const id = idMatch ? idMatch[1] : null;
    if (!id) return null;

    const titleEl = el.querySelector('h2');
    const title = titleEl ? titleEl.textContent.trim() : linkEl.title;

    const priceEl = el.querySelector('.olx-adcard__price, h3');
    const price_raw = priceEl ? priceEl.textContent.trim() : null;

    const locEl = el.querySelector('.olx-adcard__location');
    const location = locEl ? locEl.textContent.trim() : null;

    const dateEl = el.querySelector('.olx-adcard__date');
    const date_raw = dateEl ? dateEl.textContent.trim() : null;

    const imgEl = el.querySelector('picture img');
    const image_url = imgEl ? imgEl.src : null;

    let bedrooms_raw = null;
    let bathrooms_raw = null;
    let garage_spaces_raw = null;
    let area_raw = null;

    // Extrair detalhes por aria-label ou texto
    const details = el.querySelectorAll('.olx-adcard__detail');
    for (const det of details) {
      const label = (det.getAttribute('aria-label') || "").toLowerCase();
      const text = det.textContent.trim();
      if (label.includes('quarto') || text.includes('quarto')) bedrooms_raw = text;
      else if (label.includes('banheiro') || text.includes('banheiro')) bathrooms_raw = text;
      else if (label.includes('vaga') || text.includes('vaga')) garage_spaces_raw = text;
      else if (label.includes('metro') || text.includes('m²')) area_raw = text;
    }

    // IPTU / Condomínio
    let iptu_raw = null;
    const priceInfos = el.querySelectorAll('.olx-adcard__price-info');
    for (const info of priceInfos) {
      const text = info.textContent.toLowerCase();
      if (text.includes('iptu')) iptu_raw = info.textContent.replace(/iptu/i, '').trim();
    }

    // Quebrar localização (Cidade, Bairro)
    let city_raw = null;
    let neighbourhood = null;
    if (location) {
      const parts = location.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        city_raw = parts[0];
        neighbourhood = parts[1];
      } else {
        city_raw = location;
      }
    }

    return {
      external_id: String(id),
      title: String(title),
      url: String(url),
      price_raw: price_raw,
      listing_kind: null,
      location: location,
      neighbourhood: neighbourhood,
      city_raw: city_raw,
      state_raw: null,
      category_raw: null,
      real_estate_type_raw: null,
      kind: kindFromTitleOrUrl(title, url),
      date_raw: date_raw,
      image_url: image_url,
      iptu_raw: iptu_raw,
      bedrooms_raw: bedrooms_raw,
      bathrooms_raw: bathrooms_raw,
      garage_spaces_raw: garage_spaces_raw,
      area_raw: area_raw,
    };
  }

  function normalize(s) {
    if (!s) return "";
    return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function kindFromTitleOrUrl(title, url) {
    const t = normalize(title) + " " + normalize(url);
    if (/\b(aluguel|alugar|locacao|para alugar)\b/.test(t)) return "aluguel";
    if (/\b(venda|vender|a venda|comprar|compra)\b/.test(t)) return "venda";
    
    // Fallback olhando a URL da página atual de busca
    const pageUrl = normalize(window.location.href);
    if (pageUrl.includes('/venda/')) return "venda";
    if (pageUrl.includes('/aluguel/')) return "aluguel";
    
    return "venda"; // Default para não perder o item caso a página misture
  }

  function isVendaOuAluguel(it) {
    return !!(it && (it.kind === "venda" || it.kind === "aluguel"));
  }
})();
