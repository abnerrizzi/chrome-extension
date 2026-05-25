// Parser dedicado para LinkedIn. Arquivo estático — MV3 proíbe execução de strings.
(function () {
  const cards = document.querySelectorAll('li.jobs-search-results__list-item, [data-job-id]');
  const items = Array.from(cards).map((el) => ({
    external_id: el.getAttribute('data-job-id')
      || el.querySelector('[data-job-id]')?.getAttribute('data-job-id')
      || null,
    job_title: textOf(el, '.job-card-list__title, h3'),
    company: textOf(el, '.job-card-container__primary-description, h4'),
    location: textOf(el, '.job-card-container__metadata-item'),
    url: linkOf(el),
  })).filter((x) => x.job_title);

  chrome.runtime.sendMessage({
    type: "DOM_COUNT",
    domain: "linkedin",
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
