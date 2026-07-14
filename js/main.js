/* Line of Sight tool — main: the boot sequence.
   Restores persisted state BEFORE the map and panel are built (so everything
   comes up exactly as it was left), wires every module, then preloads any
   photos named in the URL. */
(function () {
  "use strict";
  const LOS = window.LOS;
  const U = LOS.util;

  // ---- URL parameters: preload a photo list (?files= / ?file=) -----------------
  // Accepts pipe-separated entries: "File:Name.jpg", bare/underscored names
  // (Locator-tool style), and MediaInfo M-ids ("M12345"). Files without any
  // location are kept — they land in the photo list ready to be placed.
  function parseUrlFiles() {
    const qs = new URLSearchParams(location.search);
    const raw = qs.get("files") || qs.get("file") || "";
    const titles = [], pageids = [];
    for (let part of raw.split("|")) {
      part = part.trim();
      if (!part) continue;
      const m = /^M(\d+)$/i.exec(part);
      if (m) pageids.push(m[1]);
      else titles.push(`File:${part.replace(/^File:/i, "").replace(/_/g, " ")}`);
    }
    return { titles, pageids };
  }

  /** `hasUrlView`: the link carried its own #map view, which wins over auto-zoom. */
  async function preloadFromUrlParams(hasUrlView) {
    const req = parseUrlFiles();
    if (!req.titles.length && !req.pageids.length) return;
    LOS.status.set("Loading photos from the link…", true);
    const base = { prop: "coordinates", coprop: "type|name", coprimary: "all", colimit: "500", redirects: "1" };
    const pages = [];
    try {
      const chunks = [
        ...U.chunk(req.titles, 50).map((c) => ({ titles: c.join("|") })),
        ...U.chunk(req.pageids, 50).map((c) => ({ pageids: c.join("|") })),
      ];
      for (const chunkParams of chunks) {
        const res = await LOS.api.apiGETAll({ ...base, ...chunkParams });
        pages.push(...res.pages);
      }
    } catch (err) {
      console.warn("URL preload failed:", err);
      LOS.status.set("Couldn't load the photos from the link", false);
      return;
    }
    const urls = [];
    for (const pg of pages) {
      if (!pg || !pg.title || pg.missing !== undefined || pg.invalid !== undefined) continue;
      const rec = LOS.store.addPhoto(pg);
      if (rec) urls.push(rec.url);
    }
    if (!urls.length) { LOS.status.set("No photos found for the link", false); return; }
    LOS.store.syncSources();
    LOS.tray.addToTray(urls);
    LOS.tray.selectPhoto(urls[0], { preview: true, scroll: true });
    // Auto-zoom to the loaded photos — unless the link carried its own #map
    // view, which always wins. A single photo with camera + object gets its
    // whole line of sight fitted in view.
    if (!hasUrlView) {
      const pts = [];
      for (const u of urls) {
        const r = LOS.store.get(u);
        if (r?.cam) pts.push(r.cam);
        if (r?.obj) pts.push(r.obj);
      }
      if (pts.length) {
        const bounds = pts.reduce(
          (bb, c) => bb.extend(c),
          new mapboxgl.LngLatBounds(pts[0], pts[0]));
        LOS.mapView.map.fitBounds(bounds, { padding: 120, maxZoom: urls.length === 1 ? 18 : 16, duration: 800 });
      }
    }
    const noLoc = urls.filter((u) => {
      const r = LOS.store.get(u);
      return r && !r.cam && !r.obj;
    }).length;
    LOS.status.set(
      `${U.plural(urls.length, "photo")} loaded from the link` +
      (noLoc ? ` · ${noLoc} without a location` : ""), false);
  }

  // ---- Boot ---------------------------------------------------------------------
  // Hydrate settings / basemap / terrain / search / modal state BEFORE the map,
  // panel, and layers are built so everything comes up exactly as it was left.
  const restored = LOS.persist.load();
  // An explicit #map view in the link wins over the saved view and auto-zoom.
  const urlView = LOS.persist.readHash();

  LOS.images.init();
  LOS.mapView.init({ startView: urlView || restored.mapView, search: restored.search });
  LOS.tray.init(restored.hidden);
  LOS.viewer.init(restored);
  LOS.categories.init();
  LOS.select.init();
  LOS.edit.init();
  LOS.save.init();
  LOS.ctxmenu.init();
  LOS.keys.init();

  LOS.panel.build();
  LOS.panel.setCollapsed(restored.panelCollapsed);

  // Restore any photo that was open big when the page was left.
  if (restored.pendingModal) LOS.viewer.openModal(restored.pendingModal);

  // ?files= / ?file= in the link → preload the photo list. Called directly —
  // NOT from map "load" (which can stall forever on a slow tile): camera
  // moves work immediately, and features pushed before style.load are picked
  // up when the sources are (re)added, since they share the same objects.
  preloadFromUrlParams(!!urlView);
})();
