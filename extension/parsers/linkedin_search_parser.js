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
    // Cada card vira um item. LinkedIn varia entre <li class="jobs-search-results__list-item">
    // e wrappers com data-job-id (collections, scaffold-layout). Cobrir os dois.
    card:     "li.jobs-search-results__list-item, li.scaffold-layout__list-item, div[data-job-id]",
    title:    ".job-card-list__title, .job-card-list__title--link, a.job-card-list__title, .job-card-container__link, h3",
    company:  ".job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name, h4",
    location: ".job-card-container__metadata-item, .artdeco-entity-lockup__caption",
    // Container observado para re-emitir quando o LinkedIn carrega cards lazily.
    listRoot: ".jobs-search-results-list, .scaffold-layout__list, main",
  };

  runOnce();

  // Lazy-load: o LinkedIn injeta cards conforme o usuário rola a lista.
  // Observar o container e re-emitir; o background.js já deduplica por hash.
  const root = document.querySelector(SELECTORS.listRoot);
  if (root) {
    const obs = new MutationObserver(debounce(runOnce, 400));
    obs.observe(root, { childList: true, subtree: true });
  }

  // ---------- main ----------

  function runOnce() {
    const cards = document.querySelectorAll(SELECTORS.card);
    const seen = new Set();
    const items = [];
    for (const el of cards) {
      const item = toItem(el);
      if (!item || !item.external_id || seen.has(item.external_id)) continue;
      seen.add(item.external_id);
      items.push(item);
    }
    send(items);
  }

  // ---------- helpers ----------

  function toItem(el) {
    const externalId =
      el.getAttribute("data-job-id") ||
      el.querySelector("[data-job-id]")?.getAttribute("data-job-id") ||
      null;
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

  function send(items) {
    chrome.runtime.sendMessage({
      type: "DOM_COUNT",
      domain: "linkedin",
      count: items.length,
      items,
    });
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
})();
