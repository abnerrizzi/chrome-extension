// Parser OLX (imóveis / casas) baseado em __NEXT_DATA__ ao invés do DOM.
// O Next.js do OLX serializa toda a listagem como JSON no <script id="__NEXT_DATA__">,
// o que é dramaticamente mais estável que querySelector em classes ofuscadas.
//
// Estratégia:
//   1. Lê __NEXT_DATA__ e parseia.
//   2. Procura o array de ads em vários caminhos conhecidos (OLX renomeia de tempos em tempos).
//   3. Para cada ad, extrai os campos no mesmo shape que o normalizer Python espera.
//   4. Filtra apenas casas.
//   5. Loga no console o caminho que funcionou (útil para diagnóstico futuro).
//
(function () {
  const data = readNextData();
  if (!data) {
    chrome.runtime.sendMessage({
      type: "DOM_COUNT", domain: "olx", count: 0, items: [],
      debug: "__NEXT_DATA__ ausente",
    });
    return;
  }

  const { ads, path } = findAds(data);
  if (!ads) {
    console.warn("[olx_parser] não localizei array de ads. Top-level keys:", topKeys(data));
    chrome.runtime.sendMessage({
      type: "DOM_COUNT", domain: "olx", count: 0, items: [],
      debug: "ads array não encontrado",
    });
    return;
  }
  console.info(`[olx_parser] ${ads.length} ads em ${path}`);

  const items = ads.map(toItem).filter(Boolean).filter(isHouse);

  chrome.runtime.sendMessage({
    type: "DOM_COUNT", domain: "olx", count: items.length, items,
  });

  // ---------- helpers ----------

  function readNextData() {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    try { return JSON.parse(el.textContent); }
    catch (e) { console.error("[olx_parser] JSON.parse falhou:", e); return null; }
  }

  function findAds(root) {
    const candidates = [
      "props.pageProps.ads",
      "props.pageProps.listingProps.ads",
      "props.pageProps.listProps.ads",
      "props.pageProps.data.ads",
      "props.pageProps.searchProps.ads",
      "props.pageProps.initialState.adsListing.ads",
      "props.pageProps.initialState.search.ads",
    ];
    for (const path of candidates) {
      const v = getPath(root, path);
      if (Array.isArray(v) && v.length > 0) return { ads: v, path };
    }
    return { ads: null, path: null };
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function topKeys(o, depth = 2) {
    if (!o || depth === 0 || typeof o !== "object") return o;
    const out = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      out[k] = (v && typeof v === "object") ? topKeys(v, depth - 1) : typeof v;
    }
    return out;
  }

  function toItem(ad) {
    if (!ad || typeof ad !== "object") return null;
    const id = ad.listId || ad.id || ad.adId || null;
    const url = ad.url || ad.friendlyUrl || ad.canonicalUrl || null;
    const title = ad.subject || ad.title || null;
    if (!title || !url) return null;

    const price_raw = priceToString(ad.price ?? ad.priceValue ?? ad.oldPrice);
    const image_url = pickImage(ad);
    const listing_kind = ad.categoryName || ad.category || ad.subCategoryName || null;

    const loc = ad.location || ad.locationProperties || {};
    const location = [loc.neighbourhood, loc.city, loc.uf || loc.state]
      .filter(Boolean).join(", ") || null;

    const date_raw = ad.publishedAt || ad.listTime || ad.created || null;
    const props = ad.properties || ad.attributes || [];

    return {
      external_id: id != null ? String(id) : null,
      title: String(title),
      url: String(url),
      price_raw,
      listing_kind,
      location,
      date_raw: date_raw ? String(date_raw) : null,
      image_url,
      iptu_raw: findPropValue(props, ["iptu", "condominio_iptu"]),
      bedrooms_raw: findPropValue(props, ["rooms", "bedrooms", "quartos"]),
      bathrooms_raw: findPropValue(props, ["bathrooms", "banheiros"]),
      garage_spaces_raw: findPropValue(props, ["garage_spaces", "vagas", "garage"]),
      area_raw: findPropValue(props, ["size", "area", "useful_area", "useful_areas"]),
    };
  }

  function priceToString(v) {
    if (v == null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "number") return "R$ " + v.toLocaleString("pt-BR");
    return null;
  }

  function pickImage(ad) {
    const imgs = ad.images || ad.thumbnails || [];
    if (Array.isArray(imgs) && imgs.length) {
      const first = imgs[0];
      if (typeof first === "string") return first;
      return first.original || first.large || first.medium || first.thumbnail || null;
    }
    return ad.thumbnail || ad.image || null;
  }

  function findPropValue(props, names) {
    if (!Array.isArray(props)) return null;
    const want = new Set(names.map((n) => n.toLowerCase()));
    for (const p of props) {
      if (!p) continue;
      const key = String(p.name || p.label || "").toLowerCase();
      if (want.has(key)) {
        return String(p.value ?? p.label ?? "");
      }
    }
    return null;
  }

  function isHouse(it) {
    if (!it) return false;
    if (it.listing_kind && /\bcasa\b/i.test(it.listing_kind)) return true;
    if (it.url && /\/imoveis\/casa/i.test(it.url)) return true;
    if (it.title && /\bcasa\b/i.test(it.title)) return true;
    return false;
  }
})();
