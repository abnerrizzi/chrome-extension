// Parser LinkedIn — lista de resultados de busca (/jobs/search*, /jobs/collections/*).
// MV3: arquivo estático, sem eval. Selectors concentrados num único bloco — o
// LinkedIn troca classes com frequência; manter a lista pequena e óbvia
// facilita ajustes pontuais.
//
// VIRTUALIZAÇÃO: o LinkedIn mantém um <li data-occludable-job-id> por vaga
// (todos os ~25), mas só RENDERIZA o conteúdo (<div data-job-id> com título,
// empresa, local) dos ~7 cards perto do viewport — os demais são placeholders
// vazios (classe `occludable-update`). Por isso um snapshot único só vê ~7.
// Estratégia (passiva, sem auto-scroll): acumular por external_id entre
// execuções; conforme o usuário rola, novos cards renderizam, o MutationObserver
// dispara runOnce() e a união cresce até `totalAvailable`. O upsert por
// external_id no backend torna o re-POST da união idempotente.
(function () {
  const SELECTORS = {
    // Dois DOMs: LOGADO (SPA Ember — `artdeco-entity-lockup`, `<ul>` de classe
    // ofuscada, `<li data-occludable-job-id>`) e GUEST/deslogado (HTML
    // server-rendered — `base-search-card`, `ul.jobs-search__results-list`).
    // A extensão roda logado; os seletores `base-*`/`job-search-card__*` são o
    // fallback guest, portados do scraper Selenium de referência
    // (jobhubmine/scrapers/linkedin-ff-selenium). Ordem: logado primeiro.
    cardFallback:
      "li.scaffold-layout__list-item, li.jobs-search-results__list-item, " +
      "ul.jobs-search__results-list > li, li.base-card, div[data-job-id]",
    // Título: logado duplica o texto num par <span aria-hidden>+<span
    // visually-hidden> — cleanText() resolve; guest é h3.base-search-card__title.
    title:
      ".artdeco-entity-lockup__title, .job-card-list__title--link, " +
      ".job-card-list__title, h3.base-search-card__title",
    company:
      ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, " +
      "h4.base-search-card__subtitle",
    location:
      ".artdeco-entity-lockup__caption, .job-card-container__metadata-wrapper, " +
      ".job-card-container__metadata-item, span.job-search-card__location",
    // Total de vagas: logado ("1.234 results" no header) + guest
    // (results-context-header__job-count).
    totalCount:
      "#main header small:nth-of-type(2), header small:nth-of-type(2), " +
      ".jobs-search-results-list__subtitle, span.results-context-header__job-count",
  };

  // União acumulada das vagas vistas nesta injeção, por external_id.
  const accumulated = new Map();
  let lastTotal = -1;

  // Quando o Chrome recarrega a extensão, os content scripts injetados continuam
  // vivos na página mas o runtime sumiu — qualquer chrome.runtime.sendMessage
  // lança "Extension context invalidated". Guardamos com chrome.runtime?.id e
  // desligamos o observer assim que detectarmos.
  let obs = null;

  runOnce();

  // Lazy-load: cards renderizam conforme o usuário rola. Observar o <main>
  // (o <ul> aparece/some entre renders) e re-rodar; o debounce coalesce rajadas.
  if (extensionAlive()) {
    const observerRoot = document.querySelector("main") || document.body;
    obs = new MutationObserver(debounce(runOnce, 350));
    obs.observe(observerRoot, { childList: true, subtree: true });
  }

  // ---------- main ----------

  function runOnce() {
    if (!extensionAlive()) {
      disconnectAndStop();
      return;
    }
    let changed = false;
    for (const el of cardElements()) {
      let item;
      try {
        item = toItem(el);
      } catch (err) {
        // Um card malformado não deve abortar a emissão — pula e segue.
        console.debug("[linkedin_search_parser] card ignorado:", err.message);
        continue;
      }
      if (!item) continue; // placeholder ocluso (sem título) ou sem id
      const prev = accumulated.get(item.external_id);
      if (!prev || fieldScore(item) > fieldScore(prev)) {
        accumulated.set(item.external_id, item);
        changed = true;
      }
    }
    const total = readTotalAvailable();
    if (changed || total !== lastTotal) {
      lastTotal = total;
      send([...accumulated.values()], total);
    }
  }

  // ---------- helpers ----------

  // Os <li data-occludable-job-id> do <ul> com mais desses filhos diretos.
  // Sinal estável (vs. classe ofuscada do <ul> ou ids "ember" voláteis).
  function cardElements() {
    let best = null;
    let bestCount = 0;
    for (const ul of document.querySelectorAll("main ul")) {
      const n = ul.querySelectorAll(":scope > li[data-occludable-job-id]").length;
      if (n > bestCount) {
        best = ul;
        bestCount = n;
      }
    }
    if (best) return best.querySelectorAll(":scope > li[data-occludable-job-id]");
    const within = document.querySelectorAll("main li[data-occludable-job-id]");
    if (within.length) return within;
    // Guest/deslogado: lista server-rendered sem data-occludable-job-id.
    const guest = document.querySelectorAll("ul.jobs-search__results-list > li, li.base-card");
    if (guest.length) return guest;
    return document.querySelectorAll(SELECTORS.cardFallback);
  }

  function toItem(el) {
    const external_id = extractExternalId(el);
    if (!external_id) return null;
    const job_title = cleanTitle(el.querySelector(SELECTORS.title));
    if (!job_title) return null; // card ocluso ainda não renderizado — ignora
    return {
      external_id,
      job_title,
      company: cleanText(el.querySelector(SELECTORS.company)),
      location: cleanText(el.querySelector(SELECTORS.location)),
      // URL canônica a partir do id (o href vivo carrega um ?eBP=… gigante).
      url: `${location.origin}/jobs/view/${external_id}/`,
    };
  }

  function extractExternalId(el) {
    // Ordem de confiabilidade (logado → guest). Nunca usar id="ember…".
    // 1. data-occludable-job-id / data-job-id (logado, no <li> ou descendente).
    const direct =
      el.getAttribute("data-occludable-job-id") || el.getAttribute("data-job-id");
    if (direct) return direct;
    const nested = el.querySelector("[data-occludable-job-id], [data-job-id]");
    if (nested) {
      return (
        nested.getAttribute("data-occludable-job-id") ||
        nested.getAttribute("data-job-id")
      );
    }
    // 2. data-entity-urn (guest, em div.base-card) → dígitos. Ex.:
    //    "urn:li:jobPosting:4415550496".
    const urnEl = el.matches("[data-entity-urn]")
      ? el
      : el.querySelector("[data-entity-urn]");
    const urn = urnEl && urnEl.getAttribute("data-entity-urn");
    if (urn) {
      const digits = urn.replace(/\D/g, "");
      if (digits) return digits;
    }
    // 3. dígitos finais em /jobs/view/<id>/ ou /view/<slug>-<id> (guest).
    const a = el.querySelector('a[href*="/jobs/view/"], a.base-card__full-link');
    const href = a && a.getAttribute("href");
    const m = href && href.match(/\/(?:jobs\/)?view\/(?:[^/?#]*?-)?(\d+)/);
    return m ? m[1] : null;
  }

  // Quantos campos opcionais vieram preenchidos — usado para não regredir um
  // card já bom quando um render parcial (sem empresa/local) reaparece.
  function fieldScore(it) {
    return (it.company ? 1 : 0) + (it.location ? 1 : 0);
  }

  // Texto limpo de um nó. Alguns layouts do LinkedIn duplicam o texto com
  // <span aria-hidden="true">T</span><span class="visually-hidden">T</span>
  // (textContent = "TT"); preferir a cópia aria-hidden evita a duplicação.
  function cleanText(node) {
    if (!node) return null;
    const visible = node.querySelector('[aria-hidden="true"]');
    const raw = (visible ? visible.textContent : node.textContent) || "";
    return raw.replace(/\s+/g, " ").trim() || null;
  }

  // O título vem com o local embutido entre parênteses (texto de a11y):
  // "Senior Product Design Manager ( São Paulo, Brasil)". O parêntese de local
  // tem um espaço logo após "(" — distinto de um "(Backend)" de título real —,
  // então removemos só esse sufixo. O local completo vem da caption.
  function cleanTitle(node) {
    const t = cleanText(node);
    if (!t) return null;
    return t.replace(/\s*\(\s[^)]*\)\s*$/, "").trim() || t;
  }

  function readTotalAvailable() {
    // "1,234 results" / "32 vagas" — primeiro inteiro do texto.
    const el = document.querySelector(SELECTORS.totalCount);
    if (!el) return null;
    const m = el.textContent.replace(/[.,]/g, "").match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function send(items, totalAvailable) {
    if (!extensionAlive()) {
      disconnectAndStop();
      return;
    }
    const msg = {
      type: "DOM_COUNT",
      domain: "linkedin",
      count: items.length,
      items,
    };
    if (typeof totalAvailable === "number") msg.totalAvailable = totalAvailable;
    try {
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      // Race entre extensionAlive() e sendMessage: o runtime pode cair entre o
      // guard e a chamada. Desliga o observer e segue silencioso.
      if (/Extension context invalidated/i.test(err.message)) {
        disconnectAndStop();
      } else {
        console.debug("[linkedin_search_parser] sendMessage falhou:", err.message);
      }
    }
  }

  function extensionAlive() {
    // chrome.runtime.id vira undefined após a extensão ser recarregada — sinal
    // canônico de contexto inválido em content scripts MV3.
    return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
  }

  function disconnectAndStop() {
    if (obs) {
      obs.disconnect();
      obs = null;
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
})();
