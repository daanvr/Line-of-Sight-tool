/* Line of Sight tool — panel: the collapsible layers/filters/basemap panel,
   built from LOS.settings and kept in sync with the map through mapView. */
(function () {
  "use strict";
  const LOS = (window.LOS = window.LOS || {});
  const U = LOS.util;

  const $panel = document.getElementById("panel");

  function filtersHtml() {
    const F = LOS.settings.filters;
    const LEN_MAX = LOS.config.LEN_MAX;
    const losBtn = (v, label) =>
      `<button data-los="${v}"${F.los === v ? ' class="on"' : ""}>${label}</button>`;
    return '<div class="sect"><div class="lbl">Filters</div>' +
      `<div class="frow"><span class="k">Length ≥</span><input type="range" id="f-minlen" min="0" max="${LEN_MAX}" step="10" value="${F.minLen}"><span class="v" id="f-minlen-v">${Math.round(F.minLen)} m</span></div>` +
      `<div class="frow"><span class="k">Length ≤</span><input type="range" id="f-maxlen" min="0" max="${LEN_MAX}" step="10" value="${F.maxLen}"><span class="v" id="f-maxlen-v">${F.maxLen >= LEN_MAX ? "∞" : `${Math.round(F.maxLen)} m`}</span></div>` +
      `<div class="row"><span class="k">Sight</span><div class="seg" id="los-seg">` +
        losBtn("all", "Any") + losBtn("los", "Has") + losBtn("nolos", "None") +
      "</div></div>" +
      `<div class="frow"><span class="k">Facing ≥</span><input type="range" id="f-bmin" min="0" max="360" step="5" value="${F.bearMin}"><span class="v" id="f-bmin-v">${Math.round(F.bearMin)}°</span></div>` +
      `<div class="frow"><span class="k">Facing ≤</span><input type="range" id="f-bmax" min="0" max="360" step="5" value="${F.bearMax}"><span class="v" id="f-bmax-v">${Math.round(F.bearMax)}°</span></div>` +
      `<div class="readout" id="f-bnote">${F.bearMin > F.bearMax ? "wraps through North (0°)" : ""}</div>` +
    "</div>";
  }

  const LAYER_DEFS = [
    { id: "cones",   name: "Direction cone", swatch: "cone", min: 8, max: 60, prop: "pxSize" },
    { id: "lines",   name: "Line of sight",  swatch: "los",  min: 1, max: 8,  prop: "width" },
    { id: "objects", name: "Subject",        swatch: "obj",  min: 2, max: 12, prop: "size" },
    { id: "cameras", name: "Camera",         swatch: "cam",  min: 2, max: 14, prop: "size" },
  ];

  function layersHtml() {
    const layers = LOS.settings.layers;
    let html = '<div class="sect"><div class="lbl">Layers</div>';
    for (const L of LAYER_DEFS) {
      const c = layers[L.id];
      html +=
        '<div class="row">' +
          `<input type="checkbox" data-layer="${L.id}" data-prop="visible"${c.visible ? " checked" : ""}>` +
          `<span class="swatch ${L.swatch}"></span>` +
          `<label class="name">${L.name}</label>` +
          `<input type="color" data-layer="${L.id}" data-prop="color" value="${c.color}">` +
          `<input type="range" class="mini" data-layer="${L.id}" data-prop="${L.prop}" min="${L.min}" max="${L.max}" step="1" value="${c[L.prop]}" title="size">` +
        "</div>" +
        `<div class="row sub2"><span class="k2">opacity</span>` +
          `<input type="range" data-layer="${L.id}" data-prop="opacity" min="0" max="1" step="0.05" value="${c.opacity}"></div>`;
      if (L.id === "cones") {
        html +=
          `<div class="row sub2"><input type="checkbox" data-layer="cones" data-prop="ramp"${c.ramp ? " checked" : ""}>` +
            '<label class="name">Distance color ramp</label></div>';
      }
    }
    return html + "</div>";
  }

  function basemapHtml() {
    const opts = LOS.config.BASEMAPS
      .map((b) => `<option value="${b.id}"${b.id === LOS.settings.basemap ? " selected" : ""}>${b.name}</option>`)
      .join("");
    return '<div class="sect"><div class="lbl">Basemap</div>' +
      `<div class="row"><select id="basemap-sel">${opts}</select></div>` +
      `<div class="row"><input type="checkbox" id="terrain-toggle"${LOS.settings.terrain ? " checked" : ""}><label class="name">3D terrain</label></div>` +
    "</div>";
  }

  function build() {
    const $body = $panel.querySelector(".pbody");
    $body.innerHTML = filtersHtml() + layersHtml() + basemapHtml();
    wire($body);
  }

  function wire($body) {
    const V = LOS.mapView;
    const F = LOS.settings.filters;
    const saveDebounced = LOS.persist.saveDebounced;

    $panel.querySelector(".phead").addEventListener("click", () => {
      $panel.classList.toggle("collapsed");
      saveDebounced();
    });

    // Layer visibility / color / size / opacity / ramp (delegated).
    function onLayerControl(e) {
      const el = e.target;
      if (!el || !el.getAttribute) return;
      const layer = el.getAttribute("data-layer");
      if (!layer) return;
      const prop = el.getAttribute("data-prop");
      let val;
      if (el.type === "checkbox") val = el.checked;
      else if (el.type === "range") val = parseFloat(el.value);
      else val = el.value;
      LOS.settings.layers[layer][prop] = val;
      V.applyLayerStyle(layer);
      if (layer === "cones" && (prop === "pxSize" || prop === "ramp")) V.rebuildConesDebounced();
      saveDebounced();
    }
    $body.addEventListener("input", onLayerControl);
    $body.addEventListener("change", onLayerControl);

    // Length filter.
    const minS = document.getElementById("f-minlen"), maxS = document.getElementById("f-maxlen");
    const minV = document.getElementById("f-minlen-v"), maxV = document.getElementById("f-maxlen-v");
    function onLen() {
      F.minLen = parseFloat(minS.value);
      F.maxLen = parseFloat(maxS.value);
      minV.textContent = `${Math.round(F.minLen)} m`;
      maxV.textContent = F.maxLen >= LOS.config.LEN_MAX ? "∞" : `${Math.round(F.maxLen)} m`;
      V.applyFilters();
      saveDebounced();
    }
    minS.addEventListener("input", onLen);
    maxS.addEventListener("input", onLen);

    // Has / no line-of-sight.
    const seg = document.getElementById("los-seg");
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      F.los = b.getAttribute("data-los");
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      V.applyFilters();
      saveDebounced();
    });

    // Orientation filter (with wrap-around).
    const bminS = document.getElementById("f-bmin"), bmaxS = document.getElementById("f-bmax");
    const bminV = document.getElementById("f-bmin-v"), bmaxV = document.getElementById("f-bmax-v");
    const bnote = document.getElementById("f-bnote");
    function onBear() {
      F.bearMin = parseFloat(bminS.value);
      F.bearMax = parseFloat(bmaxS.value);
      bminV.textContent = `${Math.round(F.bearMin)}°`;
      bmaxV.textContent = `${Math.round(F.bearMax)}°`;
      bnote.textContent = F.bearMin > F.bearMax ? "wraps through North (0°)" : "";
      V.applyFilters();
      saveDebounced();
    }
    bminS.addEventListener("input", onBear);
    bmaxS.addEventListener("input", onBear);

    // Basemap + terrain.
    document.getElementById("basemap-sel").addEventListener("change", (e) => {
      V.switchBasemap(e.target.value);
      saveDebounced();
    });
    document.getElementById("terrain-toggle").addEventListener("change", (e) => {
      LOS.settings.terrain = e.target.checked;
      V.applyTerrain();
      saveDebounced();
    });
  }

  const setCollapsed = (collapsed) => $panel.classList.toggle("collapsed", collapsed);

  LOS.panel = { build, setCollapsed };
})();
