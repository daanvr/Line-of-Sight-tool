/* Line of Sight tool — viewer: the hover preview thumbnail and the full-size
   modal, plus the H-key "peek at the other view" behaviour. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;
  const W = () => LOS.config.THUMB_W;

  const $map = document.getElementById("map");
  const $preview = document.getElementById("preview");
  const $previewImg = document.getElementById("preview-img");
  const $previewCap = document.getElementById("preview-cap");
  const $modal = document.getElementById("modal");
  const $modalImg = document.getElementById("modal-img");
  const $modalMeta = document.getElementById("modal-meta");

  let previewToken = 0, modalToken = 0; // guard async fills against stale responses
  let previewFor = null;                // url the #preview box currently shows
  let modalState = { open: false, url: null, title: null };
  let lastModal = null;                 // {url,title} last photo opened big — H reopens it
  let peeking = false;                  // H held down: modal temporarily invisible
  let hPeekToImage = false;             // H opened the image from the map view

  // ---- Hover preview -----------------------------------------------------------
  function showPreview(p) {
    const token = ++previewToken;
    previewFor = p.url;
    const img = LOS.images;
    // Blank the <img> immediately so the previous photo never lingers, then
    // reveal the new one only once ITS load fires for the still-current token.
    $previewImg.classList.remove("loaded");
    $previewImg.removeAttribute("src");
    delete $previewImg.dataset.fallback;
    $previewImg.onload = () => {
      if (token !== previewToken) return;
      $previewImg.classList.add("loaded");
      // The user is looking at this photo — warm the modal-size version now
      // so a click opens it instantly.
      img.prefetch(img.thumbUrl(p.title, W().modal));
    };
    $previewImg.onerror = () => {
      if (token === previewToken) $previewImg.classList.remove("loaded");
    };
    const previewUrl = img.thumbUrl(p.title, W().preview);
    img.loadImage(previewUrl)
      .then((src) => {
        if (token !== previewToken) return;
        $previewImg.src = src; // served from the session cache
      })
      .catch(() => {
        if (token !== previewToken) return;
        $previewImg.dataset.fallback = img.filePathUrl(p.title, W().preview);
        $previewImg.src = previewUrl; // native load, FilePath as last resort
      });
    // Single-location photos advertise the double-click shortcut.
    const rec = LOS.store.get(p.url);
    const hint = rec && (!rec.cam || !rec.obj)
      ? `<br><span style="color:var(--edit)">double-click the dot to add the ${rec.cam ? "subject" : "camera"} location</span>`
      : "";
    const title = `<strong>${U.escapeHtml(U.prettyTitle(p.title))}</strong>`;
    $previewCap.innerHTML = `${title}<br>Loading…${hint}`;
    $preview.classList.add("show");
    LOS.api.fetchAttribution(p.title).then((a) => {
      if (token !== previewToken) return; // user moved on — drop stale fill
      const who = a.author && a.author !== "Unknown author"
        ? `by ${U.escapeHtml(a.author)}` : "Unknown author";
      const lic = a.license ? ` · ${U.escapeHtml(a.license)}` : "";
      $previewCap.innerHTML = `${title}<br>${who}${lic}${hint}`;
    });
  }

  function hidePreview() {
    $preview.classList.remove("show");
    previewToken++;
    previewFor = null;
    $previewImg.classList.remove("loaded");
    $previewImg.removeAttribute("src");
  }

  /** The selected photo keeps an "active" preview thumbnail: hovering another
      photo temporarily overrides it, and every hover-end path falls back here
      instead of to an empty preview. Preview ONLY — no map hover/dim (that is
      reserved for actual hovering). No-ops (cheap) when already showing it. */
  function restoreSelectedPreview() {
    const url = LOS.tray.getSelectedUrl();
    if (!url) return;
    const rec = LOS.store.get(url);
    if (!rec) return;
    if (previewFor !== url || !$preview.classList.contains("show")) {
      showPreview({ url: rec.url, title: rec.title });
    }
  }

  // ---- Full-size modal -----------------------------------------------------------
  function openModal(p) {
    const token = ++modalToken;
    LOS.mapView.clearHover(); // the modal covers the map — never keep a stale hover under it
    const img = LOS.images;
    // Two-step image: the preview size is almost always in the session cache
    // already (hovering put it there), so it appears instantly; the big
    // version is swapped in the moment it's ready. On a hover→click flow the
    // big one is usually cached too — showPreview prefetches it.
    const bigUrl = img.thumbUrl(p.title, W().modal);
    let bigShown = false;
    delete $modalImg.dataset.fallback;
    img.loadImage(img.thumbUrl(p.title, W().preview))
      .then((src) => {
        if (token !== modalToken || bigShown) return;
        $modalImg.src = src;
      })
      .catch(() => {});
    img.loadImage(bigUrl)
      .then((src) => {
        if (token !== modalToken) return;
        bigShown = true;
        $modalImg.src = src;
      })
      .catch(() => {
        if (token !== modalToken) return;
        bigShown = true; // a late small must not overwrite the fallback
        $modalImg.dataset.fallback = img.filePathUrl(p.title, W().modal);
        $modalImg.src = bigUrl; // native load, FilePath as last resort
      });

    const fileUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`;
    const locatorUrl = LOS.config.LOCATOR + encodeURIComponent(p.title);
    // Photos missing one of the two locations get a one-click way to place it.
    const rec = LOS.store.get(p.url);
    const addLink = rec && (!rec.cam || !rec.obj)
      ? `<a href="#" id="modal-add-loc" data-kind="${rec.cam ? "object" : "camera"}">＋ Add ${rec.cam ? "subject" : "camera"} location here</a>`
      : "";
    $modalMeta.innerHTML =
      `<div class="title">${U.escapeHtml(U.prettyTitle(p.title))}</div>` +
      `<div class="by" id="modal-by">Loading…</div>` +
      `<div class="links">` +
        `<a href="${fileUrl}" target="_blank" rel="noopener">View on Commons ↗</a>` +
        `<a href="${locatorUrl}" target="_blank" rel="noopener">Edit location in Locator Tool ↗</a>` +
        addLink +
      `</div>`;
    document.getElementById("modal-add-loc")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      closeModal();
      LOS.edit.startPlacing(p.url, ev.currentTarget.getAttribute("data-kind"));
    });

    $modal.classList.add("show");
    $map.classList.add("blur");
    modalState = { open: true, url: p.url, title: p.title };
    lastModal = { url: p.url, title: p.title }; // H reopens this after closing
    LOS.tray.setSelected(p.url);                // C/O now place for this photo
    LOS.persist.save();
    LOS.api.fetchAttribution(p.title).then((a) => {
      if (token !== modalToken) return; // modal closed or changed
      const by = a.authorHtml && a.authorHtml.length
        ? a.authorHtml
        : (a.author ? U.escapeHtml(a.author) : "Unknown author");
      const lic = a.license ? ` &nbsp;·&nbsp; ${U.escapeHtml(a.license)}` : "";
      const el = document.getElementById("modal-by");
      if (el) el.innerHTML = `by ${by}${lic}`;
    });
  }

  function closeModal() {
    $modal.classList.remove("show");
    $map.classList.remove("blur");
    $modalImg.src = "";
    modalToken++; // discard any pending attribution fill
    modalState = { open: false, url: null, title: null };
    hPeekToImage = false;
    endModalPeek();
    $modal.classList.remove("peek"); // never leave a stale peek behind
    LOS.persist.save();
  }

  // ---- H key: hold to peek at the OTHER view (map ⇄ big image) -----------------
  // While H is down the view flips — photo open → see the map, map in view →
  // see the last photo. Releasing H always returns to the previous state.
  // Space (toggleModalView) does the same flip, but permanently.
  function startModalPeek() {
    if (peeking || !modalState.open) return;
    peeking = true;
    $modal.classList.add("peek");
    $map.classList.remove("blur"); // actually show the map beneath
  }
  function endModalPeek() {
    if (!peeking) return;
    peeking = false;
    $modal.classList.remove("peek");
    if (modalState.open) $map.classList.add("blur");
  }

  /** What H/Space should show big: the photo under the cursor right now wins,
      then the SELECTED photo (arrow keys / list clicks move this), then the
      last photo that was open. openModal clears hover, so a hover can never
      go stale behind an open photo. */
  function bigViewTarget() {
    const url = LOS.mapView.getHoverUrl() || LOS.tray.getSelectedUrl();
    if (url) {
      const rec = LOS.store.get(url);
      if (rec) return { url: rec.url, title: rec.title };
    }
    return lastModal;
  }

  function handleHKey(e) {
    if (e.repeat) return;
    const target = bigViewTarget();
    if (modalState.open) startModalPeek();
    else if (target) { hPeekToImage = true; openModal(target); }
    else LOS.status.set("No photo selected yet — click one on the map or in the list first", false);
  }
  function onHKeyUp() {
    endModalPeek();
    if (hPeekToImage && modalState.open) closeModal(); // closeModal resets the flag
  }
  function toggleModalView() {
    const target = bigViewTarget();
    if (modalState.open) closeModal();
    else if (target) openModal(target);
    else LOS.status.set("No photo selected yet — click one on the map or in the list first", false);
  }

  function init(restored) {
    lastModal = restored.lastModal;
    document.getElementById("modal-close").addEventListener("click", closeModal);
    $modal.addEventListener("click", (e) => { if (e.target === $modal) closeModal(); });
  }

  LOS.viewer = {
    init,
    showPreview, hidePreview, restoreSelectedPreview,
    openModal, closeModal,
    handleHKey, onHKeyUp, toggleModalView,
    isModalOpen: () => modalState.open,
    getModalState: () => modalState,
    getLastModal: () => lastModal,
  };
})();
