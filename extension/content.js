// Content script genérico. Em produção é substituído pelos parsers/<domain>_parser.js
// registrados dinamicamente pelo background.js. Mantido como fallback para depuração.

(function () {
  const host = window.location.hostname;
  // Detecção minimalista sem string-exec — todos os seletores são literais estáticos.
  let count = 0;
  let domain = "unknown";

  if (host.endsWith("olx.com.br")) {
    domain = "olx";
    count = document.querySelectorAll('a[data-ds-component="DS-AdCard"]').length;
  } else if (host.endsWith("auctions.example")) {
    domain = "auctions";
    count = document.querySelectorAll('.lot-card, [data-lot-id]').length;
  } else {
    return; // Domínio não suportado — não envia nada.
  }

  chrome.runtime.sendMessage({
    type: "DOM_COUNT",
    domain,
    count,
    items: [], // os parsers específicos preenchem este array
  });
})();
