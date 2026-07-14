/* Line of Sight tool — api: anonymous Wikimedia Commons API reads.
   Generic query helpers plus cached fetchers for attribution (author/license)
   and categories. Writes live in save.js. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const C = LOS.config;
  const U = LOS.util;

  function apiGET(params) {
    // origin=* enables CORS for anonymous reads; maxlag=5 is API politeness.
    const p = new URLSearchParams({
      action: "query", format: "json", origin: "*", maxlag: "5", ...params,
    });
    return fetch(`${C.COMMONS_API}?${p}`).then((r) => r.json());
  }

  /** Follow API continuation to the end, merging `query.pages` by pageid (a
      prop over a generator returns PARTIAL pages per continue batch) and
      concatenating any `query` list arrays (categorymembers, prefixsearch, …). */
  async function apiGETAll(params, cap) {
    const pages = new Map();
    const lists = {};
    let cont = null;
    let truncated = false;
    for (let guard = 0; guard < 50; guard++) {
      const data = await apiGET(cont ? { ...params, ...cont } : params);
      if (data && data.error) throw new Error(data.error.info || data.error.code);
      const q = data && data.query;
      if (q && q.pages) {
        for (const pg of Object.values(q.pages)) {
          const key = pg.pageid != null ? pg.pageid : pg.title;
          const prev = pages.get(key);
          if (prev) {
            for (const k of Object.keys(pg)) {
              if (Array.isArray(pg[k]) && Array.isArray(prev[k])) prev[k] = prev[k].concat(pg[k]);
              else if (prev[k] === undefined) prev[k] = pg[k];
            }
          } else {
            pages.set(key, pg);
          }
        }
      }
      if (q) {
        for (const k of Object.keys(q)) {
          if (k !== "pages" && Array.isArray(q[k])) lists[k] = (lists[k] || []).concat(q[k]);
        }
      }
      if (!data || !data.continue) break;
      if (cap && pages.size >= cap) { truncated = true; break; }
      cont = data.continue;
    }
    return { pages: [...pages.values()], lists, truncated };
  }

  // ---- Attribution (author/license) — fetched lazily on hover/click ----------
  const ATTR_FALLBACK = { author: "Unknown author", authorHtml: "", license: "" };
  const attrCache = new Map();    // title -> {author, authorHtml, license}
  const attrInflight = new Map(); // title -> Promise

  function parseAttr(page) {
    const em = page?.imageinfo?.[0]?.extmetadata || {};
    const artistHtml = em.Artist?.value || "";
    return {
      author: U.stripTags(artistHtml) || "Unknown author",
      authorHtml: U.sanitizeHtml(artistHtml) || "",
      license: em.LicenseShortName?.value || "",
    };
  }

  function fetchAttribution(title) {
    if (attrCache.has(title)) return Promise.resolve(attrCache.get(title));
    if (attrInflight.has(title)) return attrInflight.get(title);

    // extmetadata is "expensive" per the Commons API docs — one title at a time,
    // only when the user actually looks at a photo.
    const p = apiGET({
      titles: title,
      prop: "imageinfo",
      iiprop: "extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|Attribution|Credit",
    })
      .then((data) => {
        const pages = data?.query?.pages;
        const first = pages && Object.values(pages)[0];
        const attr = first ? parseAttr(first) : ATTR_FALLBACK;
        attrCache.set(title, attr);
        attrInflight.delete(title);
        return attr;
      })
      .catch(() => {
        attrInflight.delete(title);
        attrCache.set(title, ATTR_FALLBACK); // don't refetch a failing title
        return ATTR_FALLBACK;
      });

    attrInflight.set(title, p);
    return p;
  }

  /** Called when a photo is evicted — its attribution can be refetched later. */
  const dropAttribution = (title) => attrCache.delete(title);

  // ---- Commons categories (lazy, cached) --------------------------------------
  const fileCatsCache = new Map(); // "File:X" -> ["Category:A", …] (non-hidden)
  const catInfoCache = new Map();  // "Category:A" -> {files, subcats}

  /** Non-hidden categories per file title; batches of 50, cached. */
  async function fetchFileCategories(titles) {
    const missing = titles.filter((t) => !fileCatsCache.has(t));
    for (const batch of U.chunk(missing, 50)) {
      const res = await apiGETAll({
        titles: batch.join("|"),
        prop: "categories", clshow: "!hidden", cllimit: "500", redirects: "1",
      });
      for (const pg of res.pages) {
        if (!pg.title) continue;
        fileCatsCache.set(pg.title, (pg.categories || []).map((c) => c.title));
      }
      // Files the API didn't echo back (missing/normalized) — cache as empty.
      for (const t of batch) if (!fileCatsCache.has(t)) fileCatsCache.set(t, []);
    }
    const out = new Map();
    for (const t of titles) out.set(t, fileCatsCache.get(t) || []);
    return out;
  }

  /** {files, subcats} per category title; batches of 50, cached. */
  async function fetchCategoryInfo(cats) {
    const missing = cats.filter((c) => !catInfoCache.has(c));
    for (const batch of U.chunk(missing, 50)) {
      const data = await apiGET({ titles: batch.join("|"), prop: "categoryinfo" });
      const pages = data?.query?.pages;
      if (pages) {
        for (const pg of Object.values(pages)) {
          const ci = pg.categoryinfo || {};
          if (pg.title) catInfoCache.set(pg.title, { files: ci.files || 0, subcats: ci.subcats || 0 });
        }
      }
      for (const c of batch) if (!catInfoCache.has(c)) catInfoCache.set(c, { files: 0, subcats: 0 });
    }
  }

  /** Every file in a category, WITH its coordinates when it has any — files
      without a location are the whole point (they get placed in this tool). */
  function fetchCategoryFiles(catTitle) {
    return apiGETAll({
      generator: "categorymembers", gcmtitle: catTitle, gcmtype: "file", gcmlimit: "500",
      prop: "coordinates", coprop: "type|name", coprimary: "all", colimit: "500",
    }, C.CAT_FILES_CAP);
  }

  async function fetchSubcats(catTitle) {
    const res = await apiGETAll({
      list: "categorymembers", cmtitle: catTitle, cmtype: "subcat", cmlimit: "500",
    });
    return (res.lists.categorymembers || []).map((m) => m.title);
  }

  const catShort = (cat) => String(cat).replace(/^Category:/, "");

  /** "N files · M subcats" — shown EVERYWHERE a category is named, from the
      shared cache ("" until fetchCategoryInfo has run for it). */
  function catCounts(cat) {
    const info = catInfoCache.get(cat);
    if (!info) return "";
    return `${U.plural(info.files, "file")} · ${U.plural(info.subcats, "subcat")}`;
  }

  LOS.api = {
    apiGET, apiGETAll,
    fetchAttribution, dropAttribution,
    fetchFileCategories, fetchCategoryInfo, fetchCategoryFiles, fetchSubcats,
    catShort, catCounts,
    catInfo: (cat) => catInfoCache.get(cat),
  };
})();
