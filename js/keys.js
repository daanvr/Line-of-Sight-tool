/* Line of Sight tool — keys: the global keyboard router.
   Capture phase so tray navigation can beat Mapbox's own arrow-key panning;
   keys are only consumed when a handler actually used them. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});

  function isTyping(e) {
    const tag = e.target && e.target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable);
  }

  function onKeyDown(e) {
    if (isTyping(e)) return;

    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      if (LOS.edit.editCount()) {
        e.preventDefault();
        if (e.shiftKey) LOS.edit.redo();
        else LOS.edit.undo();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // never shadow browser shortcuts

    const k = e.key;
    if (k === "h" || k === "H") { LOS.viewer.handleHKey(e); return; }
    if (k === " ") {
      e.preventDefault();
      if (!e.repeat) LOS.viewer.toggleModalView();
      return;
    }
    if (k === "Escape") {
      if (LOS.edit.isPlacing()) { LOS.edit.cancelPlacing(); return; }
      if (LOS.select.isActive()) { LOS.select.exit(); LOS.status.set("Selection cancelled", false); return; }
      if (LOS.ctxmenu.isOpen()) { LOS.ctxmenu.hide(); return; }
      if (LOS.viewer.isModalOpen()) { LOS.viewer.closeModal(); return; }
      if (LOS.categories.isResultsOpen()) { LOS.categories.closeResults(); return; }
      if (LOS.tray.getSelectedUrl()) {
        LOS.tray.deselectPhoto();
        LOS.status.set("Selection cleared — ↑/↓ resume where it was", false);
        return;
      }
      if (LOS.tray.isOpen()) { LOS.tray.closeTray(); return; }
      return;
    }

    // ↑/↓ (and W/S) also work while a photo is open big — the big image
    // follows the selection through the list.
    if (["ArrowUp", "w", "W", "ArrowDown", "s", "S"].includes(k)) {
      const dir = k === "ArrowDown" || k === "s" || k === "S" ? 1 : -1;
      if (LOS.tray.trayNav(dir)) {
        e.preventDefault();
        e.stopPropagation();
        if (LOS.viewer.isModalOpen()) {
          const url = LOS.tray.getSelectedUrl(); // follow the selection, never a hover
          const rec = url && LOS.store.get(url);
          if (rec) LOS.viewer.openModal({ url: rec.url, title: rec.title });
        }
      }
      return;
    }

    if (LOS.viewer.isModalOpen()) return; // map keys are inert behind the photo
    if (k === "E") { LOS.edit.toggleEditMode(); return; } // ⇧E — manual edit-mode toggle
    if (k === "c" || k === "C" || k === "q" || k === "Q") { LOS.edit.placeSelected("camera"); return; }
    if (k === "o" || k === "O" || k === "e") { LOS.edit.placeSelected("object"); return; }
    if (k === "a" || k === "A") { LOS.edit.undo(); return; }
    if (k === "d" || k === "D") { LOS.edit.redo(); return; }
  }

  function init() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", (e) => {
      if (e.key === "h" || e.key === "H") LOS.viewer.onHKeyUp();
    });
    // Key released outside the window (Alt-Tab while holding H) must not leave
    // the view stuck in its peeked state.
    window.addEventListener("blur", LOS.viewer.onHKeyUp);
  }

  LOS.keys = { init };
})();
