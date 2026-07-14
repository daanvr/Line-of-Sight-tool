/* Line of Sight tool — save: writing location edits back to Commons.

   Wikitext templates ({{Location dec}} / {{Object location dec}}) are updated
   through the MediaWiki REST API (CORS-friendly with a Bearer token). The
   structured-data (SDC) statements — P1259 point of view / P9149 depicted
   place — go through the action API with `crossorigin=` in the URL, which
   (since MediaWiki 1.44) lets OAuth Bearer requests stay authenticated
   cross-origin. So both work from anywhere the page is hosted, GitHub Pages
   included.
   Also owns the failed-save retry (auto backoff: 3s → 10s → 30s → manual). */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const C = LOS.config;
  const U = LOS.util;

  let saving = false;

  // ---- Failed-save retry --------------------------------------------------------
  const RETRY_DELAYS = [3, 10, 30];
  let saveFailed = false, retryAttempt = 0, retryTimer = null, retryCountdown = 0;

  const $editbar = document.getElementById("editbar");
  const $retryBtn = document.getElementById("retry-btn");

  function clearRetryTimer() {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    retryCountdown = 0;
  }
  function updateRetryUI() {
    $editbar.classList.toggle("failed", saveFailed);
    if (saveFailed) $retryBtn.textContent = retryCountdown > 0 ? `Retry in ${retryCountdown}s` : "Try again";
  }
  function onSaveFailure() {
    saveFailed = true;
    const delay = RETRY_DELAYS[retryAttempt]; // past the schedule → manual only
    retryAttempt++;
    if (delay) {
      retryCountdown = delay;
      retryTimer = setInterval(() => {
        retryCountdown--;
        if (retryCountdown <= 0) { clearRetryTimer(); saveEdits(); }
        else updateRetryUI();
      }, 1000);
    }
    updateRetryUI();
  }
  function onSaveSuccess() {
    saveFailed = false;
    retryAttempt = 0;
    clearRetryTimer();
    updateRetryUI();
  }

  // ---- Wikitext: rewrite the location templates -----------------------------------
  const normTpl = (s) => s.replace(/[_\s]+/g, " ").trim().toLowerCase();
  const CAMERA_TPLS = ["location", "location dec", "location dms", "camera location", "camera location dec"];
  const OBJECT_TPLS = ["object location", "object location dec", "object location dms"];

  /** Find a brace-balanced {{name|…}} whose name is one of `names`. */
  function findTemplate(text, names) {
    const want = new Set(names);
    let i = 0;
    while ((i = text.indexOf("{{", i)) !== -1) {
      let j = i + 2, depth = 1, nameEnd = -1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{" && text[j + 1] === "{") { depth++; j += 2; continue; }
        if (text[j] === "}" && text[j + 1] === "}") { depth--; j += 2; continue; }
        if (depth === 1 && nameEnd === -1 && text[j] === "|") nameEnd = j;
        j++;
      }
      if (depth !== 0) return null; // unbalanced wikitext — give up
      const name = normTpl(text.slice(i + 2, nameEnd === -1 ? j - 2 : nameEnd));
      if (want.has(name)) return { start: i, end: j, inner: text.slice(i + 2, j - 2) };
      i += 2;
    }
    return null;
  }

  function locTemplate(kind, pos, oldInner) {
    let extra = "";
    if (oldInner) { // keep a heading:… if there was one
      const m = /heading\s*[:=]\s*([^|{}\s]+)/i.exec(oldInner);
      if (m) extra = `|heading:${m[1]}`;
    }
    return `{{${kind === "camera" ? "Location dec" : "Object location dec"}|${pos[1].toFixed(6)}|${pos[0].toFixed(6)}${extra}}}`;
  }

  /** Replace (or insert) the camera/object location template; returns new text. */
  function applyLocToWikitext(text, kind, pos) {
    const found = findTemplate(text, kind === "camera" ? CAMERA_TPLS : OBJECT_TPLS);
    const tpl = locTemplate(kind, pos, found && found.inner);
    if (found) return text.slice(0, found.start) + tpl + text.slice(found.end);
    // Not present yet: sit next to the sibling location template if there is
    // one, else go before the first category, else at the very end.
    const sibling = findTemplate(text, kind === "camera" ? OBJECT_TPLS : CAMERA_TPLS);
    if (sibling) {
      return kind === "camera"
        ? text.slice(0, sibling.start) + tpl + "\n" + text.slice(sibling.start)
        : text.slice(0, sibling.end) + "\n" + tpl + text.slice(sibling.end);
    }
    const cat = text.search(/\[\[\s*category\s*:/i);
    if (cat !== -1) return text.slice(0, cat) + tpl + "\n" + text.slice(cat);
    return text.replace(/\s*$/, "") + "\n" + tpl + "\n";
  }

  // ---- Edit summaries ----------------------------------------------------------------
  /** Deep link that reopens this tool with the photo loaded, selected, and the
      map fitted to its full line of sight (camera + object) — see the URL
      preload in main.js. The M-id form keeps summaries short (file names can
      be hundreds of percent-encoded bytes) and survives file renames; the
      filename form is the fallback for the rare record without a pageId. */
  function deepLink(rec) {
    const target = rec.pageId
      ? `M${rec.pageId}`
      : encodeURIComponent(String(rec.title).replace(/^File:/, "").replace(/ /g, "_"));
    return `${C.TOOL_URL}?file=${target}`;
  }

  /** Human-readable per-edit description for the summary: what changed and by
      how far ("Move camera position 38 m" / "Add object position"). */
  function describeEdit(kind, from, to) {
    const noun = kind === "camera" ? "camera position" : "object position";
    return from
      ? `Move ${noun} ${U.fmtDist(U.distance(from[0], from[1], to[0], to[1]))}`
      : `Add ${noun}`;
  }

  function editSummary(descs, rec) {
    // External URLs can't render as links in edit summaries (only wikilinks
    // and interwiki prefixes do), but the deep link stays copyable and
    // machine-parsable. No "via …" attribution: the OAuth consumer already
    // tags every edit with the tool's name.
    return `${descs.join("; ")} — ${deepLink(rec)}`;
  }

  // ---- Saving one photo (wikitext via the Core REST API) -------------------------------
  async function savePhotoEdits(rec, token) {
    const endpoint = C.REST_API + encodeURIComponent(rec.title);
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Api-User-Agent": C.USER_AGENT,
    };
    const g = await fetch(endpoint, { headers });
    if (!g.ok) throw new Error(`couldn't fetch wikitext (HTTP ${g.status})`);
    const page = await g.json();
    let text = page.source;
    const parts = [], descs = [];
    if (LOS.store.posChanged(rec.cam, rec.origCam)) {
      text = applyLocToWikitext(text, "camera", rec.cam);
      parts.push("camera");
      descs.push(describeEdit("camera", rec.origCam, rec.cam));
    }
    if (LOS.store.posChanged(rec.obj, rec.origObj)) {
      text = applyLocToWikitext(text, "object", rec.obj);
      parts.push("object");
      descs.push(describeEdit("object", rec.origObj, rec.obj));
    }
    if (!parts.length) return;
    const r = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        source: text,
        comment: editSummary(descs, rec),
        latest: { id: page.latest.id },
      }),
    });
    if (!r.ok) {
      let msg = `save failed (HTTP ${r.status})`;
      try {
        const err = await r.json();
        if (err && err.message) msg = err.message;
      } catch { /* non-JSON error body */ }
      throw new Error(msg);
    }
    // Keep the structured data (SDC) in sync with the wikitext templates.
    if (rec.pageId) await saveSDCEdits(rec, token, parts);
  }

  // ---- Structured data (SDC) — action API, authenticated CORS ---------------------------
  // `origin=*` anonymizes requests, but `crossorigin=` (MediaWiki 1.44+) keeps
  // header-based auth like our OAuth Bearer token. It must sit in the URL's
  // query string — not the POST body — so the CORS preflight sees it.
  const SDC_API = C.COMMONS_API + "?crossorigin=";
  const SDC_CAMERA_PROP = "P1259"; // coordinates of the point of view
  const SDC_OBJECT_PROP = "P9149"; // coordinates of depicted place
  const SDC_GLOBE = "http://www.wikidata.org/entity/Q2";

  async function sdcCall(params, token) {
    const opts = { headers: { "Authorization": `Bearer ${token}`, "Api-User-Agent": C.USER_AGENT } };
    let url = SDC_API;
    if (params instanceof URLSearchParams) { opts.method = "POST"; opts.body = params; }
    else url += `&${params}`;
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`SDC request failed (HTTP ${r.status})`);
    const j = await r.json();
    if (j.error) throw new Error(`SDC: ${j.error.info || j.error.code}`);
    return j;
  }

  async function saveSDCEdits(rec, token, parts) {
    const mid = `M${rec.pageId}`;
    const eJ = await sdcCall(`action=wbgetentities&ids=${mid}&props=claims&format=json`, token);
    const ent = eJ.entities && eJ.entities[mid];
    let statements = (ent && (ent.statements || ent.claims)) || {};
    if (Array.isArray(statements)) statements = {}; // empty SDC serializes as []

    const tJ = await sdcCall("action=query&meta=tokens&type=csrf&format=json", token);
    const csrf = tJ.query?.tokens?.csrftoken;
    if (!csrf || csrf === "+\\") throw new Error("SDC: no CSRF token (OAuth session not accepted)");

    for (const kind of parts) {
      const prop = kind === "camera" ? SDC_CAMERA_PROP : SDC_OBJECT_PROP;
      const pos = kind === "camera" ? rec.cam : rec.obj;
      const coord = {
        latitude: +pos[1].toFixed(6),
        longitude: +pos[0].toFixed(6),
        altitude: null,
        precision: 1e-6,
        globe: SDC_GLOBE,
      };
      const existing = statements[prop] && statements[prop][0];
      // The software auto-prepends "Changed/Created claim: <property>: <value>"
      // to SDC summaries and the OAuth consumer tag names the tool, so all
      // the summary adds is the moved distance and the deep link.
      const oldVal = existing?.mainsnak?.datavalue?.value;
      let summary = existing ? "Moved" : "Added";
      if (oldVal && isFinite(oldVal.latitude) && isFinite(oldVal.longitude)) {
        summary += ` ${U.fmtDist(U.distance(oldVal.longitude, oldVal.latitude, pos[0], pos[1]))}`;
      }
      summary += ` — ${deepLink(rec)}`;
      const body = new URLSearchParams({ format: "json", token: csrf, maxlag: "5", summary });
      if (existing) {
        // Replace only the coordinate value; keep id/qualifiers/references.
        const claim = JSON.parse(JSON.stringify(existing));
        delete claim.mainsnak.hash;
        claim.mainsnak.snaktype = "value";
        const old = claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
        if (old && old.precision) coord.precision = old.precision;
        claim.mainsnak.datavalue = { type: "globecoordinate", value: coord };
        body.set("action", "wbsetclaim");
        body.set("claim", JSON.stringify(claim));
      } else {
        body.set("action", "wbcreateclaim");
        body.set("entity", mid);
        body.set("property", prop);
        body.set("snaktype", "value");
        body.set("value", JSON.stringify(coord));
      }
      await sdcCall(body, token);
    }
  }

  // ---- The Save button ------------------------------------------------------------------
  async function saveEdits() {
    if (saving) return;
    // Not signed in → run the OAuth flow first (login() opens its popup
    // synchronously, so calling it straight from the click keeps blockers
    // happy). A successful sign-in falls through into the save.
    if (!LOS.auth.hasSession()) {
      const ok = await LOS.auth.login();
      if (!ok) return;
    }
    const token = await LOS.auth.getToken();
    if (!token) {
      LOS.status.set("Sign-in expired — click Save to sign in again", false);
      LOS.edit.updateEditUI();
      return;
    }
    const dirty = LOS.store.dirtyRecs();
    if (!dirty.length) return;
    clearRetryTimer(); // a manual save supersedes any countdown
    saving = true;
    LOS.edit.updateEditUI();
    const savedUrls = new Set(), failures = [];
    for (let i = 0; i < dirty.length; i++) {
      const rec = dirty[i];
      LOS.status.set(`Saving ${i + 1}/${dirty.length} — ${U.prettyTitle(rec.title)}`, true);
      try {
        await savePhotoEdits(rec, token);
        rec.origCam = rec.cam && rec.cam.slice(); // saved: this is the new baseline
        rec.origObj = rec.obj && rec.obj.slice();
        LOS.store.rebuildPhotoFeatures(rec);      // drop the edited flag → filters apply again
        savedUrls.add(rec.url);
      } catch (err) {
        failures.push(`${U.prettyTitle(rec.title)}: ${err.message}`);
      }
    }
    // Saved photos leave the undo stack; failed ones keep their edits.
    LOS.edit.dropEditsFor(savedUrls);
    saving = false;
    LOS.edit.renderOverlay();
    LOS.edit.updateEditUI();
    if (failures.length) {
      onSaveFailure();
      LOS.status.set(
        `Save failed for ${U.plural(failures.length, "photo")}` +
        (savedUrls.size ? ` (${savedUrls.size} saved)` : "") +
        ` — ${failures[0]}`, false);
      console.warn("Save failures:", failures);
    } else {
      onSaveSuccess();
      LOS.status.set(`Saved ${U.plural(savedUrls.size, "photo")} (wikitext + SDC) ✓`, false);
    }
  }

  function init() {
    document.getElementById("save-btn").addEventListener("click", saveEdits);
    $retryBtn.addEventListener("click", () => { clearRetryTimer(); saveEdits(); });
  }

  LOS.save = {
    init, saveEdits,
    isSaving: () => saving,
    hasToken: () => LOS.auth.hasSession(),
    isFailed: () => saveFailed,
    clearFailure: onSaveSuccess,
    updateRetryUI,
  };
})();
