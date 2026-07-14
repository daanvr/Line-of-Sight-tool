/* Line of Sight tool — util: pure helpers.
   Geometry, formatting, HTML safety, timing. No DOM elements, no network,
   no app state — everything here is safe to call from any module. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});

  const EARTH_RADIUS = 6371000; // metres

  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  /** Great-circle distance in metres. Arguments are lon/lat degrees. */
  function distance(lon1, lat1, lon2, lat2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
  }

  /** Initial bearing from point 1 to point 2, in degrees clockwise from North. */
  function bearing(lon1, lat1, lon2, lat2) {
    const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /** The point `dist` metres from (lon,lat) along bearing `brng`. */
  function destination(lon, lat, brng, dist) {
    const d = dist / EARTH_RADIUS, b = toRad(brng), p1 = toRad(lat), l1 = toRad(lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2)
    );
    return [toDeg(l2), toDeg(p2)];
  }

  /** Pie-slice polygon at (lon,lat) facing `brng`, ±half degrees, `rad` metres long. */
  function wedge(lon, lat, brng, half, rad) {
    const ring = [[lon, lat]];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      ring.push(destination(lon, lat, brng - half + (2 * half * i) / steps, rad));
    }
    ring.push([lon, lat]);
    return [ring];
  }

  /** Ray-casting point-in-polygon for [lon,lat] points and a vertex ring. */
  function pointInPolygon(pt, ring) {
    const x = pt[0], y = pt[1];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** "740 m" below a kilometre, "1.3 km" / "12 km" above. */
  function fmtDist(m) {
    if (!isFinite(m)) return "";
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  /** "3 photos" / "1 photo" — naive English pluralisation by trailing s. */
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  /** File page title -> display name (no "File:", extension, or underscores). */
  function prettyTitle(title) {
    if (!title) return "";
    return title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
  }

  function stripTags(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent || "").trim().replace(/\s+/g, " ");
  }

  /** Keep author links, strip anything executable. */
  function sanitizeHtml(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,iframe").forEach((n) => n.remove());
    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);
        if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
      }
    });
    return doc.body.innerHTML.trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /** GeoJSON helpers. */
  const emptyFC = () => ({ type: "FeatureCollection", features: [] });
  const feature = (type, coordinates, properties, id) => ({
    type: "Feature",
    id,
    properties,
    geometry: { type, coordinates },
  });

  LOS.util = {
    distance, bearing, destination, wedge, pointInPolygon,
    lerp, clamp, fmtDist, plural, prettyTitle,
    stripTags, sanitizeHtml, escapeHtml,
    debounce, chunk, emptyFC, feature,
  };
})();
