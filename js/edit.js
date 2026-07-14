/* Line of Sight tool — edit: moving/placing camera & subject locations.

   Owns edit mode, the drag and click-to-place flows, the iD-style undo/redo
   stack, the pink original→new overlay, the edit list, and the off-screen
   edge arrow. Talking to Commons (the Save button's actual work) lives in
   save.js. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  // ---- State -------------------------------------------------------------------
  let editMode = false;   // are the camera/subject points draggable
  let drag = null;        // {rec, kind, from, startPt, moved} during a point drag
  let placing = null;     // {url, kind} while placing a missing location
  let justDragged = false;// swallow the click that follows a drag
  let edits = [];         // {url,title,kind,from,to}; [0..editPtr) are applied
  let editPtr = 0;        // undo/redo pointer (number of applied edits)
  let showEdits = true;   // draw the original→new displacement overlay

  // Off-screen edit pointer.
  let arrowTarget = null;    // [lng,lat] the edge arrow points at
  let arrowEditIndex = -1;   // index into `edits` the arrow belongs to
  let hiIndex = -1;          // edit-list row currently highlighted

  // ---- DOM ------------------------------------------------------------------------
  const $map = document.getElementById("map");
  const $editbar = document.getElementById("editbar");
  const $editToggle = document.getElementById("edit-toggle");
  const $editUndo = document.getElementById("edit-undo");
  const $editRedo = document.getElementById("edit-redo");
  const $editCount = document.getElementById("edit-count");
  const $editRemind = document.getElementById("edit-remind");
  const $editNote = document.getElementById("edit-note");
  const $saveBtn = document.getElementById("save-btn");
  const $editList = document.getElementById("editlist");
  const $editItems = document.getElementById("editlist-items");
  const $edgeArrow = document.getElementById("edge-arrow");

  const map = () => LOS.mapView.map;

  // ---- Mode --------------------------------------------------------------------------
  function toggleEditMode() {
    if (editMode) exitEditMode();
    else enterEditMode();
  }
  function enterEditMode() {
    if (editMode) return;
    editMode = true;
    if (LOS.select.isActive()) LOS.select.exit();
    LOS.ctxmenu.hide();
    LOS.status.set("Edit mode — drag a camera or subject point to move it · click still opens", false);
    updateEditUI();
  }
  function exitEditMode() {
    if (!editMode) return;
    editMode = false;
    if (placing) cancelPlacing();
    endDrag();
    map().getCanvas().style.cursor = "";
    LOS.status.set(editPtr
      ? `${U.plural(editPtr, "unsaved edit")} — remember to save`
      : "Edit mode off", false);
    updateEditUI();
  }

  // ---- Drag lifecycle -------------------------------------------------------------------
  /** Mousedown on the cameras/objects layer hijacks the gesture from the map
      pan; a <3px move still counts as a click. */
  function onLayerMouseDown(e, kind) {
    if (!editMode || LOS.select.isActive() || placing || drag) return;
    const f = e.features && e.features[0];
    const rec = f && LOS.store.get(f.properties.url);
    if (!rec) return;
    const cur = kind === "camera" ? rec.cam : rec.obj;
    if (!cur) return;
    e.preventDefault(); // keep the map from panning
    drag = { rec, kind, from: cur.slice(), startPt: e.point, moved: false };
    LOS.mapView.clearHover();
    map().getCanvas().style.cursor = "grabbing";
  }

  /** Map mousemove hook. Returns true when the move was consumed (dragging or
      placing) so the hover machinery stays out of the way. */
  function onMapMouseMove(e) {
    if (drag) {
      if (!drag.moved) {
        const dx = e.point.x - drag.startPt.x;
        const dy = e.point.y - drag.startPt.y;
        if (dx * dx + dy * dy < 9) return true; // <3px: still counts as a click
        drag.moved = true;
      }
      setPos(drag.rec, drag.kind, [e.lngLat.lng, e.lngLat.lat]);
      return true;
    }
    return !!placing; // keep the crosshair; a click places the point
  }

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    map().getCanvas().style.cursor = "";
    if (!d.moved) return; // plain click — the modal opens via "click"
    justDragged = true;   // swallow the click this mouseup fires
    setTimeout(() => { justDragged = false; }, 0);
    const to = (d.kind === "camera" ? d.rec.cam : d.rec.obj).slice();
    recordEdit({ url: d.rec.url, title: d.rec.title, kind: d.kind, from: d.from, to });
  }

  function setPos(rec, kind, pos) {
    if (kind === "camera") rec.cam = pos;
    else rec.obj = pos;
    LOS.store.rebuildPhotoFeatures(rec);
    renderOverlay();
  }

  // ---- Placing a camera/subject location by clicking the map ------------------------------
  // Adds the location when it is missing, moves it when it already exists —
  // the click-to-place flow is how bunched-up points get edited (dragging
  // can't tell coincident dots apart).
  function startPlacing(url, kind) {
    const rec = LOS.store.get(url);
    if (!rec) {
      LOS.status.set("Photo is no longer loaded — move the map to reload it", false);
      return;
    }
    if (!editMode) enterEditMode();
    placing = { url, kind };
    LOS.mapView.clearHover();
    map().getCanvas().style.cursor = "crosshair";
    const exists = kind === "camera" ? rec.cam : rec.obj;
    LOS.status.set(`Click the map to ${exists ? "move" : "place"} the ${kind === "camera" ? "camera" : "subject"} location · Esc to cancel`, false);
  }

  function cancelPlacing() {
    placing = null;
    map().getCanvas().style.cursor = "";
    LOS.status.set("Placement cancelled", false);
  }

  function finishPlacing(lngLat) {
    const p = placing;
    placing = null;
    map().getCanvas().style.cursor = "";
    const rec = LOS.store.get(p.url);
    if (!rec) return;
    const prev = p.kind === "camera" ? rec.cam : rec.obj; // null = the location is new
    const from = prev ? prev.slice() : null;
    const pos = [lngLat.lng, lngLat.lat];
    setPos(rec, p.kind, pos);
    recordEdit({ url: rec.url, title: rec.title, kind: p.kind, from, to: pos.slice() });
    LOS.status.set(`${from ? "Moved" : "Added"} ${p.kind === "camera" ? "camera" : "subject"} location — remember to save`, false);
  }

  /** Map click hook: swallow the click after a drag, or place the pending
      location. Returns true when consumed. */
  function onMapClick(e) {
    if (justDragged) { justDragged = false; return true; }
    if (placing) { finishPlacing(e.lngLat); return true; }
    return false;
  }

  /** C/O/Q/E place a location for the selected photo (startPlacing auto-enters
      edit mode). Selection = clicked/arrow-navigated list item or last opened photo. */
  function placeSelected(kind) {
    const url = LOS.tray.getSelectedUrl();
    if (!url) {
      LOS.status.set("Select a photo first — click a list item, use ↑/↓, or open one", false);
      return;
    }
    startPlacing(url, kind);
  }

  // ---- Undo / redo stack (iD-style pointer into the edit list) ------------------------------
  function applyPos(url, kind, pos) {
    const rec = LOS.store.get(url);
    if (!rec) return;
    if (kind === "camera") rec.cam = pos ? pos.slice() : null;
    else rec.obj = pos ? pos.slice() : null;
    LOS.store.rebuildPhotoFeatures(rec);
  }

  function recordEdit(e) {
    edits.length = editPtr; // a fresh edit clears the redo tail
    edits.push(e);
    editPtr++;
    if (editPtr === 1) $editList.classList.add("show");
    renderOverlay();
    updateEditUI();
  }

  function undo() {
    if (!editPtr) return;
    editPtr--;
    const e = edits[editPtr];
    applyPos(e.url, e.kind, e.from);
    renderOverlay();
    updateEditUI();
  }

  function redo() {
    if (editPtr >= edits.length) return;
    const e = edits[editPtr];
    editPtr++;
    applyPos(e.url, e.kind, e.to);
    renderOverlay();
    updateEditUI();
  }

  /** Undo one specific (possibly non-latest) edit from the list. */
  function removeEdit(i) {
    if (i < 0 || i >= editPtr) return;
    const e = edits.splice(i, 1)[0];
    editPtr--;
    // Keep the chain consistent: the next edit of the same point inherits `from`.
    for (let k = i; k < edits.length; k++) {
      if (edits[k].url === e.url && edits[k].kind === e.kind) { edits[k].from = e.from; break; }
    }
    // The point lands on its last still-applied edit, else back on the original.
    let pos = null, found = false;
    for (let k = editPtr - 1; k >= 0; k--) {
      if (edits[k].url === e.url && edits[k].kind === e.kind) { pos = edits[k].to; found = true; break; }
    }
    if (!found) {
      const rec = LOS.store.get(e.url);
      pos = rec ? (e.kind === "camera" ? rec.origCam : rec.origObj) : null;
    }
    applyPos(e.url, e.kind, pos);
    clearHighlight();
    renderOverlay();
    updateEditUI();
  }

  /** Called by save.js after a save: saved photos leave the undo stack;
      failed ones keep their edits. */
  function dropEditsFor(savedUrls) {
    edits.length = editPtr;
    edits = edits.filter((e) => !savedUrls.has(e.url));
    editPtr = edits.length;
  }

  /** This photo's applied edits, oldest first, as {index, edit} pairs (for the
      context menu's per-edit undo). */
  function editsFor(url) {
    const out = [];
    for (let i = 0; i < editPtr; i++) {
      if (edits[i].url === url) out.push({ index: i, edit: edits[i] });
    }
    return out;
  }

  // ---- Edit overlay + per-edit highlight ------------------------------------------------
  /** Dashed original→new displacement lines, a hollow ghost at the original
      spot, a filled dot at the new one. */
  function renderOverlay() {
    const lineFC = U.emptyFC(), ptFC = U.emptyFC();
    LOS.store.index.forEach((rec) => {
      for (const [kind, cur, orig] of [["camera", rec.cam, rec.origCam], ["object", rec.obj, rec.origObj]]) {
        if (!LOS.store.posChanged(cur, orig)) continue;
        const props = { url: rec.url, kind };
        if (cur && orig) lineFC.features.push(U.feature("LineString", [orig.slice(), cur.slice()], props, undefined));
        if (orig) ptFC.features.push(U.feature("Point", orig.slice(), { role: "orig", ...props }, undefined));
        if (cur) ptFC.features.push(U.feature("Point", cur.slice(), { role: "new", ...props }, undefined));
      }
    });
    map().getSource("edit-lines")?.setData(lineFC);
    map().getSource("edit-pts")?.setData(ptFC);
  }

  /** Hovering a list row only HIGHLIGHTS the edit (no pan). When the edit is
      off-screen an edge arrow points the way; clicking the row or the arrow
      flies there. */
  function highlightEdit(i) {
    const e = edits[i];
    if (!e) return;
    const fc = U.emptyFC();
    if (e.from && e.to) fc.features.push(U.feature("LineString", [e.from, e.to], {}, undefined));
    if (e.from) fc.features.push(U.feature("Point", e.from, {}, undefined));
    if (e.to) fc.features.push(U.feature("Point", e.to, {}, undefined));
    map().getSource("edit-hi")?.setData(fc);
    arrowTarget = e.from && e.to
      ? [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2]
      : (e.to || e.from);
    arrowEditIndex = i;
    updateEdgeArrow();
  }

  /** Pan only — reviewing an edit must never change the zoom level. */
  function flyToEdit(i) {
    highlightEdit(i);
    if (arrowTarget) map().easeTo({ center: arrowTarget, duration: 500 });
  }

  function clearHighlight() {
    map().getSource("edit-hi")?.setData(U.emptyFC());
    arrowTarget = null;
    arrowEditIndex = -1;
    hideEdgeArrow();
  }

  // ---- Off-screen edit pointer (edge arrow) ------------------------------------------------
  function updateEdgeArrow() {
    if (!arrowTarget) { hideEdgeArrow(); return; }
    const W = $map.clientWidth, H = $map.clientHeight, M = 34; // clamp margin
    let p;
    try { p = map().project(arrowTarget); }
    catch { hideEdgeArrow(); return; }
    // Behind the camera at high pitch → nonsense/huge projections. Bail.
    if (!p || !isFinite(p.x) || !isFinite(p.y) || Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) {
      hideEdgeArrow();
      return;
    }
    if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) { hideEdgeArrow(); return; } // on-screen
    const x = U.clamp(p.x, M, W - M), y = U.clamp(p.y, M, H - M); // pin to the viewport edge
    const ang = Math.atan2(p.y - y, p.x - x);                     // pinned pos → true pos
    const c = map().getCenter();
    $edgeArrow.querySelector(".ea-dist").textContent =
      U.fmtDist(U.distance(c.lng, c.lat, arrowTarget[0], arrowTarget[1]));
    $edgeArrow.querySelector(".ea-glyph").style.transform = `rotate(${ang}rad)`;
    $edgeArrow.style.left = `${x}px`;
    $edgeArrow.style.top = `${y}px`;
    $edgeArrow.style.transform = "translate(-50%,-50%)";
    $edgeArrow.style.display = "flex";
  }
  function hideEdgeArrow() { $edgeArrow.style.display = "none"; }

  // ---- Edit toolbar + list UI -------------------------------------------------------------
  function updateEditUI() {
    const n = editPtr;
    $editbar.classList.toggle("show", editMode || edits.length > 0);
    $editToggle.classList.toggle("active", editMode);
    document.getElementById("edit-btn")?.classList.toggle("active", editMode);
    $editCount.textContent = U.plural(n, "edit");
    $editRemind.textContent = n ? "unsaved — click Save" : "";
    $editUndo.disabled = !n;
    $editRedo.disabled = editPtr >= edits.length;

    const save = LOS.save;
    const dirtyN = LOS.store.dirtyRecs().length;
    // No session? The button stays clickable — it runs the OAuth sign-in
    // first and then saves.
    $saveBtn.disabled = !dirtyN || save.isSaving();
    $saveBtn.textContent = save.isSaving()
      ? "Saving…"
      : (dirtyN && !save.hasToken())
        ? "Sign in to save"
        : (dirtyN ? `Save ${U.plural(dirtyN, "photo")}` : "Save");
    // The save button escalates as unsaved edits pile up.
    $saveBtn.classList.toggle("some", n >= 1 && n < 5);
    $saveBtn.classList.toggle("warn", n >= 5 && n < 10);
    $saveBtn.classList.toggle("alert", n >= 10);
    // Undoing everything away also cancels a pending failed-save retry.
    if (save.isFailed() && !dirtyN) save.clearFailure();
    $editNote.textContent = dirtyN && !save.hasToken()
      ? "Saving needs a Wikimedia account sign-in"
      : (save.isFailed() ? "Saving failed — will retry" : "");
    // Sign-out button: only when signed in through the OAuth flow (the
    // dev-override token has nothing to sign out of).
    const $authBtn = document.getElementById("auth-btn");
    if ($authBtn) {
      const authed = save.hasToken() && !LOS.auth.isOverride();
      $authBtn.style.display = authed ? "" : "none";
      const who = LOS.auth.username();
      $authBtn.title = `Signed in${who ? ` as ${who}` : ""} — click to sign out`;
    }
    save.updateRetryUI();

    renderEditList();
    LOS.tray.refreshMeta(); // placements / undo / redo / saves change the tray badges
  }

  function renderEditList() {
    // Rebuilding pulls the hovered item out from under the cursor, so the
    // mouseout that would clear the highlight never fires — clear it here.
    hiIndex = -1;
    clearHighlight();
    if (!editPtr) {
      $editItems.innerHTML = '<div class="empty">No edits yet — drag a camera or subject point in edit mode.</div>';
      return;
    }
    let html = "";
    for (let i = editPtr - 1; i >= 0; i--) { // newest on top, like iD
      const e = edits[i];
      const desc = e.from
        ? `moved ${Math.round(U.distance(e.from[0], e.from[1], e.to[0], e.to[1]))} m`
        : "added";
      html += `<div class="eitem" data-i="${i}">` +
        `<span class="ek" title="${e.kind} location">${e.kind === "camera" ? "📷" : "⭕"}</span>` +
        `<span class="et">${U.escapeHtml(U.prettyTitle(e.title))}</span>` +
        `<span class="ed">${desc}</span>` +
        `<button class="eundo" title="Undo this edit">↩</button>` +
      `</div>`;
    }
    $editItems.innerHTML = html;
  }

  // ---- Wiring ----------------------------------------------------------------------------
  function init() {
    $editToggle.addEventListener("click", toggleEditMode);
    $editUndo.addEventListener("click", undo);
    $editRedo.addEventListener("click", redo);
    document.getElementById("edit-btn").addEventListener("click", toggleEditMode);
    document.getElementById("edit-list-btn").addEventListener("click", () => $editList.classList.toggle("show"));
    document.getElementById("editlist-close").addEventListener("click", () => $editList.classList.remove("show"));

    // "View mode": the original→new overlay can be toggled on/off independently.
    document.getElementById("edit-show").addEventListener("change", (e) => {
      showEdits = e.target.checked;
      for (const id of ["edit-lines", "edit-pts"]) {
        if (map().getLayer(id)) map().setLayoutProperty(id, "visibility", showEdits ? "visible" : "none");
      }
    });

    $editItems.addEventListener("mouseover", (e) => {
      const item = e.target.closest(".eitem");
      if (!item) return;
      const i = parseInt(item.getAttribute("data-i"), 10);
      if (i !== hiIndex) { hiIndex = i; highlightEdit(i); }
    });
    $editItems.addEventListener("mouseout", (e) => {
      const item = e.target.closest(".eitem");
      if (item && !item.contains(e.relatedTarget)) { hiIndex = -1; clearHighlight(); }
    });
    $editItems.addEventListener("click", (e) => {
      const item = e.target.closest(".eitem");
      if (!item) return;
      const i = parseInt(item.getAttribute("data-i"), 10);
      if (e.target.closest(".eundo")) removeEdit(i);
      else flyToEdit(i); // row click → go to the edit
    });

    $edgeArrow.addEventListener("click", () => {
      if (arrowEditIndex >= 0) flyToEdit(arrowEditIndex);
    });
    map().on("move", updateEdgeArrow); // cheap: early-outs when nothing is highlighted

    // Unsaved edits block a casual tab close / reload.
    window.addEventListener("beforeunload", (e) => {
      if (!LOS.store.dirtyRecs().length) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  LOS.edit = {
    init,
    // mode
    toggleEditMode, isActive: () => editMode,
    // map interaction hooks (called from mapView's wiring)
    onLayerMouseDown, onMapMouseMove, onMapClick, endDrag,
    isDragging: () => !!drag,
    // placing
    startPlacing, cancelPlacing, placeSelected,
    isPlacing: () => !!placing,
    // undo/redo
    undo, redo, removeEdit, dropEditsFor, editsFor,
    editCount: () => edits.length,
    // overlay + UI
    renderOverlay, updateEditUI,
    isOverlayShown: () => showEdits,
  };
})();
