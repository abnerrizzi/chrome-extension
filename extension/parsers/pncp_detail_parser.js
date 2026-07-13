// Parser para a página de detalhes do PNCP (pncp.gov.br/app/editais/{cnpj}/{ano}/{seq})
(async function () {
  const logPrefs = await chrome.storage.sync.get({ consoleLogEnabled: true, consoleLogLevel: "info" });
  const originalInfo = console.info;
  const originalError = console.error; // Also wrapping error just to be safe, though usually errors are always logged, but let's keep consistent. Actually, just info and debug were requested.
  const originalDebug = console.debug;
  console.info = (...args) => { if (logPrefs.consoleLogEnabled) originalInfo.apply(console, args); };
  console.debug = (...args) => { if (logPrefs.consoleLogEnabled && logPrefs.consoleLogLevel === 'debug') originalDebug.apply(console, args); };

  const path = window.location.pathname;
  const match = path.match(/\/editais\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return;

  const cnpj = match[1];
  const ano = match[2];
  const seq = match[3];
  const currentUrl = window.location.href;

  let apiDataCache = null;
  let itemsListCache = null;
  let isFetching = false;
  let lastHash = "";

  function fetchApiData() {
    if (apiDataCache || isFetching) return Promise.resolve();
    isFetching = true;
    const apiBase = window.location.origin + "/api/consulta";
    const apiUrl = `${apiBase}/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
    const itemsUrl = `${window.location.origin}/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=5000`;
    console.info(`[pncp_detail_parser] Buscando detalhes via API: ${cnpj}/${ano}/${seq}`);

    return Promise.all([
      fetch(apiUrl).then(res => {
        if (!res.ok) throw new Error(`HTTP status ${res.status}`);
        return res.json();
      }),
      fetch(itemsUrl).then(res => res.ok ? res.json() : [])
    ]).then(([data, itemsList]) => {
      apiDataCache = data;
      itemsListCache = itemsList;
      isFetching = false;
    }).catch(err => {
      console.error("[pncp_detail_parser] Erro ao buscar detalhes do edital:", err);
      isFetching = false;
    });
  }

  runOnce();

  if (window.__pncpDetailObserver) {
    window.__pncpDetailObserver.disconnect();
  }
  let timeout = null;
  const observer = new MutationObserver(() => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(runOnce, 800);
  });
  window.__pncpDetailObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });

  /**
   * Extrai os itens da tabela renderizada no DOM da página.
   * Captura o texto exibido em cada célula, incluindo "Sigiloso" quando aplicável.
   * Retorna um Map<numero_item, {valor_unitario_raw, valor_total_raw, quantidade_raw}>.
   */
  function extractDomItems() {
    const domMap = new Map();
    const rows = document.querySelectorAll(
      "pncp-tab datatable-body datatable-body-row"
    );
    rows.forEach(row => {
      const cells = row.querySelectorAll("datatable-body-cell");
      if (cells.length < 5) return;
      const getCellText = (cell) => {
        const span = cell.querySelector("span[title], span.ng-star-inserted");
        return span ? span.textContent.trim() : cell.textContent.trim();
      };
      const numeroRaw = getCellText(cells[0]);
      const numero = parseInt(numeroRaw, 10);
      if (isNaN(numero)) return;
      domMap.set(numero, {
        valor_unitario_estimado_raw: getCellText(cells[3]),
        valor_total_raw:             getCellText(cells[4]),
        quantidade_raw:              getCellText(cells[2]),
      });
    });
    return domMap;
  }

  async function runOnce() {
    await fetchApiData();
    if (!apiDataCache) return; // falhou na requisição

    const domMap = extractDomItems();

    const itens = (itemsListCache || []).map(pi => {
      const num = Number(pi.numeroItem || 0);
      const dom = domMap.get(num) || {};

      const valorUnitNum = pi.valorUnitarioEstimado != null ? Number(pi.valorUnitarioEstimado) : null;
      const valorTotalNum = pi.valorTotal != null ? Number(pi.valorTotal) : null;

      const valorUnitarioRaw = dom.valor_unitario_estimado_raw ||
        (valorUnitNum != null ? String(valorUnitNum) : null);
      const valorTotalRaw = dom.valor_total_raw ||
        (valorTotalNum != null ? String(valorTotalNum) : null);

      return {
        numero_item:                 num,
        descricao:                   String(pi.descricao || ""),
        material_ou_servico:         String(pi.materialOuServico || ""),
        valor_unitario_estimado:     valorUnitNum,
        valor_unitario_estimado_raw: valorUnitarioRaw,
        valor_total:                 valorTotalNum,
        valor_total_raw:             valorTotalRaw,
        quantidade:                  pi.quantidade != null ? Number(pi.quantidade) : null,
        unidade_medida:              String(pi.unidadeMedida || "").trim(),
        situacao:                    String(pi.situacaoCompraItemNome || pi.situacaoCompraItem || ""),
      };
    });

    const item = {
      external_id: String(apiDataCache.numeroControlePNCP || `${cnpj}/${ano}/${seq}`),
      pncp_id: String(apiDataCache.numeroControlePNCP || ""),
      numero_edital: apiDataCache.numeroCompra && apiDataCache.anoCompra ? `Edital nº ${apiDataCache.numeroCompra}/${apiDataCache.anoCompra}` : "",
      modalidade: String(apiDataCache.modalidadeNome || ""),
      modo_disputa: String(apiDataCache.modoDisputaNome || ""),
      orgao_cnpj: String(apiDataCache.orgaoEntidade?.cnpj || ""),
      orgao_razao_social: String(apiDataCache.orgaoEntidade?.razaoSocial || ""),
      municipio: String(apiDataCache.unidadeOrgao?.municipioNome || ""),
      uf: String(apiDataCache.unidadeOrgao?.ufSigla || ""),
      objeto: String(apiDataCache.objetoCompra || ""),
      valor_total_estimado_raw: apiDataCache.valorTotalEstimado != null ? String(apiDataCache.valorTotalEstimado) : null,
      valor_total_homologado_raw: apiDataCache.valorTotalHomologado != null ? String(apiDataCache.valorTotalHomologado) : null,
      situacao: String(apiDataCache.situacaoCompraNome || ""),
      srp: apiDataCache.srp === true,
      amparo_legal: String(apiDataCache.amparoLegal?.nome || ""),
      data_publicacao_pncp_raw: String(apiDataCache.dataPublicacaoPncp || ""),
      data_abertura_proposta_raw: String(apiDataCache.dataAberturaProposta || ""),
      data_encerramento_proposta_raw: String(apiDataCache.dataEncerramentoProposta || ""),
      link_sistema_origem: String(apiDataCache.linkSistemaOrigem || ""),
      url: currentUrl,
      itens: itens,
    };

    // Gera um hash simples dos valores raw capturados do DOM para não enviar repetido
    const currentHash = itens.map(i => `${i.numero_item}:${i.valor_unitario_estimado_raw}:${i.valor_total_raw}`).join("|");
    if (currentHash === lastHash && currentHash !== "") return;
    lastHash = currentHash;

    chrome.runtime.sendMessage({
      type: "DOM_COUNT",
      domain: "pncp_detail",
      count: 1,
      items: [item]
    });
  }
})();
