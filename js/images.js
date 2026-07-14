/* Line of Sight tool — images: fast thumbnail URLs + an in-session image cache.

   Thumbnail URLs: Special:FilePath/<title>?width=N goes through a MediaWiki
   redirect on EVERY image — an extra round-trip to commons.wikimedia.org
   before the real thumbnail on upload.wikimedia.org even starts downloading.
   Commons thumb paths are deterministic (md5 of the underscored filename), so
   for the common formats we build the direct URL and skip the redirect.
   Formats whose thumb names aren't plain "<w>px-<name>" (tiff/pdf/video/…)
   keep the FilePath URL, and any direct URL that errors (e.g. a width larger
   than the original) falls back to FilePath via the data-fallback listener.

   Image cache: Wikimedia thumbs ship NO Cache-Control header, so the
   browser's heuristic cache may revalidate over the network every time the
   same photo is displayed again. Instead each URL is fetched exactly once per
   session (upload.wikimedia.org answers CORS with *), kept as a blob
   object-URL, and every later display — re-hover, reopened modal, reopened
   tray — is served straight from memory. LRU-bounded by bytes; when the fetch
   path can't be used (HTTP error, blocked request) the caller falls back to a
   native <img> load → FilePath chain. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const C = LOS.config;

  // ---- Compact MD5 (hex of the UTF-8 bytes) — only used to build thumb paths.
  // Public-domain implementation (Joseph Myers style).
  const add32 = (a, b) => (a + b) & 0xffffffff;
  function md5cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  const md5ff = (a, b, c, d, x, s, t) => md5cmn((b & c) | (~b & d), a, b, x, s, t);
  const md5gg = (a, b, c, d, x, s, t) => md5cmn((b & d) | (c & ~d), a, b, x, s, t);
  const md5hh = (a, b, c, d, x, s, t) => md5cmn(b ^ c ^ d, a, b, x, s, t);
  const md5ii = (a, b, c, d, x, s, t) => md5cmn(c ^ (b | ~d), a, b, x, s, t);

  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = md5ff(a, b, c, d, k[0], 7, -680876936);   d = md5ff(d, a, b, c, k[1], 12, -389564586);
    c = md5ff(c, d, a, b, k[2], 17, 606105819);   b = md5ff(b, c, d, a, k[3], 22, -1044525330);
    a = md5ff(a, b, c, d, k[4], 7, -176418897);   d = md5ff(d, a, b, c, k[5], 12, 1200080426);
    c = md5ff(c, d, a, b, k[6], 17, -1473231341); b = md5ff(b, c, d, a, k[7], 22, -45705983);
    a = md5ff(a, b, c, d, k[8], 7, 1770035416);   d = md5ff(d, a, b, c, k[9], 12, -1958414417);
    c = md5ff(c, d, a, b, k[10], 17, -42063);     b = md5ff(b, c, d, a, k[11], 22, -1990404162);
    a = md5ff(a, b, c, d, k[12], 7, 1804603682);  d = md5ff(d, a, b, c, k[13], 12, -40341101);
    c = md5ff(c, d, a, b, k[14], 17, -1502002290);b = md5ff(b, c, d, a, k[15], 22, 1236535329);
    a = md5gg(a, b, c, d, k[1], 5, -165796510);   d = md5gg(d, a, b, c, k[6], 9, -1069501632);
    c = md5gg(c, d, a, b, k[11], 14, 643717713);  b = md5gg(b, c, d, a, k[0], 20, -373897302);
    a = md5gg(a, b, c, d, k[5], 5, -701558691);   d = md5gg(d, a, b, c, k[10], 9, 38016083);
    c = md5gg(c, d, a, b, k[15], 14, -660478335); b = md5gg(b, c, d, a, k[4], 20, -405537848);
    a = md5gg(a, b, c, d, k[9], 5, 568446438);    d = md5gg(d, a, b, c, k[14], 9, -1019803690);
    c = md5gg(c, d, a, b, k[3], 14, -187363961);  b = md5gg(b, c, d, a, k[8], 20, 1163531501);
    a = md5gg(a, b, c, d, k[13], 5, -1444681467); d = md5gg(d, a, b, c, k[2], 9, -51403784);
    c = md5gg(c, d, a, b, k[7], 14, 1735328473);  b = md5gg(b, c, d, a, k[12], 20, -1926607734);
    a = md5hh(a, b, c, d, k[5], 4, -378558);      d = md5hh(d, a, b, c, k[8], 11, -2022574463);
    c = md5hh(c, d, a, b, k[11], 16, 1839030562); b = md5hh(b, c, d, a, k[14], 23, -35309556);
    a = md5hh(a, b, c, d, k[1], 4, -1530992060);  d = md5hh(d, a, b, c, k[4], 11, 1272893353);
    c = md5hh(c, d, a, b, k[7], 16, -155497632);  b = md5hh(b, c, d, a, k[10], 23, -1094730640);
    a = md5hh(a, b, c, d, k[13], 4, 681279174);   d = md5hh(d, a, b, c, k[0], 11, -358537222);
    c = md5hh(c, d, a, b, k[3], 16, -722521979);  b = md5hh(b, c, d, a, k[6], 23, 76029189);
    a = md5hh(a, b, c, d, k[9], 4, -640364487);   d = md5hh(d, a, b, c, k[12], 11, -421815835);
    c = md5hh(c, d, a, b, k[15], 16, 530742520);  b = md5hh(b, c, d, a, k[2], 23, -995338651);
    a = md5ii(a, b, c, d, k[0], 6, -198630844);   d = md5ii(d, a, b, c, k[7], 10, 1126891415);
    c = md5ii(c, d, a, b, k[14], 15, -1416354905);b = md5ii(b, c, d, a, k[5], 21, -57434055);
    a = md5ii(a, b, c, d, k[12], 6, 1700485571);  d = md5ii(d, a, b, c, k[3], 10, -1894986606);
    c = md5ii(c, d, a, b, k[10], 15, -1051523);   b = md5ii(b, c, d, a, k[1], 21, -2054922799);
    a = md5ii(a, b, c, d, k[8], 6, 1873313359);   d = md5ii(d, a, b, c, k[15], 10, -30611744);
    c = md5ii(c, d, a, b, k[6], 15, -1560198380); b = md5ii(b, c, d, a, k[13], 21, 1309151649);
    a = md5ii(a, b, c, d, k[4], 6, -145523070);   d = md5ii(d, a, b, c, k[11], 10, -1120210379);
    c = md5ii(c, d, a, b, k[2], 15, 718787259);   b = md5ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }

  /** One 64-byte block starting at `off`, as sixteen little-endian words. */
  function md5blk(bytes, off) {
    const blks = new Array(16);
    for (let i = 0; i < 64; i += 4) {
      blks[i >> 2] =
        bytes[off + i] +
        (bytes[off + i + 1] << 8) +
        (bytes[off + i + 2] << 16) +
        (bytes[off + i + 3] << 24);
    }
    return blks;
  }

  const HEX = "0123456789abcdef";
  function md5Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const n = bytes.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let end = 64;
    for (; end <= n; end += 64) md5cycle(state, md5blk(bytes, end - 64));
    const restStart = end - 64;
    const restLen = n - restStart;
    const tail = new Array(16).fill(0);
    for (let i = 0; i < restLen; i++) tail[i >> 2] |= bytes[restStart + i] << ((i % 4) << 3);
    tail[restLen >> 2] |= 0x80 << ((restLen % 4) << 3);
    if (restLen > 55) {
      md5cycle(state, tail);
      tail.fill(0);
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    let hex = "";
    for (const w of state) {
      for (let j = 0; j < 4; j++) {
        hex += HEX[(w >> (j * 8 + 4)) & 0x0f] + HEX[(w >> (j * 8)) & 0x0f];
      }
    }
    return hex;
  }

  // ---- Thumbnail URLs --------------------------------------------------------
  const THUMB_BASE = "https://upload.wikimedia.org/wikipedia/commons/thumb/";
  const DIRECT_THUMB_RE = /\.(jpe?g|png|gif|webp|svg)$/i;

  /** The redirecting-but-universal Special:FilePath thumbnail URL. */
  function filePathUrl(title, width) {
    return `${C.FILEPATH}${encodeURIComponent(title)}?width=${width}`;
  }

  /** Direct upload.wikimedia.org thumb URL when the format allows, else FilePath. */
  function thumbUrl(title, width) {
    const name = String(title).replace(/^File:/, "").replace(/ /g, "_");
    if (!DIRECT_THUMB_RE.test(name)) return filePathUrl(title, width);
    const h = md5Hex(name);
    const enc = encodeURIComponent(name);
    const suffix = /\.svg$/i.test(name) ? ".png" : ""; // SVGs are rasterized
    return `${THUMB_BASE}${h[0]}/${h.slice(0, 2)}/${enc}/${width}px-${enc}${suffix}`;
  }

  // ---- In-session image cache -------------------------------------------------
  const CACHE_MAX_BYTES = 80 * 1024 * 1024;
  const cache = new Map();    // url -> {obj, size, at}
  const inflight = new Map(); // url -> Promise<objectURL>
  const failed = new Set();   // urls that answered an HTTP error — don't retry
  let cacheBytes = 0;
  let cacheTick = 0;

  function evict() {
    while (cacheBytes > CACHE_MAX_BYTES && cache.size) {
      let oldestKey = null, oldest = null;
      cache.forEach((v, k) => {
        if (!oldest || v.at < oldest.at) { oldest = v; oldestKey = k; }
      });
      cache.delete(oldestKey);
      cacheBytes -= oldest.size;
      URL.revokeObjectURL(oldest.obj);
    }
  }

  /** Resolve to a displayable src for this image (cached object-URL); rejects
      if the network fetch can't be used so the caller can fall back to a
      plain <img> src load. */
  function loadImage(url) {
    const hit = cache.get(url);
    if (hit) { hit.at = ++cacheTick; return Promise.resolve(hit.obj); }
    if (failed.has(url)) return Promise.reject(new Error("previously failed"));
    if (inflight.has(url)) return inflight.get(url);
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) { failed.add(url); throw new Error(`HTTP ${r.status}`); }
        return r.blob();
      })
      .then((b) => {
        const obj = URL.createObjectURL(b);
        cache.set(url, { obj, size: b.size, at: ++cacheTick });
        cacheBytes += b.size;
        evict();
        inflight.delete(url);
        return obj;
      })
      .catch((err) => {
        inflight.delete(url);
        throw err;
      });
    inflight.set(url, p);
    return p;
  }

  /** Warm the cache ahead of need; failures are silently absorbed. */
  const prefetch = (url) => loadImage(url).catch(() => {});

  /** A direct thumb URL can 404 (width ≥ the original, odd format). Every <img>
      that uses one stashes the FilePath equivalent in data-fallback; this one
      capture-phase listener swaps it in (covers preview, modal and tray imgs). */
  function init() {
    document.addEventListener("error", (e) => {
      const el = e.target;
      if (el && el.tagName === "IMG" && el.dataset && el.dataset.fallback) {
        const fb = el.dataset.fallback;
        delete el.dataset.fallback;
        el.src = fb;
      }
    }, true);
  }

  LOS.images = { init, thumbUrl, filePathUrl, loadImage, prefetch };
})();
