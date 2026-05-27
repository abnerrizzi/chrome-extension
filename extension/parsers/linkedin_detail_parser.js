// Parser LinkedIn — página de detalhe (/jobs/view/<id>) ou o painel direito
// renderizado em /jobs/search/?currentJobId=<id>. Emite um único item com o
// mesmo external_id da lista, enriquecido com description/seniority/posted_at/
// workplace_type/skills. O upsert por external_id no backend mescla sobre a
// linha já criada pela busca.
//
// Selectors em um único bloco — LinkedIn troca classes com frequência.
(function () {
  const SELECTORS = {
    title:        ".job-details-jobs-unified-top-card__job-title, .top-card-layout__title, .topcard__title, h1",
    company:      ".job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name, .topcard__org-name-link, .topcard__flavor",
    locationLine: ".job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__primary-description, .topcard__flavor--bullet",
    // Chips abaixo do título: tipo de vaga, nível, modalidade, etc.
    insightChip:  ".job-details-jobs-unified-top-card__job-insight, .job-details-fit-level-preferences span, .description__job-criteria-text",
    description:  ".jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, #job-details",
    // Posted: <time datetime="..."> quando disponível; senão texto relativo.
    postedTime:   "time",
    postedFallback: ".jobs-unified-top-card__posted-date, .posted-time-ago__text, .job-details-jobs-unified-top-card__primary-description-container span",
    // Skills no card "How you match" — só renderiza para logados.
    skillChip:    ".job-details-how-you-match__skills-section li, .job-details-skill-match-status-list li, .job-details-how-you-match-card__skills-item",
  };

  // Mapas de keyword → valor canônico para classificar os chips de insight.
  const WORKPLACE_KEYWORDS = [
    { rx: /\bremote\b/i,                 v: "Remote" },
    { rx: /\bhybrid\b|\bhíbrido\b/i,     v: "Hybrid" },
    { rx: /\bon[- ]site\b|\bpresencial\b/i, v: "On-site" },
  ];
  const SENIORITY_KEYWORDS = [
    { rx: /\bentry\b|\bestagi(o|ário)\b/i,           v: "Entry level" },
    { rx: /\bassociate\b|\bjunior\b/i,               v: "Associate" },
    { rx: /\bmid[- ]?senior\b|\bpleno\b/i,           v: "Mid-Senior level" },
    { rx: /\bsenior\b/i,                             v: "Senior" },
    { rx: /\bdirector\b|\bdiretor\b/i,               v: "Director" },
    { rx: /\bexecutive\b|\bexecutivo\b/i,            v: "Executive" },
    { rx: /\binternship\b|\bestágio\b/i,             v: "Internship" },
  ];

  // chrome.runtime.id vira undefined depois que a extensão é recarregada.
  // O MutationObserver continua vivo na página até o navegador derrubar o frame,
  // então protegemos toda chamada a chrome.* atrás de extensionAlive() e
  // desligamos o observer assim que detectarmos contexto morto.
  let obs = null;

  runOnce();

  // O LinkedIn troca o painel direito sem navegação completa quando o usuário
  // clica em outro card. Observar o container e re-emitir.
  if (extensionAlive()) {
    const root = document.querySelector(".jobs-details__main-content, .jobs-search__job-details, main");
    if (root) {
      obs = new MutationObserver(debounce(runOnce, 500));
      obs.observe(root, { childList: true, subtree: true });
    }
  }

  // ---------- main ----------

  function runOnce() {
    if (!extensionAlive()) {
      disconnectAndStop();
      return;
    }
    const externalId = extractExternalId();
    const job_title = textOf(document, SELECTORS.title);
    if (!externalId || !job_title) {
      // Sem id ou título, não conseguimos enriquecer nada.
      send([]);
      return;
    }
    const chips = collectChips();
    const item = {
      external_id:    externalId,
      job_title,
      company:        textOf(document, SELECTORS.company),
      location:       textOf(document, SELECTORS.locationLine),
      url:            canonicalUrl(externalId),
      description:    textOf(document, SELECTORS.description),
      seniority:      matchKeyword(chips, SENIORITY_KEYWORDS),
      workplace_type: matchKeyword(chips, WORKPLACE_KEYWORDS),
      posted_at:      readPostedAt(),
      skills:         readSkills(),
    };
    send([item]);
  }

  // ---------- helpers ----------

  function extractExternalId() {
    // /jobs/view/<id>?...
    const m = location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m) return m[1];
    // /jobs/search/?currentJobId=<id>
    const cj = new URLSearchParams(location.search).get("currentJobId");
    if (cj && /^\d+$/.test(cj)) return cj;
    // último recurso: data-job-id no container principal
    const el = document.querySelector("[data-job-id]");
    return el ? el.getAttribute("data-job-id") : null;
  }

  function canonicalUrl(id) {
    return `${location.origin}/jobs/view/${id}/`;
  }

  function collectChips() {
    return Array.from(document.querySelectorAll(SELECTORS.insightChip))
      .map((el) => el.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function matchKeyword(chips, table) {
    for (const c of chips) {
      for (const { rx, v } of table) {
        if (rx.test(c)) return v;
      }
    }
    return null;
  }

  function readPostedAt() {
    // Preferência: <time datetime="2026-05-20T...">
    const t = document.querySelector(SELECTORS.postedTime);
    const iso = t && t.getAttribute("datetime");
    if (iso) return iso;
    // Fallback texto relativo — backend converte para ISO.
    return textOf(document, SELECTORS.postedFallback);
  }

  function readSkills() {
    const nodes = document.querySelectorAll(SELECTORS.skillChip);
    if (!nodes.length) return null;
    const skills = [];
    const seen = new Set();
    for (const n of nodes) {
      const txt = n.textContent.replace(/\s+/g, " ").trim();
      // Cards de match às vezes prefixam "Skill match" / "Add skill" — descartar.
      const cleaned = txt.replace(/^(add|edit|skill match[:]?)\s+/i, "").trim();
      if (!cleaned || cleaned.length > 80 || seen.has(cleaned)) continue;
      seen.add(cleaned);
      skills.push(cleaned);
    }
    return skills.length ? skills : null;
  }

  function textOf(root, sel) {
    const node = root.querySelector(sel);
    return node ? node.textContent.replace(/\s+/g, " ").trim() : null;
  }

  function send(items) {
    if (!extensionAlive()) {
      disconnectAndStop();
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: "DOM_COUNT",
        domain: "linkedin",
        // Canal de enriquecimento: o background só faz upsert no backend e NÃO
        // deixa esta vaga única sobrescrever a lista no badge/popup.
        kind: "detail",
        count: items.length,
        items,
      });
    } catch (err) {
      // Race entre extensionAlive() e sendMessage: o runtime pode cair entre
      // o guard e a chamada. Desliga o observer e segue silencioso.
      if (/Extension context invalidated/i.test(err.message)) {
        disconnectAndStop();
      } else {
        console.debug("[linkedin_detail_parser] sendMessage falhou:", err.message);
      }
    }
  }

  function extensionAlive() {
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
