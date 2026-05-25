// Parser OLX (imóveis / casas) baseado em __NEXT_DATA__.
// Estrutura confirmada via inspeção de uma página real de busca:
//   props.pageProps.ads[]
//     subject, title, priceValue ("R$ 2.600.000"), oldPrice
//     listId (int), url, friendlyUrl
//     categoryName ("Casas"), category
//     origListTime / date (unix epoch SEGUNDOS)
//     images[].original, images[].originalWebp
//     location (string plana) | locationDetails {municipality, neighbourhood, uf, ddd}
//     properties[] {name, label, value}
//       names úteis: size, rooms, bathrooms, garage_spaces, iptu, condominio, real_estate_type
//
(function () {
  const data = readNextData();
  if (!data) {
    sendCount(0, [], "__NEXT_DATA__ ausente");
    return;
  }

  const ads = getPath(data, "props.pageProps.ads");
  if (!Array.isArray(ads)) {
    console.warn("[olx_parser] props.pageProps.ads não é array. Top keys:", Object.keys(data.props?.pageProps || {}));
    sendCount(0, [], "ads array não encontrado");
    return;
  }
  console.info(`[olx_parser] ${ads.length} ads na página`);

  const items = ads.map(toItem).filter(Boolean).filter(isHouse);
  sendCount(items.length, items);

  // ---------- helpers ----------

  function readNextData() {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    try { return JSON.parse(el.textContent); }
    catch (e) { console.error("[olx_parser] JSON.parse falhou:", e); return null; }
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function sendCount(count, items, debug) {
    const msg = { type: "DOM_COUNT", domain: "olx", count, items };
    if (debug) msg.debug = debug;
    chrome.runtime.sendMessage(msg);
  }

  function toItem(ad) {
    if (!ad || typeof ad !== "object") return null;
    const id = ad.listId ?? ad.id ?? null;
    const url = ad.url || ad.friendlyUrl || null;
    const title = ad.subject || ad.title || null;
    if (!title || !url || id == null) return null;

    const dateRaw = ad.origListTime ?? ad.date;
    return {
      external_id: String(id),
      title: String(title),
      url: String(url),
      price_raw: ad.priceValue || null,
      listing_kind: ad.categoryName || ad.category || null,
      location: formatLocation(ad),
      // schema OLX define `date_raw` como string; origListTime vem como int.
      date_raw: dateRaw != null ? String(dateRaw) : null,
      image_url: pickImage(ad),
      iptu_raw: findProp(ad.properties, "iptu"),
      bedrooms_raw: findProp(ad.properties, "rooms"),
      bathrooms_raw: findProp(ad.properties, "bathrooms"),
      garage_spaces_raw: findProp(ad.properties, "garage_spaces"),
      area_raw: findProp(ad.properties, "size"),
    };
  }

  function formatLocation(ad) {
    const ld = ad.locationDetails;
    if (ld && (ld.neighbourhood || ld.municipality)) {
      return [ld.neighbourhood, ld.municipality, ld.uf].filter(Boolean).join(", ");
    }
    return ad.location || null;
  }

  function pickImage(ad) {
    const imgs = ad.images;
    if (!Array.isArray(imgs) || imgs.length === 0) return ad.thumbnail || null;
    const first = imgs[0];
    if (typeof first === "string") return first;
    return first.originalWebp || first.original || first.medium || first.thumbnail || null;
  }

  function findProp(props, name) {
    if (!Array.isArray(props)) return null;
    const want = name.toLowerCase();
    for (const p of props) {
      if (p && String(p.name || "").toLowerCase() === want) {
        return p.value != null ? String(p.value) : null;
      }
    }
    return null;
  }

  function isHouse(it) {
    if (!it) return false;
    // categoryName === "Casas" é o sinal mais confiável (vem do classificador OLX).
    if (it.listing_kind && /^casas?$/i.test(it.listing_kind.trim())) return true;
    if (it.url && /\/imoveis\/casa/i.test(it.url)) return true;
    if (it.title && /\bcasa\b/i.test(it.title)) return true;
    return false;
  }
})();
