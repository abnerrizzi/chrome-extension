// Parser para a página de detalhes do PNCP (pncp.gov.br/app/editais/{cnpj}/{ano}/{seq})
(function () {
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

  Promise.all([
    fetch(apiUrl).then(res => {
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);
      return res.json();
    }),
    fetch(itemsUrl).then(res => res.ok ? res.json() : [])
  ])
    .then(([data, itemsList]) => {
      const itens = (itemsList || []).map(pi => ({
        numero_item: Number(pi.numeroItem || 0),
        descricao: String(pi.descricao || ""),
        material_ou_servico: String(pi.materialOuServico || ""),
        valor_unitario_estimado: pi.valorUnitarioEstimado != null ? Number(pi.valorUnitarioEstimado) : null,
        valor_total: pi.valorTotal != null ? Number(pi.valorTotal) : null,
        quantidade: pi.quantidade != null ? Number(pi.quantidade) : null,
        unidade_medida: String(pi.unidadeMedida || "").trim(),
        situacao: String(pi.situacaoCompraItemNome || pi.situacaoCompraItem || ""),
      }));

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
