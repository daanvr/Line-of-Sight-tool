/* Line of Sight tool — select: draw a polygon on the map, collect the photos
   inside it into the tray. Click adds vertices, double-click finishes, Esc
   cancels. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  let active = false;    // is the user drawing a selection polygon
  let pts = [];          // [lng,lat] vertices of the in-progress polygon
  let clickTimer = null; // single- vs double-click discrimination
  let $btn = null;       // the "Select photos in an area" button

  const isActive = () => active;

  function enter() {
    if (active) { exit(); LOS.status.set("Selection cancelled", false); return; }
    if (LOS.edit.isPlacing()) LOS.edit.cancelPlacing();
    active = true;
    pts = [];
    LOS.ctxmenu.hide();
    LOS.mapView.clearHover();
    // Open the photo list right away (even empty) — the category search at
    // its top is the other way to fill it, no polygon required.
    if (!LOS.tray.isOpen()) LOS.tray.addToTray([]);
    const map = LOS.mapView.map;
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = "crosshair";
    $btn?.classList.add("active");
    LOS.status.set("Click to add points · double-click to finish · Esc to cancel", false);
  }

  function exit() {
    active = false;
    pts = [];
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    render(null);
    const map = LOS.mapView.map;
    map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = "";
    $btn?.classList.remove("active");
  }

  /** Defer adding a vertex briefly so a double-click (finish) doesn't also
      drop two stray vertices. */
  function onClick(lngLat) {
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      pts.push([lngLat.lng, lngLat.lat]);
      render(null);
    }, 220);
  }

  function onDblClick() {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    finish();
  }

  /** Redraw the in-progress polygon; `cursor` extends it to the mouse position. */
  function render(cursor) {
    const ring = pts.map((p) => [p[0], p[1]]);
    if (cursor) ring.push([cursor.lng, cursor.lat]);
    const ptsFC = {
      type: "FeatureCollection",
      features: pts.map((p) => U.feature("Point", [p[0], p[1]], {}, undefined)),
    };
    let geoFC;
    if (ring.length >= 3) {
      geoFC = { type: "FeatureCollection", features: [U.feature("Polygon", [ring.concat([ring[0]])], {}, undefined)] };
    } else if (ring.length === 2) {
      geoFC = { type: "FeatureCollection", features: [U.feature("LineString", ring, {}, undefined)] };
    } else {
      geoFC = U.emptyFC();
    }
    const map = LOS.mapView.map;
    map.getSource("select")?.setData(geoFC);
    map.getSource("select-pts")?.setData(ptsFC);
  }

  function finish() {
    const ring = pts.slice();
    if (ring.length < 3) {
      exit();
      LOS.status.set("Need at least 3 points — selection cancelled", false);
      return;
    }
    // A photo counts as selected when EITHER of its dots (camera or subject)
    // sits inside the polygon — on a visible layer — and passes the filters.
    const layers = LOS.settings.layers;
    const urls = [];
    LOS.store.index.forEach((rec, url) => {
      const camIn = layers.cameras.visible && rec.cam && U.pointInPolygon(rec.cam, ring);
      const objIn = layers.objects.visible && rec.obj && U.pointInPolygon(rec.obj, ring);
      if ((camIn || objIn) && LOS.store.photoPassesFilters(rec)) urls.push(url);
    });
    exit();
    if (!urls.length) { LOS.status.set("No photos inside the selection", false); return; }
    LOS.tray.openTray(urls);
  }

  function init() {
    $btn = document.getElementById("select-btn");
    $btn.addEventListener("click", enter);
  }

  LOS.select = { init, isActive, enter, exit, onClick, onDblClick, render };
})();
