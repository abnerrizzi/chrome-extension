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
  if (window.__lastPncpDetailUrl === currentUrl) return;
  window.__lastPncpDetailUrl = currentUrl;

  const apiBase = window.location.origin + "/api/consulta";
  const apiUrl = `${apiBase}/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;

  console.info(`[pncp_detail_parser] Buscando detalhes via API: ${cnpj}/${ano}/${seq}`);

  const itemsUrl = `${window.location.origin}/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=5000`;

  /**
   * Extrai os itens da tabela renderizada no DOM da página.
   * Captura o texto exibido em cada célula, incluindo "Sigiloso" quando aplicável.
   * Retorna um Map<numero_item, {valor_unitario_raw, valor_total_raw, quantidade_raw}>.
   */
  function extractDomItems() {
    const domMap = new Map();
    // A aba "Itens" é a pncp-tab ativa; as linhas ficam em datatable-body-row
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

  Promise.all([
    fetch(apiUrl).then(res => {
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);
      return res.json();
    }),
    fetch(itemsUrl).then(res => res.ok ? res.json() : [])
  ])
    .then(([data, itemsList]) => {
      // Extrai textos exibidos na página (captura "Sigiloso", valores formatados, etc.)
      const domMap = extractDomItems();

      const itens = (itemsList || []).map(pi => {
        const num = Number(pi.numeroItem || 0);
        const dom = domMap.get(num) || {};

        // Valor numérico vindo da API (null quando sigiloso)
        const valorUnitNum = pi.valorUnitarioEstimado != null ? Number(pi.valorUnitarioEstimado) : null;
        const valorTotalNum = pi.valorTotal != null ? Number(pi.valorTotal) : null;

        // Texto exibido na página (ex: "Sigiloso", ou o número formatado)
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
        external_id: String(data.numeroControlePNCP || `${cnpj}/${ano}/${seq}`),
        pncp_id: String(data.numeroControlePNCP || ""),
        numero_edital: data.numeroCompra && data.anoCompra ? `Edital nº ${data.numeroCompra}/${data.anoCompra}` : "",
        modalidade: String(data.modalidadeNome || ""),
        modo_disputa: String(data.modoDisputaNome || ""),
        orgao_cnpj: String(data.orgaoEntidade?.cnpj || ""),
        orgao_razao_social: String(data.orgaoEntidade?.razaoSocial || ""),
        municipio: String(data.unidadeOrgao?.municipioNome || ""),
        uf: String(data.unidadeOrgao?.ufSigla || ""),
        objeto: String(data.objetoCompra || ""),
        valor_total_estimado_raw: data.valorTotalEstimado != null ? String(data.valorTotalEstimado) : null,
        valor_total_homologado_raw: data.valorTotalHomologado != null ? String(data.valorTotalHomologado) : null,
        situacao: String(data.situacaoCompraNome || ""),
        srp: data.srp === true,
        amparo_legal: String(data.amparoLegal?.nome || ""),
        data_publicacao_pncp_raw: String(data.dataPublicacaoPncp || ""),
        data_abertura_proposta_raw: String(data.dataAberturaProposta || ""),
        data_encerramento_proposta_raw: String(data.dataEncerramentoProposta || ""),
        link_sistema_origem: String(data.linkSistemaOrigem || ""),
        url: currentUrl,
        itens: itens,
      };

      chrome.runtime.sendMessage({
        type: "DOM_COUNT",
        domain: "pncp_detail",
        count: 1,
        items: [item]
      });
    })
    .catch(err => {
      console.error("[pncp_detail_parser] Erro ao buscar detalhes do edital:", err);
    });
})();
