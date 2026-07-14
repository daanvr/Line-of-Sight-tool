/* Line of Sight tool — categories: the search box at the top of the tray.

   Empty + focused → suggests the categories of the photos in view (most-used
   first). Typing → prefix search of all Commons categories. A row opens the
   drill-down view (counts + "add all" + subcategories); ＋ adds a category's
   files to the photo list — including files with no location yet, ready to be
   placed on the map. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  const $search = document.getElementById("cat-search");
  const $results = document.getElementById("cat-results");

  let catToken = 0; // guards async fills against stale responses

  const isResultsOpen = () => $results.classList.contains("show");

  function closeResults() {
    catToken++;
    $results.innerHTML = "";
    $results.classList.remove("show");
  }

  function showHtml(html) {
    $results.innerHTML = html;
    $results.classList.add("show");
  }

  function catRow(cat, star) {
    const A = LOS.api;
    return `<div class="crow" data-cat="${U.escapeHtml(cat)}">` +
      (star ? `<span class="cstar" title="${U.plural(star, "photo")} in view use this category">★${star}</span>` : "") +
      `<span class="cname" title="${U.escapeHtml(A.catShort(cat))}">${U.escapeHtml(A.catShort(cat))}</span>` +
      `<span class="ccnt">${U.escapeHtml(A.catCounts(cat))}</span>` +
      `<button class="cadd" data-cat="${U.escapeHtml(cat)}" title="Add all files from this category to the list">＋</button>` +
    `</div>`;
  }

  /** Empty search box → suggest the (non-hidden) categories of the photos in
      view, most-used first, each with its file/subcategory counts. */
  async function suggestInViewCategories() {
    const token = ++catToken;
    const b = LOS.mapView.map.getBounds();
    const titles = [];
    LOS.store.index.forEach((rec) => {
      if (titles.length >= 150) return;
      const p = rec.cam || rec.obj;
      if (p && b.contains({ lng: p[0], lat: p[1] })) titles.push(rec.title);
    });
    if (!titles.length) {
      showHtml('<div class="cempty">No photos in view — type to search all of Commons.</div>');
      return;
    }
    showHtml(`<div class="cempty">Loading the categories of ${titles.length} photos in view…</div>`);
    try {
      const catsByFile = await LOS.api.fetchFileCategories(titles);
      if (token !== catToken) return;
      const freq = new Map();
      catsByFile.forEach((cats) => {
        cats.forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
      });
      const top = [...freq.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 15);
      await LOS.api.fetchCategoryInfo(top.map(([cat]) => cat));
      if (token !== catToken) return;
      showHtml('<div class="cathead">Categories of the photos in view</div>' +
        (top.length
          ? top.map(([cat, n]) => catRow(cat, n)).join("")
          : '<div class="cempty">The photos in view have no visible categories.</div>'));
    } catch {
      if (token === catToken) showHtml('<div class="cempty">Couldn’t load categories.</div>');
    }
  }

  async function searchCategories(q) {
    const token = ++catToken;
    try {
      const data = await LOS.api.apiGET({ list: "prefixsearch", pssearch: q, psnamespace: "14", pslimit: "10" });
      if (token !== catToken) return;
      const hits = (data?.query?.prefixsearch || []).map((h) => h.title);
      await LOS.api.fetchCategoryInfo(hits);
      if (token !== catToken) return;
      showHtml('<div class="cathead">Matching categories</div>' +
        (hits.length
          ? hits.map((t) => catRow(t)).join("")
          : `<div class="cempty">No categories match “${U.escapeHtml(q)}”.</div>`));
    } catch {
      if (token === catToken) showHtml('<div class="cempty">Search failed.</div>');
    }
  }

  /** Drill-down view: the category's counts + "add all", and its subcategories
      (with counts) at the bottom for quickly pulling in their files too. */
  async function openCategoryView(cat) {
    const token = ++catToken;
    const A = LOS.api;
    if (!LOS.tray.isOpen()) LOS.tray.addToTray([]); // the list hosts this UI — open it
    showHtml(`<div class="cempty">Loading ${U.escapeHtml(A.catShort(cat))}…</div>`);
    try {
      const subsP = A.fetchSubcats(cat);
      await A.fetchCategoryInfo([cat]);
      const subs = await subsP;
      await A.fetchCategoryInfo(subs);
      if (token !== catToken) return;
      const info = A.catInfo(cat) || { files: 0, subcats: 0 };
      let html =
        `<div class="cathead cview"><button class="cback" title="Back">‹</button>` +
          `<span class="cname" title="${U.escapeHtml(A.catShort(cat))}">${U.escapeHtml(A.catShort(cat))}</span>` +
          `<span class="ccnt">${U.escapeHtml(A.catCounts(cat))}</span></div>` +
        `<div class="caddall"><button class="cadd-all" data-cat="${U.escapeHtml(cat)}">＋ Add all ${U.plural(info.files, "file")} to the list</button></div>`;
      if (subs.length) {
        html += '<div class="cathead">Subcategories</div>' + subs.map((s) => catRow(s)).join("");
      }
      showHtml(html);
    } catch {
      if (token === catToken) showHtml('<div class="cempty">Couldn’t load that category.</div>');
    }
  }

  async function addCategoryToTray(cat) {
    const A = LOS.api;
    LOS.status.set(`Loading files from ${A.catShort(cat)}…`, true);
    try {
      const res = await A.fetchCategoryFiles(cat);
      const urls = [];
      let noLoc = 0;
      for (const pg of res.pages) {
        if (!pg || !pg.title || pg.missing !== undefined) continue;
        const rec = LOS.store.addPhoto(pg);
        if (!rec) continue;
        urls.push(rec.url);
        if (!rec.cam && !rec.obj) noLoc++;
      }
      LOS.store.syncSources();
      const added = LOS.tray.addToTray(urls);
      LOS.status.set(
        `Added ${U.plural(added, "photo")} from ${A.catShort(cat)}` +
        (noLoc ? ` · ${noLoc} without a location` : "") +
        (urls.length > added ? ` · ${urls.length - added} already listed` : "") +
        (res.truncated ? ` · stopped at ${LOS.config.CAT_FILES_CAP}` : ""), false);
    } catch (err) {
      console.warn("Category load failed:", err);
      LOS.status.set(`Couldn't load files from ${A.catShort(cat)}`, false);
    }
  }

  function init() {
    $search.addEventListener("focus", () => {
      if (!$search.value.trim()) suggestInViewCategories();
    });
    $search.addEventListener("input", U.debounce(() => {
      const q = $search.value.trim();
      if (q) searchCategories(q);
      else suggestInViewCategories();
    }, 250));
    // Escape inside the box: the global key router skips inputs, so handle it here.
    $search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeResults(); $search.blur(); }
    });

    $results.addEventListener("click", (e) => {
      const addBtn = e.target.closest("button.cadd, button.cadd-all");
      if (addBtn) { addCategoryToTray(addBtn.getAttribute("data-cat")); return; }
      if (e.target.closest("button.cback")) {
        const q = $search.value.trim();
        if (q) searchCategories(q);
        else suggestInViewCategories();
        return;
      }
      const row = e.target.closest(".crow");
      if (row) openCategoryView(row.getAttribute("data-cat"));
    });

    // Click anywhere outside the category block → put the results away.
    document.addEventListener("click", (e) => {
      if (!isResultsOpen()) return;
      // A clicked results row may have just been re-rendered away (drill-down
      // replaces the panel's HTML synchronously) — a detached target can't be
      // matched against #tray-cats, and it was an inside click anyway.
      if (!e.target.isConnected) return;
      if (e.target.closest("#tray-cats")) return;
      closeResults();
    });
  }

  LOS.categories = { init, closeResults, isResultsOpen, openCategoryView };
})();
