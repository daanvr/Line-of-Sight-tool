/* Line of Sight tool — mapView: the Mapbox map itself.

   Owns map creation, the geocoder, sources/layers (re-added idempotently on
   every style.load, since setStyle wipes them), layer styling from
   LOS.settings, the Mapbox filter expressions, the constant-screen-size cone
   refitting, the hover/dim machinery, and the routing of raw map events out
   to the edit / select / viewer / ctxmenu modules. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const C = LOS.config;
  const U = LOS.util;

  let map = null;
  let lastSearch = ""; // geocoder query / chosen place text (persisted)

  // Hover state.
  let hoverId = null;         // currently highlighted feature id
  let hoverUrl = null;        // url of the hovered photo (map or list row)
  let dimActive = false;      // is a hover dim-session active
  let pendingPoint = null;    // rAF-throttled hover query
  let rafId = 0;
  let photoClickTimer = null; // click-vs-dblclick discrimination on single-location dots

  // Layer ids === source ids. Which opacity props each layer dims on hover.
  const OPACITY = [
    { id: "cones",   props: ["fill-opacity"] },
    { id: "lines",   props: ["line-opacity"] },
    { id: "objects", props: ["circle-opacity", "circle-stroke-opacity"] },
    { id: "cameras", props: ["circle-opacity", "circle-stroke-opacity"] },
  ];

  // ---- Map + controls ---------------------------------------------------------------
  function init(restored) {
    mapboxgl.accessToken = C.MAPBOX_TOKEN;
    lastSearch = restored.search;

    // Restore view from the URL hash, else the last saved view, else Djémila.
    const startView = restored.startView;
    map = new mapboxgl.Map({
      container: "map",
      style: `mapbox://styles/mapbox/${LOS.settings.basemap}`,
      center: startView ? startView.center : [5.735978, 36.32068], // Djémila, Algeria (Roman ruins — lots of geotagged photos)
      zoom: startView ? startView.zoom : 16,
      pitch: startView ? startView.pitch : 60,
      bearing: startView ? startView.bearing : -20,
      antialias: false,
    });
    LOS.mapView.map = map;

    const geocoder = new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl, marker: false });
    map.addControl(geocoder, "top-right");
    geocoder.on("result", (e) => {
      lastSearch = e.result?.place_name || e.result?.text || lastSearch;
      LOS.persist.saveDebounced();
    });
    geocoder.on("clear", () => {
      lastSearch = "";
      LOS.persist.saveDebounced();
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    // Restore the search box text; keep tracking what the user types.
    const gi = document.querySelector(".mapboxgl-ctrl-geocoder input");
    if (gi) {
      if (lastSearch) gi.value = lastSearch;
      gi.addEventListener("input", () => {
        lastSearch = gi.value;
        LOS.persist.saveDebounced();
      });
    }

    // Runs on the initial load AND again after every setStyle (basemap switch),
    // which wipes custom sources/layers — so everything is re-added idempotently.
    map.on("style.load", onStyleLoad);

    const debouncedLoad = U.debounce(LOS.store.load, 350);
    map.on("moveend", () => {
      LOS.persist.writeHash();
      LOS.persist.saveDebounced();
      debouncedLoad();
    });
    map.on("zoomend", rebuildCones);
    map.on("zoom", U.debounce(rebuildCones, 60));
    map.on("error", (e) => console.warn("Mapbox error:", e && e.error));
  }

  // ---- Sources + layers (rebuilt on every style.load) ----------------------------------
  function onStyleLoad() {
    map.addSource("mapbox-dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
    applyTerrain();

    map.addLayer({
      id: "sky",
      type: "sky",
      paint: {
        "sky-type": "atmosphere",
        "sky-atmosphere-sun": [0.0, 0.0],
        "sky-atmosphere-sun-intensity": 12,
      },
    });

    const S = LOS.settings.layers;
    const col = LOS.store.collections;
    map.addSource("cones", { type: "geojson", data: col.cones });
    map.addSource("lines", { type: "geojson", data: col.lines });
    map.addSource("objects", { type: "geojson", data: col.objects });
    map.addSource("cameras", { type: "geojson", data: col.cameras });

    // Drawn bottom -> top: cones, lines, subjects, camera dots.
    // Paint values come from settings; applyAllStyles() keeps them in sync.
    map.addLayer({
      id: "cones",
      type: "fill",
      source: "cones",
      layout: { visibility: S.cones.visible ? "visible" : "none" },
      paint: {
        "fill-color": S.cones.ramp ? ["get", "color"] : S.cones.color,
        "fill-opacity": S.cones.opacity,
      },
    });
    map.addLayer({
      id: "lines",
      type: "line",
      source: "lines",
      layout: { "line-join": "round", "line-cap": "round", visibility: S.lines.visible ? "visible" : "none" },
      paint: {
        "line-color": S.lines.color,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, S.lines.width * 0.5, 18, S.lines.width],
        "line-opacity": S.lines.opacity,
      },
    });
    map.addLayer({
      id: "objects",
      type: "circle",
      source: "objects",
      layout: { visibility: S.objects.visible ? "visible" : "none" },
      paint: {
        "circle-color": S.objects.color,
        "circle-opacity": S.objects.opacity,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, S.objects.size * 0.6, 18, S.objects.size],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(0,0,0,0.4)",
        "circle-stroke-opacity": S.objects.opacity,
      },
    });
    map.addLayer({
      id: "cameras",
      type: "circle",
      source: "cameras",
      layout: { visibility: S.cameras.visible ? "visible" : "none" },
      paint: {
        "circle-color": S.cameras.color,
        "circle-opacity": S.cameras.opacity,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": S.cameras.color,
        "circle-stroke-opacity": 1,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, S.cameras.size * 0.6, 18, S.cameras.size],
      },
    });

    // Polygon-selection overlay (drawn on top).
    map.addSource("select", { type: "geojson", data: U.emptyFC() });
    map.addSource("select-pts", { type: "geojson", data: U.emptyFC() });
    map.addLayer({ id: "select-fill",  type: "fill",   source: "select",     paint: { "fill-color": "#34d6f2", "fill-opacity": 0.12 } });
    map.addLayer({ id: "select-line",  type: "line",   source: "select",     paint: { "line-color": "#34d6f2", "line-width": 2, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "select-verts", type: "circle", source: "select-pts", paint: { "circle-radius": 4, "circle-color": "#34d6f2", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });

    // Edit overlay: dashed original→new displacement lines, a hollow ghost at
    // the original spot, a filled dot at the new one — plus a brighter
    // highlight used while hovering an entry in the edit list.
    const showEdits = LOS.edit.isOverlayShown();
    map.addSource("edit-lines", { type: "geojson", data: U.emptyFC() });
    map.addSource("edit-pts", { type: "geojson", data: U.emptyFC() });
    map.addSource("edit-hi", { type: "geojson", data: U.emptyFC() });
    map.addLayer({
      id: "edit-lines", type: "line", source: "edit-lines",
      layout: { "line-cap": "round", visibility: showEdits ? "visible" : "none" },
      paint: { "line-color": C.EDIT_COLOR, "line-width": 2, "line-dasharray": [1.6, 1.4], "line-opacity": 0.9 },
    });
    map.addLayer({
      id: "edit-pts", type: "circle", source: "edit-pts",
      layout: { visibility: showEdits ? "visible" : "none" },
      paint: {
        "circle-radius": ["match", ["get", "role"], "orig", 4, 5.5],
        "circle-color": C.EDIT_COLOR,
        "circle-opacity": ["match", ["get", "role"], "orig", 0, 0.95],
        "circle-stroke-color": C.EDIT_COLOR,
        "circle-stroke-width": ["match", ["get", "role"], "orig", 1.5, 0],
        "circle-stroke-opacity": 0.9,
      },
    });
    map.addLayer({
      id: "edit-hi-line", type: "line", source: "edit-hi",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#ffffff", "line-width": 3.5, "line-opacity": 0.95 },
    });
    map.addLayer({
      id: "edit-hi-pts", type: "circle", source: "edit-hi",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 7, "circle-color": C.EDIT_COLOR, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
    });
    LOS.edit.renderOverlay();

    wireInteractions(); // once-guarded: safe to call again after setStyle
    applyAllStyles();   // re-apply settings paint/visibility
    applyFilters();     // re-apply active filters
    rebuildCones();     // re-fit cone radius to the current zoom
    if (LOS.select.isActive()) LOS.select.render(null);
    LOS.store.load();   // refetch (self-cancelling / debounced)
  }

  function applyTerrain() {
    if (LOS.settings.terrain) map.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });
    else map.setTerrain(null);
  }

  // ---- Interactions (bound exactly once — map events survive setStyle) -------------------
  let wired = false;
  function wireInteractions() {
    if (wired) return;
    wired = true;
    const canvas = map.getCanvas();

    // One throttled handler instead of 4 per-layer handlers. The mousemove
    // event only records the point; the query/paint work runs once per frame.
    map.on("mousemove", (e) => {
      if (LOS.edit.onMapMouseMove(e)) return; // dragging / placing consumed it
      if (LOS.select.isActive()) { LOS.select.render(e.lngLat); return; }
      pendingPoint = e.point;
      if (!rafId) rafId = requestAnimationFrame(processHover);
    });
    canvas.addEventListener("mouseout", () => {
      if (LOS.select.isActive()) return;
      clearHover();
      LOS.viewer.restoreSelectedPreview();
    });

    map.on("click", (e) => {
      if (LOS.edit.onMapClick(e)) return; // post-drag swallow / placement click
      if (LOS.select.isActive()) { LOS.select.onClick(e.lngLat); return; }
      const f = topFeatureAt(e.point);
      if (!f) return;
      const rec = LOS.store.get(f.properties.url);
      if (rec && (!rec.cam || !rec.obj)) {
        // Could be the first half of a double-click (= add the missing
        // location) — open the photo only if no second click follows.
        if (photoClickTimer) clearTimeout(photoClickTimer);
        photoClickTimer = setTimeout(() => {
          photoClickTimer = null;
          LOS.viewer.openModal(f.properties);
        }, 260);
      } else {
        LOS.viewer.openModal(f.properties);
      }
    });

    // Double-click a single-location dot → place its missing counterpart.
    for (const layerId of ["cameras", "objects"]) {
      map.on("dblclick", layerId, (e) => {
        if (LOS.select.isActive()) return;
        const f = e.features && e.features[0];
        const rec = f && LOS.store.get(f.properties.url);
        if (!rec) return;
        const missing = !rec.cam ? "camera" : (!rec.obj ? "object" : null);
        if (!missing) return;
        e.preventDefault(); // no double-click zoom
        if (photoClickTimer) { clearTimeout(photoClickTimer); photoClickTimer = null; }
        LOS.edit.startPlacing(rec.url, missing);
      });
    }

    // Edit mode: drag camera / subject points (mousedown on the point layers
    // hijacks the gesture from the map pan; a <3px move still counts as click).
    map.on("mousedown", "cameras", (e) => LOS.edit.onLayerMouseDown(e, "camera"));
    map.on("mousedown", "objects", (e) => LOS.edit.onLayerMouseDown(e, "object"));
    map.on("mouseup", LOS.edit.endDrag);
    document.addEventListener("mouseup", LOS.edit.endDrag);

    map.on("dblclick", (e) => {
      if (!LOS.select.isActive()) return;
      e.preventDefault();
      LOS.select.onDblClick();
    });

    // Right-click → photo actions when a photo is hit, else map services menu.
    map.on("contextmenu", (e) => {
      const f = topFeatureAt(e.point);
      if (f) LOS.ctxmenu.showForPhoto(e.point, f.properties);
      else LOS.ctxmenu.showForSpot(e.point, e.lngLat);
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    map.on("movestart", LOS.ctxmenu.hide);
  }

  function topFeatureAt(point) {
    const bb = [[point.x - 3, point.y - 3], [point.x + 3, point.y + 3]];
    const fs = map.queryRenderedFeatures(bb, { layers: LOS.store.SOURCE_IDS });
    return fs.length ? fs[0] : null;
  }

  // ---- Hover + dim ---------------------------------------------------------------------
  function processHover() {
    rafId = 0;
    if (!pendingPoint) return;
    const f = topFeatureAt(pendingPoint);
    // Warm the previews of every dot near the cursor (dedup'd) so sweeping
    // the mouse across a cluster shows each preview without a network wait.
    prefetchNeighbors(pendingPoint);
    if (!f) {
      // Hover ended: undim everything, then fall back to the selected
      // photo's preview (never to an empty preview box).
      if (hoverId !== null) clearHover();
      LOS.viewer.restoreSelectedPreview();
      return;
    }

    if (f.id === hoverId) return; // same photo — nothing to do
    if (hoverId !== null) setHover(hoverId, false);
    hoverId = f.id;
    hoverUrl = f.properties.url;
    setHover(hoverId, true); // cheap per-feature highlight
    map.getCanvas().style.cursor = LOS.edit.isActive() ? "move" : "pointer";
    enterDimSession();       // dim others (once per gesture)
    LOS.viewer.showPreview(f.properties);
  }

  /** Toggle hover state for one photo across all 4 sources (same id in each). */
  function setHover(id, on) {
    if (id == null) return;
    for (const src of LOS.store.SOURCE_IDS) {
      if (!map.getSource(src)) continue;
      try { map.setFeatureState({ source: src, id }, { hover: on }); }
      catch { /* source mid-reload after setData — safe to skip */ }
    }
  }

  function clearHover() {
    if (hoverId !== null) { setHover(hoverId, false); hoverId = null; }
    hoverUrl = null;
    leaveDimSession();
    LOS.viewer.hidePreview();
    map.getCanvas().style.cursor = "";
  }

  /** Guarded variant for setData paths: only tears the hover down when one is
      actually active (so an unrelated data refresh can't blank the preview). */
  function clearHoverIfAny() {
    if (hoverId !== null) clearHover();
  }

  /** Tray-row hover: same feature-state + dim mechanics as hovering the map
      (the preview is the caller's job; no cursor change either). */
  function hoverFromList(rec) {
    if (hoverId !== null && hoverId !== rec.id) setHover(hoverId, false);
    hoverId = rec.id;
    hoverUrl = rec.url;
    setHover(rec.id, true);
    enterDimSession();
  }
  function endListHover() {
    if (hoverId !== null) { setHover(hoverId, false); hoverId = null; }
    hoverUrl = null;
    leaveDimSession();
  }

  // Dim everyone except the feature-state:hover one. Set ONCE per hover gesture
  // (not per mousemove) — the in-gesture highlight is pure setFeatureState.
  function enterDimSession() {
    if (dimActive) return;
    dimActive = true;
    LOS.store.SOURCE_IDS.forEach(applyOpacity);
  }
  function leaveDimSession() {
    if (!dimActive) return;
    dimActive = false;
    LOS.store.SOURCE_IDS.forEach(applyOpacity);
  }

  /** The "full" (non-dimmed) opacity for a layer/prop, read live from settings
      so user-adjusted opacities survive a hover gesture instead of snapping back. */
  function opacityFull(id, prop) {
    if (id === "cameras" && prop === "circle-stroke-opacity") return 1;
    const c = LOS.settings.layers[id];
    return c ? c.opacity : 1;
  }

  /** Set a layer's opacity props. Always a feature-state expression — never a
      plain constant: flipping a paint property between constant and
      data-driven mid-frame races Mapbox's feature-state refresh and throws
      ("this.expression.evaluate is not a function"). Outside a dim session
      the expression simply yields `full` either way. */
  function applyOpacity(id) {
    const cfg = OPACITY.find((o) => o.id === id);
    if (!cfg || !map.getLayer(id)) return;
    for (const prop of cfg.props) {
      const full = opacityFull(id, prop);
      map.setPaintProperty(id, prop,
        ["case", ["boolean", ["feature-state", "hover"], false], full, dimActive ? C.DIM : full]);
    }
  }

  /** Prefetch previews of every dot within 48px of the cursor (max 8). */
  function prefetchNeighbors(point) {
    let fs;
    const bb = [[point.x - 48, point.y - 48], [point.x + 48, point.y + 48]];
    try { fs = map.queryRenderedFeatures(bb, { layers: LOS.store.SOURCE_IDS }); }
    catch { return; }
    const titles = new Set();
    for (const f of fs) {
      if (titles.size >= 8) break;
      const t = f.properties && f.properties.title;
      if (!t || titles.has(t)) continue;
      titles.add(t);
      LOS.images.prefetch(LOS.images.thumbUrl(t, C.THUMB_W.preview));
    }
  }

  // ---- Layer styling (settings -> Mapbox paint) -------------------------------------------
  function applyLayerStyle(id) {
    if (!map.getLayer(id)) return;
    const c = LOS.settings.layers[id];
    map.setLayoutProperty(id, "visibility", c.visible ? "visible" : "none");
    if (id === "cones") {
      map.setPaintProperty("cones", "fill-color", c.ramp ? ["get", "color"] : c.color);
    } else if (id === "lines") {
      map.setPaintProperty("lines", "line-color", c.color);
      map.setPaintProperty("lines", "line-width", ["interpolate", ["linear"], ["zoom"], 10, c.width * 0.5, 18, c.width]);
    } else if (id === "objects") {
      map.setPaintProperty("objects", "circle-color", c.color);
      map.setPaintProperty("objects", "circle-radius", ["interpolate", ["linear"], ["zoom"], 10, c.size * 0.6, 18, c.size]);
    } else if (id === "cameras") {
      map.setPaintProperty("cameras", "circle-color", c.color);
      map.setPaintProperty("cameras", "circle-stroke-color", c.color);
      map.setPaintProperty("cameras", "circle-radius", ["interpolate", ["linear"], ["zoom"], 10, c.size * 0.6, 18, c.size]);
    }
    applyOpacity(id);
  }
  function applyAllStyles() {
    LOS.store.SOURCE_IDS.forEach(applyLayerStyle);
  }

  // ---- Constant-screen-size cones -----------------------------------------------------------
  /** Ground resolution (m per screen pixel) at the given latitude/zoom. */
  function metersPerPixel(lat, zoom) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  }
  function coneRadiusMeters(lat) {
    return LOS.settings.layers.cones.pxSize * metersPerPixel(lat, map.getZoom());
  }

  /** Re-fit every cone's radius so it stays ~constant on screen (declutters when
      zooming in). Angle/bearing/camera come from the persisted cone properties. */
  function rebuildCones() {
    const cones = LOS.store.collections.cones;
    if (!cones.features.length) return;
    for (const f of cones.features) {
      const p = f.properties;
      if (p.camLon == null) continue;
      f.geometry.coordinates = U.wedge(p.camLon, p.camLat, p.bearing, p.widthDeg, coneRadiusMeters(p.camLat));
    }
    map.getSource("cones")?.setData(cones);
  }
  const rebuildConesDebounced = U.debounce(rebuildCones, 60);

  // ---- Filters (Mapbox setFilter expressions from persisted settings) -------------------------
  function lengthClause() {
    const F = LOS.settings.filters;
    const g = ["coalesce", ["get", "dist"], -1];
    const lo = Math.min(F.minLen, F.maxLen);
    const hi = Math.max(F.minLen, F.maxLen);
    return ["all", [">=", g, lo], ["<=", g, hi >= C.LEN_MAX ? 1e9 : hi]];
  }
  function bearingClause() {
    const F = LOS.settings.filters;
    const g = ["coalesce", ["get", "bearing"], -1];
    if (F.bearMin <= F.bearMax) return ["all", [">=", g, F.bearMin], ["<=", g, F.bearMax]];
    return ["any", [">=", g, F.bearMin], ["all", [">=", g, 0], ["<=", g, F.bearMax]]]; // wraps through North
  }
  function baseFilterFor(id) {
    const los = LOS.settings.filters.los;
    const len = lengthClause(), bear = bearingClause();
    if (id === "cameras" || id === "objects") {
      // cameras/objects hold BOTH single-location (hasLos:false) and
      // camera+subject photos.
      const isNo = ["==", ["get", "hasLos"], false];
      const isLos = ["==", ["get", "hasLos"], true];
      if (los === "nolos") return isNo;
      const match = ["all", len, bear];
      if (los === "los") return ["all", isLos, match];
      return ["any", isNo, ["all", isLos, match]]; // "all": single-location always pass
    }
    // cones / lines only ever hold has-LOS features.
    if (los === "nolos") return ["==", ["literal", 1], ["literal", 0]]; // hide all
    return ["all", len, bear];
  }
  function buildFilterFor(id) {
    // Photos with unsaved edits always pass — a filter must never hide the
    // point someone is in the middle of moving or just placed.
    return ["any", ["==", ["get", "edited"], true], baseFilterFor(id)];
  }
  function applyFilters() {
    for (const id of LOS.store.SOURCE_IDS) {
      if (map.getLayer(id)) map.setFilter(id, buildFilterFor(id));
    }
    clearHoverIfAny(); // a filtered-out hover would dangle
  }

  // ---- Basemap switching -------------------------------------------------------------------
  function switchBasemap(styleId) {
    if (styleId === LOS.settings.basemap) return;
    LOS.settings.basemap = styleId;
    LOS.ctxmenu.hide();
    map.setStyle(`mapbox://styles/mapbox/${styleId}`); // re-fires style.load -> everything re-added
  }

  LOS.mapView = {
    map, // reassigned in init()
    init,
    clearHover, clearHoverIfAny,
    hoverFromList, endListHover,
    getHoverUrl: () => hoverUrl,
    applyLayerStyle, applyAllStyles, applyFilters, applyTerrain,
    rebuildCones, rebuildConesDebounced,
    coneRadiusMeters,
    switchBasemap,
    getLastSearch: () => lastSearch,
  };
})();
