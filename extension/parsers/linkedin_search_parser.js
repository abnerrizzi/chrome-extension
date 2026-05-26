// Parser LinkedIn — lista de resultados de busca (/jobs/search, /jobs/collections/*).
// MV3: arquivo estático, sem eval. Selectors concentrados num único bloco — o
// LinkedIn troca classes com frequência; manter a lista pequena e óbvia
// facilita ajustes pontuais.
//
// Emite items rasos: external_id (data-job-id), job_title, company, location, url.
// A página de detalhe (linkedin_detail_parser.js) usa o mesmo external_id para
// enriquecer a linha via upsert no backend.
(function () {
  const SELECTORS = {
    // LinkedIn loga: <main>…<ul><li id="ember<N>" data-occludable-job-id="…">.
    // O id="ember<N>" é gerado pelo Ember e troca a cada render — usar
    // `id^="ember"` apenas como anchor estrutural, nunca como identificador.
    cardInList:    ':scope > li[id^="ember"]',
    cardFallback:  "li.jobs-search-results__list-item, li.scaffold-layout__list-item, div[data-job-id]",
    title:         ".job-card-list__title, .job-card-list__title--link, a.job-card-list__title, .job-card-container__link, h3",
    company:       ".job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name, h4",
    location:      ".job-card-container__metadata-item, .artdeco-entity-lockup__caption",
    // "1,234 results" no header da lista (versão logada). Pego como metadata.
    totalCount:    '#main header small:nth-of-type(2), header small:nth-of-type(2), .jobs-search-results-list__subtitle',
  };

  runOnce();

  // Lazy-load: o LinkedIn injeta cards conforme o usuário rola a lista.
  // Observar o <main> inteiro (o <ul> aparece/some entre renders do Ember).
  const observerRoot = document.querySelector("main") || document.body;
  const obs = new MutationObserver(debounce(runOnce, 400));
  obs.observe(observerRoot, { childList: true, subtree: true });

  // ---------- main ----------

  function runOnce() {
    const list = findResultsList();
    const cards = list
      ? list.querySelectorAll(SELECTORS.cardInList)
      : document.querySelectorAll(SELECTORS.cardFallback);
    const seen = new Set();
    const items = [];
    for (const el of cards) {
      const item = toItem(el);
      if (!item || !item.external_id || seen.has(item.external_id)) continue;
      seen.add(item.external_id);
      items.push(item);
    }
    send(items, readTotalAvailable());
  }

  // ---------- helpers ----------

  // Localiza o <ul> de resultados: o <ul> dentro de <main> com mais filhos
  // diretos do tipo <li id="ember…"> vence. Resistente a Ember IDs voláteis e
  // à presença de outros <ul> (nav, recomendações etc.).
  function findResultsList() {
    const candidates = document.querySelectorAll("main ul");
    let best = null;
    let bestCount = 0;
    for (const ul of candidates) {
      const n = ul.querySelectorAll(':scope > li[id^="ember"]').length;
      if (n > bestCount) {
        best = ul;
        bestCount = n;
      }
    }
    return best;
  }

  function toItem(el) {
    const externalId = extractExternalId(el);
    const job_title = textOf(el, SELECTORS.title);
    if (!job_title) return null;
    return {
      external_id: externalId,
      job_title,
      company:  textOf(el, SELECTORS.company),
      location: textOf(el, SELECTORS.location),
      url:      linkOf(el),
    };
  }

  function extractExternalId(el) {
    // Fontes, em ordem de confiabilidade:
    //   1. data-occludable-job-id no próprio <li> (LinkedIn moderno, logado).
    //   2. data-job-id no <li> ou em qualquer descendente.
    //   3. /jobs/view/<id>/ extraído do anchor canônico.
    // Nunca usar id="ember<N>" — é volátil entre renders.
    const direct =
      el.getAttribute("data-occludable-job-id") ||
      el.getAttribute("data-job-id");
    if (direct) return direct;
    const nested = el.querySelector("[data-occludable-job-id], [data-job-id]");
    if (nested) {
      return (
        nested.getAttribute("data-occludable-job-id") ||
        nested.getAttribute("data-job-id")
      );
    }
    const a = el.querySelector('a[href*="/jobs/view/"]');
    if (a) {
      const m = a.getAttribute("href").match(/\/jobs\/view\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function readTotalAvailable() {
    // "1,234 results" / "32 vagas" — pegar primeiro inteiro do texto.
    const el = document.querySelector(SELECTORS.totalCount);
    if (!el) return null;
    const m = el.textContent.replace(/[.,]/g, "").match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function textOf(root, sel) {
    const node = root.querySelector(sel);
    return node ? node.textContent.replace(/\s+/g, " ").trim() : null;
  }

  function linkOf(root) {
    // Prefere o anchor que aponta para /jobs/view/<id> (link canônico do card).
    const direct = root.querySelector('a[href*="/jobs/view/"]');
    if (direct) return new URL(direct.getAttribute("href"), location.origin).href;
    const fallback = root.querySelector("a[href]");
    return fallback ? new URL(fallback.getAttribute("href"), location.origin).href : null;
  }

  function send(items, totalAvailable) {
    const msg = {
      type: "DOM_COUNT",
      domain: "linkedin",
      count: items.length,
      items,
    };
    if (typeof totalAvailable === "number") msg.totalAvailable = totalAvailable;
    chrome.runtime.sendMessage(msg);
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
})();
