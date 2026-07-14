# Line of Sight tool

Browse geotagged **Wikimedia Commons** photos on 3D terrain. Each photo with a known
camera **and** subject location is drawn as a small direction **cone** — the cone points
the way the photo faces, and its **width reflects how far the subject is**. Hover any
photo for an instant thumbnail; click to open it full-size with author, license, and an
"edit location" link to the Wikimedia Locator Tool.

**▶ Live: https://daanvr.github.io/Line-of-Sight-tool/**

It's a static page (no build step) using
[Mapbox GL JS](https://www.mapbox.com/mapbox-gljs) and the public Wikimedia Commons API:
`index.html` plus `css/app.css` and small plain-JS modules under `js/`, loaded as
classic scripts so opening the file directly (no server) still works.

## Features

- **3D terrain** with satellite / outdoors / streets / dark basemaps and a terrain toggle.
- **Direction cones** that stay a constant on-screen size (so they declutter as you zoom in),
  with the cone width and an optional white→blue colour ramp encoding camera→subject distance.
- **Filters** — line-of-sight length (min/max), has / no line of sight, and facing direction
  (with wrap-around through North).
- **Configurable layers** — per-layer visibility, colour, size, and opacity for cones, the
  line of sight, subjects, and cameras.
- **Hover thumbnails** in the bottom-right that never flash the wrong image.
- **Right-click any spot** to open it in Google Maps, Street View, Google Earth, Apple Maps,
  Yandex, OpenStreetMap, WikiShootMe, Mapillary, the Strava heatmap, or Bing.
  **Right-click a photo** instead for photo actions: open it, place its camera/subject,
  hide it from the list, undo its individual edits, or browse its categories (with file
  and subcategory counts) to pull more photos into the list.
- **Photo list (tray)** — filled by lassoing an area, by a `?files=` link, from a category
  search, or via right-click → "Add to the photo list". Hover a row for the big preview,
  click to select, ↑/↓ (or `W`/`S`) to walk the list. Hide distracting photos with the ✕ on a
  row (or right-click the row); the 👁 button shows the hidden ones and restores them one by
  one or all at once (hiding is list-only — the map markers stay, and it persists).
- **Category search** — the box at the top of the list suggests the categories of the photos
  currently in view (most-used first, always with `N files · M subcats` counts), supports
  prefix search of all Commons categories, and drills into subcategories; one click adds a
  whole category's files to the list — **including files with no location yet**, ready to be
  placed on the map.
- **Polygon select → Locator Tool** — lasso an area to open all enclosed photos for geolocating.
- **Shareable URL** — the map position lives in the URL hash (`#map=zoom/lat/lon/bearing/pitch`),
  and `?files=File:A.jpg|B_with_underscores.jpg|M12345` (pipe-separated titles, Locator-tool
  style names, or MediaInfo M-ids) preloads those photos into the list; a single-file link
  auto-fits its whole line of sight. A `#map=` view in the link always wins over auto-zoom.
- **Remembers your session** — all panel settings (layers, filters, basemap, terrain), the
  collapsed/open state, the search box, the open photo, hidden photos, and the map view are
  saved in your browser, so a reload brings the page back exactly as you left it.
- **Edit mode (experimental)** — press `⇧E` (or the ✎ buttons) and drag any camera or subject
  point to move it; **double-click** a photo's lone dot (or use the "＋ Add … location here"
  button in its viewer) to place the missing camera/subject location. With a photo selected,
  `C`/`Q` place its camera and `O`/`E` its subject by clicking the map (edit mode turns on by
  itself). Edits stack up in an iD-style undo/redo counter with a list (hover an entry to
  highlight it on the map, click to fly there — an edge arrow with the distance points the way
  when it's off-screen, ↩ to undo just that one), every unsaved change is drawn in pink with a
  dashed line from the original spot, the Save button gets louder as unsaved edits pile up, and
  closing the tab with unsaved edits asks for confirmation. Saving updates **both** the wikitext
  templates (`{{Location dec}}` / `{{Object location dec}}`, via the MediaWiki REST API) **and**
  the structured data statements (SDC `P1259` point of view / `P9149` depicted place, via the
  action API) with an OAuth token. Edit summaries say what changed and how far (e.g.
  `Move camera position 38 m — via Line of Sight tool | <deep link>`) and carry a deep link
  that reopens the tool zoomed to that photo's line of sight.

## Keyboard

| Key | Action |
| --- | --- |
| `H` (hold) | Flip to the other view while held — see the map behind an open photo, or the last photo over the map. Releasing returns to where you were. |
| `Space` | Toggle between the map and the last opened photo. |
| `↑`/`↓` or `W`/`S` | Walk the photo list (shows each photo's preview). Also works while a photo is open big — the big image follows. |
| `C` or `Q` | Place/move the **camera** location of the selected photo by clicking the map. |
| `O` or `E` | Place/move the **object** (subject) location of the selected photo. |
| `A` / `D` | Undo / redo (also `⌘Z` / `⇧⌘Z`). |
| `⇧E` | Toggle edit mode manually. |
| `Esc` | Cancel placing / selection / menus / viewer / deselect photo / list, in that order. After deselecting, `↑`/`↓` resume where the selection was. |

## Editing setup

Saving runs a standard OAuth 2.0 **authorization-code + PKCE** flow entirely in the browser
(Meta-Wiki's token endpoint allows CORS), so the tool stays a plain static site — GitHub
Pages is all it takes. Users click **Sign in to save**, approve the app on Meta-Wiki in a
popup, and the tool keeps the session in `localStorage`, refreshing the ~4-hour access
tokens automatically.

One-time client registration (needs a Wikimedia account with a confirmed email):

1. Open [Special:OAuthConsumerRegistration/propose/oauth2](https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2)
   on Meta-Wiki.
2. Fill in:
   - **Application name** — `Line of Sight tool` (users see this on the consent screen).
   - **OAuth "callback" URL** — `https://daanvr.github.io/Line-of-Sight-tool/callback.html`
     (must match exactly; leave *"Allow consumer to specify a callback"* unchecked).
   - **Untick "This is a confidential client"** — a browser can't keep a secret; this makes
     it a public PKCE client, which is what `js/auth.js` implements.
   - Leave *"for use only by [you]"* **unchecked** so other people can sign in too.
   - **Grants** — *"Request authorization for specific permissions"* → tick
     **Edit existing pages** only (both the wikitext and SDC edits are edits to existing
     file pages).
3. Submit, then paste the **client ID** into `OAUTH_CLIENT_ID` in `js/config.js`
   (ignore the client secret — public clients don't use it).

A freshly proposed consumer works **immediately for its owner** — you can test the full
flow right away. Other accounts can only sign in after an OAuth administrator approves the
consumer (it lands in [the approval queue](https://meta.wikimedia.org/wiki/Special:OAuthManageConsumers);
usually a few days).

Both wikitext and structured-data (SDC) updates work from any origin — the SDC calls go
through the action API with the `crossorigin=` parameter, which since MediaWiki 1.44 keeps
OAuth Bearer requests authenticated cross-origin.

### Local development

The sign-in popup needs the exact registered callback, so on `localhost` either:

- create a git-ignored `oauth_config.local.js` with a personal access token (from an
  owner-only OAuth 2 consumer) — this skips the sign-in flow entirely:

  ```js
  window.LOS_OAUTH = { accessToken: "…your OAuth2 access token…" };
  ```

- or register a second (dev) consumer with callback `http://localhost:8000/callback.html`
  and point the same file at it: `window.LOS_OAUTH = { clientId: "…dev client id…" };`

Any static server does:

```sh
python3 serve.py          # → http://localhost:8000/
```

## Usage

Just open `index.html` in a browser, or visit the live link above. Pan/zoom to an area with
geotagged photos (it starts at the Roman ruins of Djémila, Algeria); zoom in to load nearby
photos from Commons.

> **Note:** the bundled Mapbox access token is a public demo token. Replace `MAPBOX_TOKEN` in
> `js/config.js` with your own ([free Mapbox account](https://account.mapbox.com/)) for your own
> deployment.

## Code layout

Everything is plain JS — no build step, no dependencies beyond the two Mapbox CDN scripts.
Each file under `js/` owns one concern and exposes it on the `LOS` namespace; `js/main.js`
runs the boot sequence (restore persisted state → create the map → wire the modules →
preload any `?files=` photos).

| File | Owns |
| --- | --- |
| `js/util.js` | pure helpers: geometry, formatting, HTML escaping/sanitising, debounce |
| `js/config.js` | constants (`LOS.config`) and persisted user settings (`LOS.settings`) |
| `js/status.js` | the status pill |
| `js/images.js` | direct Commons thumb URLs (md5 path) + the in-session image cache |
| `js/api.js` | anonymous Commons API reads: attribution, categories (cached) |
| `js/store.js` | photo records, their GeoJSON features, geosearch loading, eviction |
| `js/persist.js` | localStorage state + the `#map=` URL hash |
| `js/map.js` | the Mapbox map: layers, styling, filters, cones, hover/dim, event routing |
| `js/panel.js` | the layers · filters · basemap panel |
| `js/viewer.js` | hover preview + full-size modal + H-key peek |
| `js/tray.js` | the photo list: selection, hidden photos, thumbnails |
| `js/categories.js` | the category search box (suggest / search / drill-down / add) |
| `js/select.js` | polygon selection |
| `js/edit.js` | edit mode: drag, click-to-place, undo/redo, overlay, edit list |
| `js/auth.js` | Wikimedia OAuth 2.0 sign-in (PKCE popup flow, token refresh) |
| `js/save.js` | writing to Commons: wikitext templates, SDC statements, retry |
| `js/ctxmenu.js` | the right-click menus |
| `js/keys.js` | the global keyboard router |

## Credits

Photos and metadata © their respective authors via
[Wikimedia Commons](https://commons.wikimedia.org/). Basemaps and terrain © Mapbox & OpenStreetMap.
