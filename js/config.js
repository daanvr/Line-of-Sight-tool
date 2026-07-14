/* Line of Sight tool — config: constants and user-adjustable settings.
   `LOS.config` is frozen; `LOS.settings` is the mutable, persisted state that
   the panel edits (layer appearance, filters, basemap, terrain). */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});

  LOS.config = Object.freeze({
    // Public demo token (from the original prototype). Replace if it expires.
    MAPBOX_TOKEN:
      "pk.eyJ1IjoiZ291ZGFwcGVsIiwiYSI6ImNqeXprc3phbjAybTEzZGxqZzR1OHZqOWEifQ.jRzPHdAKKUmyL72_8-2glw",

    COMMONS_API: "https://commons.wikimedia.org/w/api.php",
    // Sent as Api-User-Agent on authenticated Commons calls (WMF UA policy).
    USER_AGENT: "LineOfSightTool/0.1 (https://daanvr.github.io/Line-of-Sight-tool/)",

    // OAuth 2.0 sign-in — a public PKCE client registered on Meta-Wiki (see
    // README, "Editing setup"). Paste the client ID from the registration
    // here; while it's empty the Save button explains how to set it up.
    OAUTH_CLIENT_ID: "1e13c6dd6a67bf4b1011a02243484396",
    OAUTH_AUTHORIZE: "https://meta.wikimedia.org/w/rest.php/oauth2/authorize",
    OAUTH_TOKEN: "https://meta.wikimedia.org/w/rest.php/oauth2/access_token",
    FILEPATH: "https://commons.wikimedia.org/wiki/Special:FilePath/",
    LOCATOR: "https://locator-tool.toolforge.org/#/geolocate?files=",
    // MediaWiki REST API on Commons: unlike action=api.php it accepts CORS
    // requests with an Authorization header (GET + PUT), so the browser can
    // save edits directly. (api.wikimedia.org's core/v1 proxy 301s into a
    // CORS-less redirect chain, so it can't be used from a browser.)
    REST_API: "https://commons.wikimedia.org/w/rest.php/v1/page/",
    // Public home of this tool — edit summaries deep-link back here so anyone
    // reading a file's history can reopen the exact line of sight that was set.
    TOOL_URL: "https://daanvr.github.io/Line-of-Sight-tool/",

    EDIT_COLOR: "#ff4d94",   // unsaved location edits (matches --edit in CSS)
    DIM: 0.1,                // opacity of non-hovered features
    MAX_PHOTOS: 1000,        // cap; oldest photos are evicted past this
    LEN_MAX: 3000,           // upper bound (m) of the line-of-sight length filter
    CAT_FILES_CAP: 1000,     // bound one category add (with a status note)

    // Thumbnail widths must come from Wikimedia's allowed ladder (anything
    // else is rejected with a 400 — see https://w.wiki/GHai): the sizes below
    // were verified live. 500 is exactly what ?width=400 used to be rounded up
    // to server-side, so these URLs share the CDN cache with every other client.
    THUMB_W: Object.freeze({ tray: 250, preview: 500, modal: 1920 }),

    BASEMAPS: Object.freeze([
      { id: "satellite-streets-v12", name: "Satellite" },
      { id: "outdoors-v12",          name: "Outdoors (terrain)" },
      { id: "streets-v12",           name: "Streets" },
      { id: "dark-v11",              name: "Dark" },
    ]),

    // Right-click destinations. Each builds a URL from (lat, lon, zoom, bearing).
    MAP_SERVICES: Object.freeze([
      { name: "Google Maps",        url: (la, lo, z)    => `https://www.google.com/maps/@${la},${lo},${Math.round(z)}z` },
      { name: "Google Street View", url: (la, lo, z, b) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${la},${lo}&heading=${Math.round(((b % 360) + 360) % 360)}` },
      { name: "Google Earth",       url: (la, lo, z, b) => `https://earth.google.com/web/@${la},${lo},0a,1500d,35y,${Math.round(((b % 360) + 360) % 360)}h,60t,0r` },
      { name: "Apple Maps",         url: (la, lo, z)    => `https://maps.apple.com/?ll=${la},${lo}&z=${Math.round(z)}&t=h` },
      { name: "Yandex Maps",        url: (la, lo, z)    => `https://yandex.com/maps/?ll=${lo}%2C${la}&z=${Math.round(z)}` },
      { name: "OpenStreetMap",      url: (la, lo, z)    => `https://www.openstreetmap.org/#map=${Math.round(z)}/${la}/${lo}` },
      { name: "WikiShootMe",        url: (la, lo, z)    => `https://wikishootme.toolforge.org/#lat=${la}&lng=${lo}&zoom=${Math.round(z)}` },
      { name: "Mapillary",          url: (la, lo, z)    => `https://www.mapillary.com/app/?lat=${la}&lng=${lo}&z=${Math.round(z)}` },
      { name: "Strava heatmap",     url: (la, lo, z)    => `https://www.strava.com/maps/global-heatmap#${Math.round(z)}/${lo}/${la}` },
      { name: "Bing Maps",          url: (la, lo, z)    => `https://www.bing.com/maps?cp=${la}~${lo}&lvl=${Math.round(z)}&style=h` },
    ]),
  });

  // Mutable user settings — hydrated from localStorage by persist.load()
  // before the map and panel are built, then edited live by the panel.
  LOS.settings = {
    // Configurable appearance (single source of truth for every map layer).
    layers: {
      cones:   { visible: true,  color: "#9ec9ff", opacity: 0.18, pxSize: 26, ramp: true },
      lines:   { visible: false, color: "#34d6f2", opacity: 0.85, width: 2 }, // OFF by default; the cone carries direction + distance
      objects: { visible: true,  color: "#ffb454", opacity: 0.9,  size: 5 },
      cameras: { visible: true,  color: "#ffffff", opacity: 0.5,  size: 7 },
    },
    filters: { minLen: 0, maxLen: 3000, los: "all", bearMin: 0, bearMax: 360 },
    basemap: "satellite-streets-v12",
    terrain: true,
  };
})();
