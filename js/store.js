/* Line of Sight tool — store: the photo records and their map features.

   One record per Commons File page: {id, url, title, pageId, cam, obj,
   origCam, origObj}. cam/obj are the CURRENT [lon,lat] (including unsaved
   edits); origCam/origObj are the last-saved baseline. Each record fans out
   into up to four GeoJSON features (cone, line, subject, camera) that share
   the record's numeric id, so hover state can address all of them at once. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const C = LOS.config;
  const U = LOS.util;

  const index = new Map();   // url -> record (insertion-ordered: doubles as FIFO for eviction)
  const urlToId = new Map(); // url -> stable numeric feature id
  let nextId = 1;            // ids start at 1 (0 is falsy in feature-state)

  const cones = U.emptyFC();
  const lines = U.emptyFC();
  const objects = U.emptyFC();
  const cameras = U.emptyFC();
  // Index-aligned: COLLECTIONS[i] is the data for the layer/source SOURCE_IDS[i].
  const COLLECTIONS = [cones, lines, objects, cameras];
  const SOURCE_IDS = ["cones", "lines", "objects", "cameras"];

  function idFor(url) {
    let id = urlToId.get(url);
    if (id === undefined) { id = nextId++; urlToId.set(url, id); }
    return id;
  }

  function titleFromUrl(url) {
    try { return decodeURIComponent(url.slice(C.FILEPATH.length)); }
    catch { return null; }
  }

  // ---- Edit-state helpers (current vs saved baseline) -------------------------
  function posChanged(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    return Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9;
  }
  const recDirty = (rec) => posChanged(rec.cam, rec.origCam) || posChanged(rec.obj, rec.origObj);
  function dirtyRecs() {
    const out = [];
    index.forEach((rec) => { if (recDirty(rec)) out.push(rec); });
    return out;
  }

  // ---- Feature building --------------------------------------------------------
  /** White (near) -> blue (far). */
  function rampColor(t) {
    t = U.clamp(t, 0, 1);
    const r = Math.round(255 + (74 - 255) * t);
    const g = Math.round(255 + (150 - 255) * t);
    return `rgb(${r},${g},255)`;
  }

  /** Build the map features for one photo from its CURRENT cam/obj positions.
      Used on load and again after every drag / undo / placement. */
  function pushPhotoFeatures(rec) {
    // Unsaved edits carry an `edited` flag so filters never hide them (e.g. a
    // just-added subject must not vanish under an active "Sight: None" filter).
    const edited = recDirty(rec);
    if (rec.cam && rec.obj) {
      const dist = U.distance(rec.cam[0], rec.cam[1], rec.obj[0], rec.obj[1]);
      const br = U.bearing(rec.cam[0], rec.cam[1], rec.obj[0], rec.obj[1]);
      const t = U.clamp(dist / 1500, 0, 1);      // 0 = near, 1 = far
      const half = U.lerp(38, 7, t);             // cone HALF-ANGLE encodes distance (wide=near, narrow=far)
      const rad = LOS.mapView.coneRadiusMeters(rec.cam[1]); // length is constant on screen, not distance

      // Shared props let filters (dist/bearing/hasLos) target every layer.
      const meta = {
        url: rec.url, title: rec.title, hasLos: true,
        dist: Math.round(dist), bearing: Math.round(br), edited,
      };
      // Cones additionally carry what rebuildCones() needs to refit on zoom.
      const coneMeta = { ...meta, color: rampColor(t), camLon: rec.cam[0], camLat: rec.cam[1], widthDeg: half };

      cones.features.push(U.feature("Polygon", U.wedge(rec.cam[0], rec.cam[1], br, half, rad), coneMeta, rec.id));
      lines.features.push(U.feature("LineString", [rec.cam.slice(), rec.obj.slice()], meta, rec.id));
      objects.features.push(U.feature("Point", rec.obj.slice(), meta, rec.id));
      cameras.features.push(U.feature("Point", rec.cam.slice(), meta, rec.id));
    } else if (rec.cam) {
      cameras.features.push(U.feature("Point", rec.cam.slice(),
        { url: rec.url, title: rec.title, hasLos: false, dist: null, bearing: null, edited }, rec.id));
    } else if (rec.obj) {
      objects.features.push(U.feature("Point", rec.obj.slice(),
        { url: rec.url, title: rec.title, hasLos: false, dist: null, bearing: null, edited }, rec.id));
    }
  }

  /** Register one Commons File page as a record (coordinates optional — pages
      without any location still get a record so the photo list can hold them
      for editing). Returns the (possibly pre-existing) record, or null for bad
      pages. Shared by geosearch, the URL-param preload, and category adds. */
  function addPhoto(page) {
    if (!page || !page.title) return null;
    const url = C.FILEPATH + encodeURIComponent(page.title);
    const existing = index.get(url);
    if (existing) return existing;

    // pageId is required for SDC saves — every caller must query with pageids.
    const rec = {
      id: idFor(url), url, title: page.title, pageId: page.pageid,
      cam: null, obj: null, origCam: null, origObj: null,
    };

    const coords = page.coordinates;
    if (coords && coords.length === 1) {
      // Only one location known. Camera coordinates are the primary ones
      // (or typed "camera"); anything else ({{Object location}}) is the subject.
      const c = coords[0];
      if (c.type === "camera" || "primary" in c) rec.cam = [c.lon, c.lat];
      else rec.obj = [c.lon, c.lat];
    } else if (coords && coords.length > 1) {
      // Camera + subject -> direction, distance, view cone.
      const cam = coords.find((c) => c.type === "camera") || coords[0];
      const obj = coords.find((c) => c !== cam) || coords[1];
      rec.cam = [cam.lon, cam.lat];
      rec.obj = [obj.lon, obj.lat];
    }
    rec.origCam = rec.cam && rec.cam.slice();
    rec.origObj = rec.obj && rec.obj.slice();
    index.set(url, rec);
    pushPhotoFeatures(rec);
    return rec;
  }

  /** Push every source's current features to the map — for photo batches added
      outside the geosearch flow (URL preload, category adds). */
  function syncSources() {
    LOS.mapView.clearHoverIfAny(); // no dangling feature-state across setData
    const map = LOS.mapView.map;
    COLLECTIONS.forEach((fc, i) => {
      const src = map.getSource(SOURCE_IDS[i]);
      if (src) src.setData(fc);
    });
    LOS.viewer.restoreSelectedPreview();
  }

  /** Re-derive one photo's features after its cam/obj moved; setData only the
      sources that actually changed. */
  function rebuildPhotoFeatures(rec) {
    LOS.mapView.clearHoverIfAny(); // no dangling feature-state across setData
    const touched = new Set();
    COLLECTIONS.forEach((fc, i) => {
      const kept = fc.features.filter((f) => f.properties.url !== rec.url);
      if (kept.length !== fc.features.length) { fc.features = kept; touched.add(i); }
    });
    const before = COLLECTIONS.map((fc) => fc.features.length);
    pushPhotoFeatures(rec);
    COLLECTIONS.forEach((fc, i) => { if (fc.features.length !== before[i]) touched.add(i); });
    const map = LOS.mapView.map;
    touched.forEach((i) => {
      const src = map.getSource(SOURCE_IDS[i]);
      if (src) src.setData(COLLECTIONS[i]);
    });
    // Not mid-drag — that highlight churn distracts.
    if (!LOS.edit.isDragging()) LOS.viewer.restoreSelectedPreview();
  }

  // ---- Loading photos in the current view (Commons geosearch) -----------------
  let loadAbort = null; // AbortController for the in-flight geosearch

  function load() {
    const map = LOS.mapView.map;
    const b = map.getBounds();
    const spanLat = b.getNorth() - b.getSouth();
    const spanLon = b.getEast() - b.getWest();

    if (spanLat > 0.7 || spanLon > 0.7) {
      LOS.status.set("Zoom in to load nearby photos", false);
      return;
    }

    const bbox = [b.getNorth(), b.getWest(), b.getSouth(), b.getEast()].join("|");
    // Bulk query stays cheap: coordinates only. Attribution is fetched lazily
    // on hover/click (extmetadata is "expensive" per the Commons API docs).
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",  // CORS for anonymous reads
      maxlag: "5",  // be polite to the API
      prop: "coordinates",
      coprop: "type|name",
      coprimary: "all",
      colimit: "500",
      generator: "geosearch",
      ggsbbox: bbox, // top|left|bottom|right
      ggslimit: "500",
      ggsnamespace: "6", // File: namespace
      ggsprimary: "all",
    });

    // Cancel any still-running request so a slow one can't clobber fresh data.
    if (loadAbort) loadAbort.abort();
    loadAbort = new AbortController();

    LOS.status.set("Loading photos…", true);

    fetch(`${C.COMMONS_API}?${params}`, { signal: loadAbort.signal })
      .then((r) => r.json())
      .then(process)
      .catch((err) => {
        if (err && err.name === "AbortError") return; // superseded by a newer pan
        console.warn("Commons request failed:", err);
        LOS.status.set("Couldn't reach Wikimedia Commons", false);
      });
  }

  function process(data) {
    const before = COLLECTIONS.map((fc) => fc.features.length);
    const pages = data?.query?.pages;
    if (pages) {
      for (const page of Object.values(pages)) {
        // Geosearch never returns coordinate-less pages; skip them anyway.
        if (!page.coordinates || !page.coordinates.length) continue;
        addPhoto(page);
      }
    }

    // Mark sources that gained features, then evict (which may mark more).
    const dirty = new Set();
    COLLECTIONS.forEach((fc, i) => { if (fc.features.length !== before[i]) dirty.add(i); });
    evictOldest(dirty);

    // Clear hover BEFORE setData (sources still loaded) so no feature-state dangles.
    if (dirty.size) LOS.mapView.clearHoverIfAny();
    // Only re-upload sources that actually changed — setData reprocesses the
    // whole collection, so skipping unchanged ones matters when panning.
    const map = LOS.mapView.map;
    dirty.forEach((i) => map.getSource(SOURCE_IDS[i]).setData(COLLECTIONS[i]));

    LOS.status.set(
      `${U.plural(index.size, "photo")} · ${cones.features.length} with a direction`, false);
    LOS.viewer.restoreSelectedPreview(); // the pre-setData clearHover must not eat the selection
  }

  /** Keep memory bounded: drop the oldest-loaded photos past the cap. */
  function evictOldest(dirty) {
    let toEvict = index.size - C.MAX_PHOTOS;
    if (toEvict <= 0) return;
    const remove = new Set();
    for (const [url, rec] of index) {
      if (toEvict <= 0) break;
      // Never evict unsaved edits or photos sitting in the selection tray.
      if (recDirty(rec) || LOS.tray.isPinned(url)) continue;
      index.delete(url);
      urlToId.delete(url);
      const title = titleFromUrl(url);
      if (title) LOS.api.dropAttribution(title);
      remove.add(url);
      toEvict--;
    }
    if (!remove.size) return;
    COLLECTIONS.forEach((fc, i) => {
      const kept = fc.features.filter((f) => !remove.has(f.properties.url));
      if (kept.length !== fc.features.length) { fc.features = kept; dirty.add(i); }
    });
  }

  /** Does a photo currently pass the active filters? Mirrors the Mapbox filter
      expressions in plain JS so the polygon selection can match against the
      store instead of queryRenderedFeatures — which silently returns nothing
      while tiles are still loading. */
  function photoPassesFilters(rec) {
    if (recDirty(rec)) return true; // unsaved edits always pass
    const F = LOS.settings.filters;
    const hasLos = !!(rec.cam && rec.obj);
    if (!hasLos) return F.los !== "los";
    if (F.los === "nolos") return false;
    const d = U.distance(rec.cam[0], rec.cam[1], rec.obj[0], rec.obj[1]);
    const lo = Math.min(F.minLen, F.maxLen);
    const hi = Math.max(F.minLen, F.maxLen);
    if (d < lo || (hi < C.LEN_MAX && d > hi)) return false;
    const br = U.bearing(rec.cam[0], rec.cam[1], rec.obj[0], rec.obj[1]);
    if (F.bearMin <= F.bearMax) return br >= F.bearMin && br <= F.bearMax;
    return br >= F.bearMin || br <= F.bearMax; // wraps through North
  }

  LOS.store = {
    index,
    get: (url) => index.get(url),
    collections: { cones, lines, objects, cameras },
    SOURCE_IDS,
    addPhoto, syncSources, rebuildPhotoFeatures,
    load, titleFromUrl,
    posChanged, recDirty, dirtyRecs,
    photoPassesFilters,
  };
})();
