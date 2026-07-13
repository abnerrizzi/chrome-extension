// Parser dedicado para sites de leilões. Roda inclusive em iframes (allFrames: true).
(async function () {
  const logPrefs = await chrome.storage.sync.get({ consoleLogEnabled: true, consoleLogLevel: "info" });
  const originalInfo = console.info;
  const originalDebug = console.debug;
  console.info = (...args) => { if (logPrefs.consoleLogEnabled) originalInfo.apply(console, args); };
  console.debug = (...args) => { if (logPrefs.consoleLogEnabled && logPrefs.consoleLogLevel === 'debug') originalDebug.apply(console, args); };

  const cards = document.querySelectorAll('.lot-card, [data-lot-id]');
  const items = Array.from(cards).map((el) => {
    const lot_code = el.getAttribute('data-lot-id') || textOf(el, '.lot-code');
    return {
      external_id: lot_code,
      lot_code,
      title: textOf(el, '.lot-title, h3'),
      current_bid_raw: textOf(el, '.current-bid, [data-field="bid"]'),
      auction_end_raw: textOf(el, '.auction-end, time[datetime]'),
      url: linkOf(el),
    };
  }).filter((x) => x.lot_code && x.title);

  chrome.runtime.sendMessage({
    type: "DOM_COUNT",
    domain: "auctions",
    count: items.length,
    items,
  });

  function textOf(root, sel) {
    const node = root.querySelector(sel);
    return node ? node.textContent.trim() : null;
  }
  function linkOf(root) {
    const a = root.querySelector('a[href]');
    return a ? a.href : null;
  }
})();
