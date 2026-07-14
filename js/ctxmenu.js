/* Line of Sight tool — ctxmenu: the right-click menu.
   On empty map: open this spot in external map services. On a photo: photo
   actions (open, place camera/subject, hide/add to list, undo its unsaved
   edits) plus its Commons categories with counts. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  const $ctx = document.getElementById("ctxmenu");

  let ctxPhoto = null;   // {url, title} the open photo menu belongs to
  let ctxCatToken = 0;   // guards the async category fill

  const isOpen = () => $ctx.style.display === "block";
  const hide = () => { $ctx.style.display = "none"; };

  /** Show at `point`, nudged to stay inside the viewport. */
  function place(point) {
    $ctx.style.display = "block";
    const W = window.innerWidth, H = window.innerHeight;
    const mw = $ctx.offsetWidth, mh = $ctx.offsetHeight;
    let x = point.x, y = point.y;
    if (x + mw > W - 8) x = W - mw - 8;
    if (y + mh > H - 8) y = H - mh - 8;
    $ctx.style.left = `${Math.max(8, x)}px`;
    $ctx.style.top = `${Math.max(8, y)}px`;
  }

  // ---- Map-services menu (right-click on empty map) -----------------------------
  function showForSpot(point, lngLat) {
    if (LOS.select.isActive()) return;
    ctxPhoto = null;
    const lat = +lngLat.lat.toFixed(6), lon = +lngLat.lng.toFixed(6);
    const map = LOS.mapView.map;
    const z = map.getZoom(), b = map.getBearing();
    let html = '<div class="cm-head">Open this spot in…</div>';
    for (const s of LOS.config.MAP_SERVICES) {
      html += `<a href="${s.url(lat, lon, z, b)}" target="_blank" rel="noopener">${U.escapeHtml(s.name)}</a>`;
    }
    html += `<div class="cm-coord">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
    $ctx.innerHTML = html;
    place(point);
  }

  // ---- Photo menu (right-click on a photo) ----------------------------------------
  function showForPhoto(point, props) {
    if (LOS.select.isActive()) return;
    const { url, title } = props;
    const rec = LOS.store.get(url);
    ctxPhoto = { url, title };
    const inTray = LOS.tray.isPinned(url);
    let html = `<div class="cm-head">${U.escapeHtml(U.prettyTitle(title))}</div>` +
      '<button class="cm-item" data-act="open">🖼 Open photo (H)</button>' +
      `<button class="cm-item" data-act="camera">📷 ${rec?.cam ? "Move" : "Set"} camera location (C)</button>` +
      `<button class="cm-item" data-act="object">⭕ ${rec?.obj ? "Move" : "Set"} subject location (O)</button>` +
      (inTray
        ? (LOS.tray.isHidden(url)
            ? '<button class="cm-item" data-act="unhide">👁 Restore to the photo list</button>'
            : '<button class="cm-item" data-act="hide">✕ Hide from the photo list</button>')
        : '<button class="cm-item" data-act="tray">☰ Add to the photo list</button>');

    // This photo's unsaved edits, each individually undoable.
    const mine = LOS.edit.editsFor(url);
    if (mine.length) {
      html += '<div class="cm-head">Unsaved edits</div>';
      for (const { index, edit } of mine.slice().reverse()) {
        const desc = edit.from
          ? `moved ${U.fmtDist(U.distance(edit.from[0], edit.from[1], edit.to[0], edit.to[1]))}`
          : "added";
        html += `<button class="cm-item" data-act="unedit" data-i="${index}">↩ Undo: ${edit.kind === "camera" ? "📷" : "⭕"} ${desc}</button>`;
      }
    }
    html += '<div class="cm-head">Categories</div><div id="cm-cats"><div class="cm-note">Loading…</div></div>';
    $ctx.innerHTML = html;
    place(point);

    // Fill the (non-hidden) categories asynchronously, with counts.
    const token = ++ctxCatToken;
    LOS.api.fetchFileCategories([title])
      .then((m) => {
        const cats = m.get(title) || [];
        return LOS.api.fetchCategoryInfo(cats).then(() => {
          if (token !== ctxCatToken) return;
          const box = document.getElementById("cm-cats");
          if (!box) return;
          box.innerHTML = cats.length
            ? cats.map((c) =>
                `<button class="cm-item" data-act="cat" data-cat="${U.escapeHtml(c)}" title="${U.escapeHtml(LOS.api.catShort(c))}">` +
                `${U.escapeHtml(LOS.api.catShort(c))} <span class="cm-cnt">${U.escapeHtml(LOS.api.catCounts(c))}</span></button>`
              ).join("")
            : '<div class="cm-note">No visible categories</div>';
          place(point); // re-clamp with the new height
        });
      })
      .catch(() => {
        if (token !== ctxCatToken) return;
        const box = document.getElementById("cm-cats");
        if (box) box.innerHTML = '<div class="cm-note">Couldn’t load categories</div>';
      });
  }

  function onPhotoMenuAction(btn) {
    if (!ctxPhoto) return;
    const act = btn.getAttribute("data-act");
    const { url, title } = ctxPhoto;
    hide(); // always close first — removeEdit shifts the indices
    if (act === "open") LOS.viewer.openModal({ url, title });
    else if (act === "camera" || act === "object") { LOS.tray.selectPhoto(url); LOS.edit.startPlacing(url, act); }
    else if (act === "tray") { LOS.tray.addToTray([url]); LOS.tray.selectPhoto(url, { scroll: true }); }
    else if (act === "hide") LOS.tray.hidePhoto(url);
    else if (act === "unhide") LOS.tray.unhidePhoto(url);
    else if (act === "unedit") LOS.edit.removeEdit(parseInt(btn.getAttribute("data-i"), 10));
    else if (act === "cat") LOS.categories.openCategoryView(btn.getAttribute("data-cat"));
  }

  function init() {
    document.addEventListener("click", (e) => {
      if (isOpen() && !$ctx.contains(e.target)) hide();
    });
    $ctx.addEventListener("click", (e) => {
      if (e.target.tagName === "A") { hide(); return; }
      const btn = e.target.closest("button.cm-item");
      if (btn) onPhotoMenuAction(btn);
    });
  }

  LOS.ctxmenu = { init, isOpen, hide, showForSpot, showForPhoto };
})();
