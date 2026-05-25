// Parser dedicado para OLX classificados. Tolerante a A/B layouts.
(function () {
  const cards = document.querySelectorAll('a[data-ds-component="DS-AdCard"], li.sc-1fcmfeb-2');
  const items = Array.from(cards).map((el) => ({
    title: textOf(el, 'h2, [data-ds-component="DS-Text"]'),
    price_raw: textOf(el, '[data-testid="ds-adcard-price"], .sc-1kn4z61-2'),
    location: textOf(el, '[data-ds-component="DS-Text"][color="secondary"]'),
    url: el.href || null,
  })).filter((x) => x.title);

  chrome.runtime.sendMessage({
    type: "DOM_COUNT",
    domain: "olx",
    count: items.length,
    items,
  });

  function textOf(root, sel) {
    const node = root.querySelector(sel);
    return node ? node.textContent.trim() : null;
  }
})();
