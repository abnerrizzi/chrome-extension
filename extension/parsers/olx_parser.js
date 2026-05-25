// Parser OLX especializado em CASAS (categoria imóveis).
// Tolerante a layout A/B. Filtra cards que claramente não são casas.
(function () {
  const sections = document.querySelectorAll('section.olx-adcard');

  const items = Array.from(sections).map(toItem).filter(isHouse);

  chrome.runtime.sendMessage({
    type: "DOM_COUNT",
    domain: "olx",
    count: items.length,
    items,
  });

  function toItem(root) {
    const link  = root.querySelector('a[data-testid="adcard-link"]');
    const title = textOf(root, 'h2.olx-adcard__title') || (link && link.title) || null;
    const url   = link ? link.href : null;
    const price_raw = textOf(root, 'h3.olx-adcard__price');
    const listing_kind = textOf(root, '.olx-adcard__mediumbody > div:first-child');
    const location = textOf(root, 'p.olx-adcard__location');
    const date_raw = textOf(root, 'p.olx-adcard__date');
    const image_url = imgOf(root);

    // IPTU vem como "IPTU R$ 1.000" dentro de .olx-adcard__price-info
    const iptu_raw = (() => {
      const nodes = root.querySelectorAll('[data-testid="adcard-price-info"]');
      for (const n of nodes) {
        const t = n.textContent.trim();
        if (/IPTU/i.test(t)) return t;
      }
      return null;
    })();

    // Detalhes vêm em .olx-adcard__detail com aria-label tipo "3 quartos"
    const details = Array.from(root.querySelectorAll('.olx-adcard__detail'))
      .map((el) => el.getAttribute('aria-label') || el.textContent.trim());

    const findDetail = (regex) => details.find((d) => regex.test(d)) || null;

    return {
      external_id: idFromUrl(url),
      title,
      url,
      price_raw,
      listing_kind,
      location,
      date_raw,
      image_url,
      iptu_raw,
      bedrooms_raw:      findDetail(/quart/i),
      bathrooms_raw:     findDetail(/banheir/i),
      garage_spaces_raw: findDetail(/(garagem|vaga)/i),
      area_raw:          findDetail(/(metros|m²)/i),
    };
  }

  // URL termina em "...-<id-numerico>" — ex: ".../casa-terrea-no-setor-jao-1500645324"
  function idFromUrl(url) {
    if (!url) return null;
    try {
      const tail = new URL(url).pathname.split('-').pop();
      return /^\d+$/.test(tail) ? tail : null;
    } catch {
      return null;
    }
  }

  function isHouse(it) {
    if (!it.title || !it.url) return false;
    if (/\/imoveis\/casa/i.test(it.url)) return true;
    if (it.listing_kind && /^\s*casa/i.test(it.listing_kind)) return true;
    if (/\bcasa\b/i.test(it.title)) return true;
    return false;
  }

  function textOf(root, sel) {
    const node = root.querySelector(sel);
    return node ? node.textContent.trim() : null;
  }

  function imgOf(root) {
    const src = root.querySelector('picture source[type="image/webp"]');
    if (src && src.getAttribute('srcset')) return src.getAttribute('srcset').split(' ')[0];
    const img = root.querySelector('picture img');
    return img ? img.src : null;
  }
})();
