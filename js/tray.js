/* Line of Sight tool — tray: the photo list on the right.

   Filled by polygon selection (replaces), ?files= links, category adds, and
   the photo context menu (append). Owns the photo selection (clicked row /
   ↑↓ navigation / last opened photo) and the persisted set of hidden photos
   (hiding is list-only — the map markers stay).

   Bunched / coincident photos are impossible to tell apart (or drag) on the
   map — the tray lists them as thumbnails, with per-photo buttons that set or
   move a location by clicking the map. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  const $tray = document.getElementById("tray");
  const $trayCount = document.getElementById("tray-count");
  const $trayItems = document.getElementById("tray-items");
  const $hiddenBtn = document.getElementById("tray-hidden-btn");

  let trayUrls = [];
  const traySet = new Set();   // protects tray photos from FIFO eviction
  const hiddenSet = new Set(); // photo urls hidden from the list (persisted)
  let showHidden = false;      // tray shows its hidden items instead

  let selectedUrl = null;      // the photo C/O/Q/E place locations for
  let lastSelectedUrl = null;  // remembered on deselect — ↑/↓ resume here

  const isOpen = () => $tray.classList.contains("show");

  // ---- Opening / filling ---------------------------------------------------------
  /** Polygon selection REPLACES the list (sorted by title). */
  function openTray(urls) {
    trayUrls = urls.slice().sort((a, b) => {
      const ra = LOS.store.get(a), rb = LOS.store.get(b);
      return (ra ? ra.title : a).localeCompare(rb ? rb.title : b);
    });
    traySet.clear();
    trayUrls.forEach((u) => traySet.add(u));
    document.body.classList.add("tray-open");
    $tray.classList.add("show");
    renderTray();
    LOS.status.set(`${U.plural(trayUrls.length, "photo")} selected — set locations from the tray`, false);
  }

  /** URL preloads, category adds, and the context menu APPEND.
      Returns how many were new. */
  function addToTray(urls) {
    let added = 0;
    for (const u of urls) {
      if (traySet.has(u)) continue;
      traySet.add(u);
      trayUrls.push(u);
      added++;
    }
    document.body.classList.add("tray-open");
    $tray.classList.add("show");
    renderTray();
    return added;
  }

  function closeTray() {
    $tray.classList.remove("show");
    document.body.classList.remove("tray-open");
    trayUrls = [];
    traySet.clear();
    LOS.categories.closeResults();
  }

  // ---- Selection -------------------------------------------------------------------
  function markSelectedTrayItem() {
    document.querySelectorAll("#tray-items .titem").forEach((item) => {
      item.classList.toggle("selected", item.getAttribute("data-url") === selectedUrl);
    });
  }

  /** Light selection setter used by the modal: highlight only, no preview/prefetch. */
  function setSelected(url) {
    selectedUrl = url;
    markSelectedTrayItem();
  }

  /** Select a photo (tray click, ↑/↓/W/S navigation, opening it big): the row
      highlights and the preview pins to it. Deliberately NO map hover/dim —
      lowering the other photos' opacity is a hover-only effect. */
  function selectPhoto(url, opts = {}) {
    selectedUrl = url;
    markSelectedTrayItem();
    const rec = LOS.store.get(url);
    if (!rec) return;
    LOS.images.prefetch(LOS.images.thumbUrl(rec.title, LOS.config.THUMB_W.modal)); // open-big is one key away
    if (opts.preview) LOS.viewer.showPreview({ url: rec.url, title: rec.title });
    if (opts.scroll) {
      $trayItems.querySelectorAll(".titem").forEach((item) => {
        if (item.getAttribute("data-url") === url) item.scrollIntoView({ block: "nearest" });
      });
    }
  }

  /** Esc → neutral state: nothing selected in the list, no pinned preview.
      The spot is remembered so ↑/↓ resume the selection right where it was. */
  function deselectPhoto() {
    lastSelectedUrl = selectedUrl;
    selectedUrl = null;
    markSelectedTrayItem();
    LOS.viewer.hidePreview();
  }

  /** The list rows currently shown: hidden photos are filtered out (or, in
      the "show hidden" view, they are the only ones shown). */
  function visibleTrayUrls() {
    return trayUrls.filter((u) => (showHidden ? hiddenSet.has(u) : !hiddenSet.has(u)));
  }

  /** ↑/↓ (and W/S) walk the visible list rows. Returns false when the tray is
      closed or empty so arrow keys fall through to normal map panning. */
  function trayNav(dir) {
    if (!isOpen()) return false;
    const vis = visibleTrayUrls();
    if (!vis.length) return false;
    let i = vis.indexOf(selectedUrl);
    if (i === -1) {
      // No selection: resume at the remembered spot, else enter from the edge.
      const j = lastSelectedUrl ? vis.indexOf(lastSelectedUrl) : -1;
      i = j !== -1 ? j : (dir > 0 ? 0 : vis.length - 1);
    } else {
      i = U.clamp(i + dir, 0, vis.length - 1);
    }
    selectPhoto(vis[i], { scroll: true, preview: true });
    return true;
  }

  // ---- Hidden photos (list only — the map markers stay) ------------------------------
  function hidePhoto(url) {
    hiddenSet.add(url);
    if (selectedUrl === url) { selectedUrl = null; LOS.viewer.hidePreview(); }
    renderTray();
    LOS.persist.saveDebounced();
  }
  function unhidePhoto(url) {
    hiddenSet.delete(url);
    renderTray();
    LOS.persist.saveDebounced();
  }
  function restoreAllHidden() {
    trayUrls.forEach((u) => hiddenSet.delete(u));
    showHidden = false;
    renderTray();
    LOS.persist.saveDebounced();
  }

  // ---- Rendering ----------------------------------------------------------------------
  function trayMeta(rec) {
    const cam = `📷 ${rec.cam ? "✓" : "—"}`;
    const obj = `⭕ ${rec.obj ? "✓" : "—"}`;
    const d = rec.cam && rec.obj
      ? ` · ${Math.round(U.distance(rec.cam[0], rec.cam[1], rec.obj[0], rec.obj[1]))} m`
      : "";
    return `${cam} &nbsp;${obj}${d}`;
  }
  function trayBtns(rec) {
    return `<button data-act="camera" title="Click the map to ${rec.cam ? "move" : "set"} the camera location">📷 ${rec.cam ? "Move" : "Set"}</button>` +
           `<button data-act="object" title="Click the map to ${rec.obj ? "move" : "set"} the subject location">⭕ ${rec.obj ? "Move" : "Set"}</button>`;
  }

  function renderTray() {
    const hiddenCount = trayUrls.filter((u) => hiddenSet.has(u)).length;
    const visCount = trayUrls.length - hiddenCount;
    $trayCount.textContent = showHidden
      ? `${U.plural(hiddenCount, "hidden photo")}`
      : `${U.plural(visCount, "photo")}${hiddenCount ? ` · ${hiddenCount} hidden` : ""}`;
    $hiddenBtn.style.display = hiddenCount || showHidden ? "" : "none";
    $hiddenBtn.classList.toggle("active", showHidden);
    $hiddenBtn.title = showHidden ? "Back to the photo list" : "Show hidden photos";

    let html = "";
    if (showHidden && hiddenCount) {
      html += `<div class="trestoreall"><button id="tray-restore-all">↩ Restore all ${hiddenCount}</button></div>`;
    }
    for (const u of visibleTrayUrls()) {
      const rec = LOS.store.get(u);
      if (!rec) continue;
      const act = showHidden
        ? '<button class="thide" data-act="unhide" title="Restore to the list">↩</button>'
        : '<button class="thide" data-act="hide" title="Hide from the list (right-click a row does too)">✕</button>';
      const thumb = LOS.images.thumbUrl(rec.title, LOS.config.THUMB_W.tray);
      const fallback = LOS.images.filePathUrl(rec.title, LOS.config.THUMB_W.tray);
      html += `<div class="titem${u === selectedUrl ? " selected" : ""}" data-url="${U.escapeHtml(u)}">${act}` +
        `<img data-src="${U.escapeHtml(thumb)}" data-fallback="${U.escapeHtml(fallback)}" decoding="async" alt="">` +
        `<div class="tmeta">` +
          `<div class="tt">${U.escapeHtml(U.prettyTitle(rec.title))}</div>` +
          `<div class="tb">${trayMeta(rec)}</div>` +
          `<div class="tbtns">${trayBtns(rec)}</div>` +
        `</div></div>`;
    }
    $trayItems.innerHTML = html || `<div class="empty">${showHidden
      ? "No hidden photos."
      : "No photos in the list — select an area on the map or add a category above."}</div>`;
    observeTrayImages();
  }

  // Lazy-load tray thumbnails through the session cache: each image is
  // fetched when it scrolls near view and reused from memory on every later
  // display (reopened tray, re-render after edits).
  let trayObserver = null;
  function observeTrayImages() {
    if (trayObserver) trayObserver.disconnect();
    trayObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        trayObserver.unobserve(en.target);
        const img = en.target;
        const url = img.getAttribute("data-src");
        if (!url) continue;
        LOS.images.loadImage(url)
          .then((src) => { img.src = src; })
          .catch(() => { img.src = url; }); // native load → data-fallback chain
      }
    }, { root: $trayItems, rootMargin: "300px" });
    $trayItems.querySelectorAll("img[data-src]").forEach((img) => trayObserver.observe(img));
  }

  /** Keep the badges/buttons current after placements, undo/redo, and saves —
      WITHOUT rebuilding the items (that would reload every thumbnail). */
  function refreshMeta() {
    if (!isOpen()) return;
    $trayItems.querySelectorAll(".titem").forEach((item) => {
      const rec = LOS.store.get(item.getAttribute("data-url"));
      if (!rec) return;
      const tb = item.querySelector(".tb");
      if (tb) tb.innerHTML = trayMeta(rec);
      const bt = item.querySelector(".tbtns");
      if (bt) bt.innerHTML = trayBtns(rec);
    });
  }

  // ---- Events ------------------------------------------------------------------------
  function wireEvents() {
    document.getElementById("tray-close").addEventListener("click", closeTray);
    $hiddenBtn.addEventListener("click", () => {
      showHidden = !showHidden;
      renderTray();
    });

    document.getElementById("tray-locator").addEventListener("click", () => {
      const titles = trayUrls
        .filter((u) => !hiddenSet.has(u))
        .map((u) => LOS.store.get(u)?.title)
        .filter(Boolean);
      if (!titles.length) return;
      if (titles.length > 50 && !window.confirm(`${titles.length} photos. Open them all in the Locator Tool?`)) return;
      // Locator Tool takes pipe-separated file titles after #/geolocate?files=
      const url = LOS.config.LOCATOR + titles.map((t) => encodeURIComponent(t.replace(/^File:/, ""))).join("|");
      window.open(url, "_blank", "noopener");
      LOS.status.set(`${U.plural(titles.length, "photo")} sent to the Locator Tool`, false);
    });

    // Thumbnail → full photo; 📷/⭕ button → click-to-place; ✕/↩ → hide/restore;
    // anywhere else → select the photo and pan to it.
    $trayItems.addEventListener("click", (e) => {
      if (e.target.id === "tray-restore-all") { restoreAllHidden(); return; }
      const item = e.target.closest(".titem");
      if (!item) return;
      const url = item.getAttribute("data-url");
      const rec = LOS.store.get(url);
      if (!rec) return;
      const hbtn = e.target.closest("button.thide");
      if (hbtn) {
        if (hbtn.getAttribute("data-act") === "hide") hidePhoto(url);
        else unhidePhoto(url);
        return;
      }
      const btn = e.target.closest("button[data-act]");
      if (btn) {
        selectPhoto(url);
        LOS.edit.startPlacing(url, btn.getAttribute("data-act"));
        return;
      }
      selectPhoto(url, { preview: true });
      if (e.target.tagName === "IMG") {
        LOS.viewer.openModal({ url, title: rec.title });
        return;
      }
      const pos = rec.cam || rec.obj;
      if (pos) LOS.mapView.map.easeTo({ center: pos, duration: 500 });
    });

    // Right-clicking a row hides it (restores it in the hidden view).
    $trayItems.addEventListener("contextmenu", (e) => {
      const item = e.target.closest(".titem");
      if (!item) return;
      e.preventDefault();
      const url = item.getAttribute("data-url");
      if (showHidden) unhidePhoto(url);
      else hidePhoto(url);
    });

    // Hovering a tray item highlights its dots/cone on the map (same
    // feature-state + dim mechanics as hovering the map itself) AND shows the
    // big preview thumbnail, exactly like hovering the dot on the map.
    $trayItems.addEventListener("mouseover", (e) => {
      const item = e.target.closest(".titem");
      if (!item) return;
      const rec = LOS.store.get(item.getAttribute("data-url"));
      if (!rec) return;
      LOS.mapView.hoverFromList(rec);
      LOS.viewer.showPreview({ url: rec.url, title: rec.title });
    });
    $trayItems.addEventListener("mouseout", (e) => {
      const item = e.target.closest(".titem");
      if (item && !item.contains(e.relatedTarget)) {
        LOS.mapView.endListHover(); // dimming is hover-only — always ends with the hover
        LOS.viewer.hidePreview();
        LOS.viewer.restoreSelectedPreview();
      }
    });
  }

  function init(hidden) {
    hidden.forEach((u) => hiddenSet.add(u));
    wireEvents();
  }

  LOS.tray = {
    init,
    openTray, addToTray, closeTray, isOpen,
    isPinned: (url) => traySet.has(url),
    isHidden: (url) => hiddenSet.has(url),
    hiddenList: () => [...hiddenSet],
    hidePhoto, unhidePhoto,
    selectPhoto, setSelected, deselectPhoto, trayNav,
    getSelectedUrl: () => selectedUrl,
    refreshMeta,
  };
})();
