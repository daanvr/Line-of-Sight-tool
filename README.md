# Line of Sight tool

Browse geotagged **Wikimedia Commons** photos on 3D terrain. Each photo with a known
camera **and** subject location is drawn as a small direction **cone** — the cone points
the way the photo faces, and its **width reflects how far the subject is**. Hover any
photo for an instant thumbnail; click to open it full-size with author, license, and an
"edit location" link to the Wikimedia Locator Tool.

**▶ Live: https://daanvr.github.io/Line-of-Sight-tool/**

It's a single self-contained `index.html` (no build step) using
[Mapbox GL JS](https://www.mapbox.com/mapbox-gljs) and the public Wikimedia Commons API.

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
- **Polygon select → Locator Tool** — lasso an area to open all enclosed photos for geolocating.
- **Shareable URL** — the map position lives in the URL hash (`#map=zoom/lat/lon/bearing/pitch`),
  so a reload (or a shared link) restores the exact view.

## Usage

Just open `index.html` in a browser, or visit the live link above. Pan/zoom to an area with
geotagged photos (it starts at the Roman ruins of Djémila, Algeria); zoom in to load nearby
photos from Commons.

> **Note:** the bundled Mapbox access token is a public demo token. Replace it near the top of
> `index.html` with your own ([free Mapbox account](https://account.mapbox.com/)) for your own
> deployment.

## Credits

Photos and metadata © their respective authors via
[Wikimedia Commons](https://commons.wikimedia.org/). Basemaps and terrain © Mapbox & OpenStreetMap.
