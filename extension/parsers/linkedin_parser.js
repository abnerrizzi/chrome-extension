// Parser LinkedIn (vagas) — duas situações, dois DOMs.
//
// LinkedIn é um SPA Ember (sem __NEXT_DATA__): tudo vem do DOM. Há DUAS
// experiências com markup completamente diferente, detectadas em runtime:
//   • GUEST (deslogado, /jobs/search/): lista server-rendered em
//     ul.jobs-search__results-list > div.base-card; detalhe em /jobs/view/NNN.
//   • LOGGEDIN (SPA): lista VIRTUALIZADA (li[data-occludable-job-id], ~7 cards
//     no DOM por vez) + painel de detalhe lateral (URL ganha ?currentJobId=NNN).
//
// Duas páginas → dois domínios emitidos:
//   • lista   → DOM_COUNT domain="linkedin"        (tabela linkedin_jobs)
//   • detalhe → DOM_COUNT domain="linkedin_detail" (tabela linkedin_job_details)
// O external_id (id numérico do jobPosting) une as duas linhas no banco.
//
// Lista virtualizada → ACUMULAÇÃO PASSIVA: um MutationObserver re-parseia a cada
// scroll do usuário e funde os cards num Map dedupado por id; o array crescente
// inteiro é re-enviado. O estado vive em `window` para sobreviver às re-injeções
// via executeScript (pushState mantém o mesmo document; reload zera = novo search).
//
// ⚠️ Os seletores SEL.LOGGEDIN são best-effort e NÃO foram validados contra uma
//    captura logada real. Cada campo degrada para null (nunca lança). Validar e
//    corrigir esta tabela com uma captura logada antes de confiar nos dados.

(function () {
  const KEY = "__linkedinParserState";

  // Re-injeção na mesma página (pushState): estado já existe → só re-parseia,
  // sem empilhar um novo observer.
  if (window[KEY] && window[KEY].installed) {
    if (!window[KEY].stopped && typeof window[KEY].runOnce === "function") {
      window[KEY].runOnce();
    }
    return;
  }

  const state = {
    installed: true,
    stopped: false,
    acc: new Map(),       // external_id|url -> item da lista (last-write-wins)
    observer: null,
    debounceTimer: null,
    lastSig: {},          // domínio -> assinatura do último envio (anti-spam)
    runOnce: null,
  };
  window[KEY] = state;

  const DEBOUNCE_MS = 350;
  const EMIT_DETAIL_ALONGSIDE_LIST = true;

  const SEL = {
    GUEST: {
      list: {
        container: "ul.jobs-search__results-list",
        card: "ul.jobs-search__results-list div.base-card",
        title: "h3.base-search-card__title",
        company: "h4.base-search-card__subtitle",
        location: "span.job-search-card__location",
        posted: "time",
        url: "a.base-card__full-link",
      },
      detail: {
        title: "h1.top-card-layout__title, h1.topcard__title",
        company: "a.topcard__org-name-link, span.topcard__flavor a, span.topcard__flavor",
        location: "span.topcard__flavor--bullet",
        description: "div.show-more-less-html__markup, div.description__text",
        criteria: "li.description__job-criteria-item",
        applicants: "figcaption.num-applicants__caption, span.num-applicants__caption",
      },
    },
    // ⚠️ UNVERIFIED — validar contra captura logada real (ST-021).
    LOGGEDIN: {
      list: {
        container: "div.scaffold-layout__list, div.jobs-search-results-list",
        card: "li[data-occludable-job-id]",
        title: "a.job-card-list__title, a.job-card-container__link",
        company: ".artdeco-entity-lockup__subtitle",
        location: ".job-card-container__metadata-item",
        posted: "time",
        url: "a.job-card-container__link, a.job-card-list__title",
      },
      detail: {
        title: ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title",
        company: ".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name",
        location: ".job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet",
        description: "#job-details, .jobs-description__content",
        insights: ".job-details-jobs-unified-top-card__job-insight",
      },
    },
  };

  // ---------- guardas MV3 / DOM ----------

  function extensionAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function disconnectAndStop() {
    state.stopped = true;
    if (state.debounceTimer) { clearTimeout(state.debounceTimer); state.debounceTimer = null; }
    if (state.observer) { try { state.observer.disconnect(); } catch (_) {} state.observer = null; }
  }

  function handleError(e) {
    const msg = (e && e.message) || "";
    if (/context invalidated/i.test(msg)) disconnectAndStop();
    else console.debug("[linkedin_parser]", msg);
  }

  function safeText(root, sel) {
    if (!root || !sel) return null;
    try { const n = root.querySelector(sel); const t = n && (n.textContent || "").trim(); return t || null; }
    catch (_) { return null; }
  }
  function safeAttr(root, sel, attr) {
    if (!root || !sel) return null;
    try { const n = root.querySelector(sel); const v = n && n.getAttribute(attr); return (v && v.trim()) || null; }
    catch (_) { return null; }
  }
  function safeHref(root, sel) {
    if (!root || !sel) return null;
    try { const n = root.querySelector(sel); return (n && (n.getAttribute("href") || n.href)) || null; }
    catch (_) { return null; }
  }
  function attrOf(el, name) {
    try { const v = el && el.getAttribute(name); return (v && v.trim()) || null; } catch (_) { return null; }
  }

  function digits(s) {
    if (s == null) return null;
    const m = String(s).match(/\d{4,}/) || String(s).match(/\d+/);
    return m ? m[0] : null;
  }
  function qp(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (_) { return null; }
  }
  function absUrl(href) {
    if (!href) return null;
    try { return new URL(href, location.origin).href.split(/[?#]/)[0]; } catch (_) { return href; }
  }
  function externalIdFromUrl(href) {
    if (!href) return null;
    const s = String(href);
    let m = s.match(/currentJobId=(\d+)/);
    if (m) return m[1];
    m = s.match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/);  // /view/NNN ou /view/slug-NNN
    if (m) return m[1];
    m = s.match(/(\d{6,})/);
    return m ? m[1] : null;
  }

  // ---------- detecção de contexto ----------

  function isLoggedInDetailOpen() {
    return !!qp("currentJobId") && !!document.querySelector(SEL.LOGGEDIN.detail.title);
  }

  function detectContext() {
    const path = location.pathname;
    const guestList = document.querySelector(SEL.GUEST.list.container);
    const loggedInCard = document.querySelector(SEL.LOGGEDIN.list.card);

    // Lista tem prioridade — acumulação por scroll é o caso principal.
    if (guestList) {
      return { view: "guest", page: "list", sel: SEL.GUEST.list };
    }
    if (loggedInCard) {
      return { view: "loggedin", page: "list", sel: SEL.LOGGEDIN.list };
    }

    // Detalhe dedicado (/jobs/view/...). Distingue guest x logado pelos marcadores.
    const onViewPath = /^\/jobs\/view\//.test(path);
    const hasGuestDetail = document.querySelector(SEL.GUEST.detail.description)
                        || document.querySelector(SEL.GUEST.detail.title);
    if (onViewPath && hasGuestDetail) {
      return { view: "guest", page: "detail", sel: SEL.GUEST.detail };
    }
    if (isLoggedInDetailOpen() || onViewPath) {
      return { view: "loggedin", page: "detail", sel: SEL.LOGGEDIN.detail };
    }
    return null;  // authwall, feed, mensagens etc.
  }

  // ---------- extração ----------

  function extractGuestCard(el) {
    const s = SEL.GUEST.list;
    const href = safeHref(el, s.url);
    const id = digits(attrOf(el, "data-entity-urn")) || externalIdFromUrl(href);
    return {
      external_id: id || null,
      title: safeText(el, s.title),
      company: safeText(el, s.company),
      location: safeText(el, s.location),
      url: absUrl(href),
      posted_raw: safeAttr(el, s.posted, "datetime") || safeText(el, s.posted),
      source_view: "guest",
    };
  }

  function extractLoggedInCard(el) {
    const s = SEL.LOGGEDIN.list;
    const href = safeHref(el, s.url);
    const id = digits(attrOf(el, "data-occludable-job-id")) || externalIdFromUrl(href);
    return {
      external_id: id || null,
      title: safeText(el, s.title),
      company: safeText(el, s.company),
      location: safeText(el, s.location),
      url: absUrl(href),
      posted_raw: safeAttr(el, s.posted, "datetime") || safeText(el, s.posted),
      source_view: "loggedin",
    };
  }

  function parseGuestCriteria() {
    const out = { seniority: null, employment_type: null };
    try {
      document.querySelectorAll(SEL.GUEST.detail.criteria).forEach((li) => {
        const label = (li.querySelector("h3")?.textContent || "").trim().toLowerCase();
        const value = (li.querySelector("span")?.textContent || "").trim();
        if (!value) return;
        if (/senior|n[ií]vel|experience/.test(label)) out.seniority = value;
        else if (/employment|tipo de emprego|regime|contrato/.test(label)) out.employment_type = value;
      });
    } catch (_) {}
    return out;
  }

  // Pílulas de insight logado vêm como texto livre, às vezes combinado
  // ("Full-time · Mid-Senior level"). Quebra em tokens e classifica cada um.
  function classifyInsights() {
    const out = { seniority: null, employment_type: null, applicants_raw: null };
    const tokens = [];
    try {
      document.querySelectorAll(SEL.LOGGEDIN.detail.insights).forEach((el) => {
        (el.textContent || "").split(/[·•|]/).forEach((p) => {
          const t = p.trim();
          if (t) tokens.push(t);
        });
      });
    } catch (_) {}
    for (const tok of tokens) {
      const t = tok.toLowerCase();
      if (!out.applicants_raw && /applicant|candidat/.test(t)) out.applicants_raw = tok;
      else if (!out.employment_type && /\b(full-time|part-time|contract|temporary|internship|freelance|tempo integral|meio per[ií]odo|est[aá]gio|contrato|tempor[aá]rio)\b/.test(t)) out.employment_type = tok;
      else if (!out.seniority && /\b(entry level|associate|mid-senior|senior|director|executive|trainee|n[ií]vel)\b/.test(t)) out.seniority = tok;
    }
    return out;
  }

  function extractGuestDetail() {
    const s = SEL.GUEST.detail;
    const crit = parseGuestCriteria();
    const id = externalIdFromUrl(location.href);
    return {
      external_id: id || null,
      title: safeText(document, s.title),
      company: safeText(document, s.company),
      location: safeText(document, s.location),
      url: absUrl(location.href),
      description: safeText(document, s.description),
      seniority: crit.seniority,
      employment_type: crit.employment_type,
      applicants_raw: safeText(document, s.applicants),
      source_view: "guest",
    };
  }

  function extractLoggedInDetail() {
    const s = SEL.LOGGEDIN.detail;
    const id = qp("currentJobId") || externalIdFromUrl(location.href);
    const cls = classifyInsights();
    return {
      external_id: id || null,
      title: safeText(document, s.title),
      company: safeText(document, s.company),
      location: safeText(document, s.location),
      url: id ? `https://www.linkedin.com/jobs/view/${id}/` : absUrl(location.href),
      description: safeText(document, s.description),
      seniority: cls.seniority,
      employment_type: cls.employment_type,
      applicants_raw: cls.applicants_raw,
      source_view: "loggedin",
    };
  }

  // ---------- acumulador ----------

  function mergeIntoAccumulator(items) {
    for (const it of items) {
      const key = it.external_id || it.url;
      if (key) state.acc.set(key, it);
    }
  }
  function accumulatedItems() {
    return Array.from(state.acc.values());
  }

  // ---------- envio ----------

  function signature(domain, items) {
    return domain + "|" + items
      .map((i) => (i.external_id || i.url || "") + ":" + (i.description ? i.description.length : ""))
      .join(",");
  }

  function emit(domain, count, items, debug) {
    if (state.stopped || !extensionAlive()) return;
    const sig = signature(domain, items);
    if (state.lastSig[domain] === sig) return;  // nada mudou — não re-envia
    const msg = { type: "DOM_COUNT", domain, count, items };
    if (debug) msg.debug = debug;
    try {
      chrome.runtime.sendMessage(msg);
      state.lastSig[domain] = sig;
    } catch (e) {
      handleError(e);
    }
  }

  function emitList(ctx) {
    const items = [];
    try {
      document.querySelectorAll(ctx.sel.card).forEach((el) => {
        const it = ctx.view === "guest" ? extractGuestCard(el) : extractLoggedInCard(el);
        if (it && (it.external_id || it.url) && it.title) items.push(it);
      });
    } catch (e) { handleError(e); }
    mergeIntoAccumulator(items);
    const all = accumulatedItems();
    emit("linkedin", all.length, all, `${ctx.view} list; rendered=${items.length} acc=${all.length}`);
  }

  function emitDetail(view) {
    const it = view === "guest" ? extractGuestDetail() : extractLoggedInDetail();
    if (!it || (!it.external_id && !it.url) || !it.title) return;  // painel meio carregado
    emit("linkedin_detail", 1, [it], `${view} detail; id=${it.external_id || "?"}`);
  }

  // ---------- orquestração ----------

  function runOnce() {
    if (state.stopped) return;
    try {
      const ctx = detectContext();
      if (!ctx) {
        emit("linkedin", 0, [], "sem DOM de vagas (authwall/feed?)");
        return;
      }
      ensureObserver();
      if (ctx.page === "list") {
        emitList(ctx);
        // Logado com painel aberto: emite o detalhe da vaga aberta também.
        if (EMIT_DETAIL_ALONGSIDE_LIST && ctx.view === "loggedin" && isLoggedInDetailOpen()) {
          emitDetail("loggedin");
        }
      } else {
        emitDetail(ctx.view);
      }
    } catch (e) {
      handleError(e);
    }
  }

  function scheduleReparse() {
    if (state.stopped) return;
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      runOnce();
    }, DEBOUNCE_MS);
  }

  function ensureObserver() {
    if (state.stopped || state.observer) return;
    // Observa o body inteiro: cobre tanto a virtualização da lista quanto o
    // preenchimento tardio do painel de detalhe. O debounce + a assinatura
    // anti-spam + o dedupe por hash no background contêm a verbosidade.
    try {
      const obs = new MutationObserver(() => scheduleReparse());
      obs.observe(document.body, { childList: true, subtree: true });
      state.observer = obs;
    } catch (e) { handleError(e); }
  }

  state.runOnce = runOnce;
  runOnce();
})();
