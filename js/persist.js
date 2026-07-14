/* Line of Sight tool — persist: browser-persisted UI state + the URL hash.

   Everything the user can change (layers, filters, basemap, terrain, panel
   open/closed, search text, the open photo, hidden photos, and the map view)
   is mirrored to localStorage so a reload comes back exactly as it was left.
   The map view additionally lives in the URL hash (#map=zoom/lat/lon/bearing/
   pitch) so links share the exact view. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  const LS_KEY = "los-state-v1"; // schema is stable across refactors — old sessions must load

  /** Hydrate LOS.settings from localStorage. Runs BEFORE the map, panel, and
      layers are built so everything comes up exactly as it was left. Returns
      the parts owned by other modules, for main.js to distribute. */
  function load() {
    const restored = {
      panelCollapsed: true, // collapsed by default (until saved state says otherwise)
      search: "",
      mapView: null,       // {center,zoom,bearing,pitch} fallback when the URL has no #map hash
      pendingModal: null,  // {url,title} photo to re-open on load
      lastModal: null,     // {url,title} last photo opened big — H reopens it
      hidden: [],          // photo urls hidden from the tray list
    };
    let s;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
    catch { s = null; }
    if (!s || typeof s !== "object") return restored;

    const settings = LOS.settings;
    if (s.config) {
      for (const layer of Object.keys(settings.layers)) {
        const sv = s.config[layer];
        if (!sv) continue;
        for (const k of Object.keys(settings.layers[layer])) {
          if (sv[k] !== undefined) settings.layers[layer][k] = sv[k];
        }
      }
    }
    if (s.filters) {
      for (const k of Object.keys(settings.filters)) {
        if (s.filters[k] !== undefined) settings.filters[k] = s.filters[k];
      }
    }
    if (s.basemap && LOS.config.BASEMAPS.some((b) => b.id === s.basemap)) settings.basemap = s.basemap;
    if (typeof s.terrain === "boolean") settings.terrain = s.terrain;

    if (typeof s.search === "string") restored.search = s.search;
    if (typeof s.panelCollapsed === "boolean") restored.panelCollapsed = s.panelCollapsed;
    if (s.modal && s.modal.open && s.modal.url && s.modal.title) {
      restored.pendingModal = { url: s.modal.url, title: s.modal.title };
    }
    if (s.lastModal && s.lastModal.url && s.lastModal.title) {
      restored.lastModal = { url: s.lastModal.url, title: s.lastModal.title };
    }
    if (Array.isArray(s.hidden)) restored.hidden = s.hidden.filter((u) => typeof u === "string");
    if (s.map && Array.isArray(s.map.center) && isFinite(s.map.zoom)) {
      restored.mapView = {
        center: s.map.center, zoom: s.map.zoom,
        bearing: s.map.bearing || 0, pitch: s.map.pitch || 0,
      };
    }
    return restored;
  }

  function save() {
    try {
      const state = {
        config: LOS.settings.layers,
        filters: LOS.settings.filters,
        basemap: LOS.settings.basemap,
        terrain: LOS.settings.terrain,
        panelCollapsed: !!document.getElementById("panel")?.classList.contains("collapsed"),
        search: LOS.mapView.getLastSearch(),
        modal: LOS.viewer.getModalState(),
        lastModal: LOS.viewer.getLastModal(),
        hidden: LOS.tray.hiddenList().slice(-500), // bounded — hiding is list-only
      };
      const map = LOS.mapView.map;
      if (map) {
        const c = map.getCenter();
        state.map = {
          center: [c.lng, c.lat], zoom: map.getZoom(),
          bearing: map.getBearing(), pitch: map.getPitch(),
        };
      }
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch { /* storage disabled / full / serialization issue — ignore */ }
  }
  const saveDebounced = U.debounce(save, 200);

  // ---- URL hash map state (#map=zoom/lat/lon/bearing/pitch) -------------------
  function readHash() {
    const m = /#?map=([-\d.]+)\/([-\d.]+)\/([-\d.]+)(?:\/([-\d.]+))?(?:\/([-\d.]+))?/.exec(location.hash || "");
    if (!m) return null;
    const zoom = parseFloat(m[1]), lat = parseFloat(m[2]), lon = parseFloat(m[3]);
    if (!isFinite(zoom) || !isFinite(lat) || !isFinite(lon)) return null;
    return {
      center: [lon, lat],
      zoom,
      bearing: m[4] != null ? parseFloat(m[4]) : 0,
      pitch: m[5] != null ? parseFloat(m[5]) : 0,
    };
  }

  function writeHash() {
    const map = LOS.mapView.map;
    const c = map.getCenter();
    const h = `#map=${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}` +
              `/${map.getBearing().toFixed(1)}/${map.getPitch().toFixed(0)}`;
    try { history.replaceState(history.state, "", h); }
    catch { location.hash = h; }
  }

  LOS.persist = { load, save, saveDebounced, readHash, writeHash };
})();
