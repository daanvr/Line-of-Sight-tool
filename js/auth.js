/* Line of Sight tool — auth: Wikimedia OAuth 2.0 sign-in (authorization code + PKCE).

   A public (non-confidential) client: no secret, no backend, works from any
   static host. Sign-in opens meta.wikimedia.org's authorize page in a popup;
   callback.html bounces the code back (postMessage, with a localStorage
   hand-off as fallback) and the code is exchanged at meta's token endpoint,
   which allows CORS. The session lives in localStorage; access tokens (~4 h)
   are renewed with the rotating refresh token. A git-ignored
   oauth_config.local.js with window.LOS_OAUTH = { accessToken } still wins
   as a zero-setup dev override; { clientId } there overrides the registered
   client (for a localhost-callback dev consumer). */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const C = LOS.config;

  const OVERRIDE = window.LOS_OAUTH?.accessToken || null;
  const CLIENT_ID = window.LOS_OAUTH?.clientId || C.OAUTH_CLIENT_ID;
  const SESSION_KEY = "los-oauth-session";
  const PKCE_KEY = "los-oauth-pkce"; // sessionStorage: { verifier, state, ret }

  let session = null;    // { access, refresh, expires }  (expires = epoch ms)
  let refreshing = null; // in-flight refresh promise, shared by callers
  let pending = null;    // { promise, resolve, popup, timer } while signing in
  let username = null;   // display only — fetched after sign-in

  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { session = null; }

  function storeSession(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  // ---- PKCE --------------------------------------------------------------------
  const b64url = (bytes) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function pkcePair() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)) };
  }

  const redirectUri = () => new URL("callback.html", location.href).href;

  // ---- Sign-in (popup; full-page redirect when the popup is blocked) -------------
  function login() {
    if (OVERRIDE) return Promise.resolve(true);
    if (!CLIENT_ID) {
      LOS.status.set("No OAuth client configured — see README, “Editing setup”", false);
      return Promise.resolve(false);
    }
    if (pending) { try { pending.popup?.focus(); } catch { /* gone */ } return pending.promise; }

    // The blank popup must open synchronously inside the user's click —
    // opening it after an await would trip popup blockers.
    const popup = window.open("", "los-oauth", "width=520,height=720");
    let resolve;
    const promise = new Promise((res) => (resolve = res));
    pending = { promise, resolve, popup, timer: null };

    (async () => {
      const { verifier, challenge } = await pkcePair();
      const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
      // Stashed in sessionStorage: the popup inherits a copy, so whichever
      // window ends up doing the exchange has the verifier.
      const ret = location.pathname + location.search + location.hash;
      sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, ret }));
      const url = `${C.OAUTH_AUTHORIZE}?${new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: redirectUri(),
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`;
      if (popup) {
        popup.location = url;
        pending.timer = setInterval(() => {
          if (!popup.closed) return;
          clearInterval(pending.timer);
          // Grace period: the callback's message/storage event may still be
          // in flight when the popup closes itself.
          setTimeout(() => settleLogin(false), 2000);
        }, 500);
      } else {
        location.assign(url); // popup blocked — come back via callback.html
      }
    })();
    return promise;
  }

  function settleLogin(ok) {
    if (!pending) return;
    clearInterval(pending.timer);
    if (ok) try { pending.popup?.close(); } catch { /* already closed */ }
    const resolve = pending.resolve;
    pending = null;
    resolve(ok);
  }

  // ---- Token exchange & refresh ---------------------------------------------------
  async function tokenRequest(params) {
    const r = await fetch(C.OAUTH_TOKEN, { method: "POST", body: new URLSearchParams(params) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) {
      throw new Error(j?.error_description || j?.error || `token request failed (HTTP ${r.status})`);
    }
    storeSession({
      access: j.access_token,
      refresh: j.refresh_token || session?.refresh || null,
      // Renew 5 min early so a token never expires mid-save.
      expires: Date.now() + Math.max(60, (j.expires_in || 14400) - 300) * 1000,
    });
    return session.access;
  }

  async function exchangeCode(code, state) {
    let stash = null;
    try { stash = JSON.parse(sessionStorage.getItem(PKCE_KEY) || "null"); } catch { /* fall through */ }
    if (!stash || stash.state !== state) throw new Error("state mismatch — try signing in again");
    sessionStorage.removeItem(PKCE_KEY);
    await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      code_verifier: stash.verifier,
    });
    return stash;
  }

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        return await tokenRequest({
          grant_type: "refresh_token",
          refresh_token: session.refresh,
          client_id: CLIENT_ID,
        });
      } catch (err) {
        console.warn("OAuth refresh failed:", err);
        storeSession(null);
        username = null;
        LOS.edit?.updateEditUI();
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** A currently-valid access token, renewing if needed; null = signed out. */
  async function getToken() {
    if (OVERRIDE) return OVERRIDE;
    if (!session) return null;
    if (Date.now() < session.expires) return session.access;
    if (!session.refresh) { storeSession(null); return null; }
    return refresh();
  }

  // ---- Who am I — display only, for the sign-out button ----------------------------
  async function fetchUsername() {
    const token = await getToken();
    if (!token) return;
    try {
      const r = await fetch(`${C.COMMONS_API}?crossorigin=&action=query&meta=userinfo&format=json`, {
        headers: { "Authorization": `Bearer ${token}`, "Api-User-Agent": C.USER_AGENT },
      });
      const j = await r.json();
      if (j.query?.userinfo && !("anon" in j.query.userinfo)) username = j.query.userinfo.name;
    } catch { /* cosmetic only */ }
    LOS.edit?.updateEditUI();
  }

  function onAuthed() {
    settleLogin(true);
    LOS.edit?.updateEditUI();
    fetchUsername();
  }

  // ---- Wiring ----------------------------------------------------------------------
  function init() {
    // Popup route: callback.html posts the code back to this window.
    window.addEventListener("message", async (ev) => {
      if (ev.origin !== location.origin || !ev.data || typeof ev.data !== "object") return;
      if (ev.data.type === "los-oauth-error") {
        settleLogin(false);
        LOS.status.set(`Sign-in failed — ${ev.data.message}`, false);
        return;
      }
      if (ev.data.type !== "los-oauth") return;
      try {
        await exchangeCode(ev.data.code, ev.data.state);
        onAuthed();
        LOS.status.set("Signed in to Commons ✓", false);
      } catch (err) {
        settleLogin(false);
        LOS.status.set(`Sign-in failed — ${err.message}`, false);
      }
    });

    // Fallback route: another window (a popup whose opener link was severed,
    // or another tab) finished the exchange — the session appears in the
    // shared localStorage.
    window.addEventListener("storage", (ev) => {
      if (ev.key !== SESSION_KEY || !ev.newValue) return;
      try { session = JSON.parse(ev.newValue); } catch { return; }
      onAuthed();
    });

    // Full-redirect route: back from callback.html with ?code=&state=.
    const qs = new URLSearchParams(location.search);
    if (qs.get("code") && qs.get("state") && sessionStorage.getItem(PKCE_KEY)) {
      exchangeCode(qs.get("code"), qs.get("state"))
        .then((stash) => {
          // Reload the pre-sign-in URL so ?file= deep links get another go.
          location.replace(stash.ret && stash.ret !== location.pathname ? stash.ret : "./");
        })
        .catch((err) => LOS.status.set(`Sign-in failed — ${err.message}`, false));
    }

    document.getElementById("auth-btn")?.addEventListener("click", () => {
      storeSession(null);
      username = null;
      LOS.edit?.updateEditUI();
      LOS.status.set("Signed out of Commons", false);
    });

    if (session || OVERRIDE) fetchUsername();
  }

  LOS.auth = {
    init, login, getToken,
    hasSession: () => !!(OVERRIDE || session),
    username: () => username,
    isOverride: () => !!OVERRIDE,
  };
})();
