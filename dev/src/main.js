import "maplibre-gl/dist/maplibre-gl.css";
import "/src/style.css";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  center: [-85, 36], // starting position [lng, lat]
  zoom: 5, // starting zoom
  maxPitch: 85, // max pitch allowed
  //   hash: true, // sync map position with URL
  style: "./style.json",
});

// getGeoJSONBounds function
function getGeoJSONBounds(geojson) {
  const bounds = new maplibregl.LngLatBounds();
  geojson.features.forEach((f) => {
    const coords = f.geometry.coordinates;
    (f.geometry.type === "Point"
      ? [coords]
      : f.geometry.type === "MultiPolygon"
      ? coords.flat(2)
      : f.geometry.type === "Polygon"
      ? coords.flat()
      : coords
    ).forEach((c) => bounds.extend(c));
  });
  return bounds;
}

// simple number formatters
const nf = new Intl.NumberFormat("en-US");
const cf0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// pull [value, size] stops from an interpolate expression
function getInterpolateStops(expr) {
  // expr looks like: ["interpolate", ["linear"], <input>, v1, r1, v2, r2, ...]
  if (!Array.isArray(expr) || expr[0] !== "interpolate") return [];
  const pairs = [];
  for (let i = 3; i < expr.length - 1; i += 2) {
    pairs.push([expr[i], expr[i + 1]]);
  }
  return pairs;
}

// build legend rows for the active layer
function buildGraduatedLegend(map, layerId, opts = {}) {
  const container = document.querySelector(".legend");
  if (!container) return;

  const title =
    opts.title ||
    (layerId === "landslides-costpm"
      ? "Cost per Mile"
      : "Number of Occurrences");
  const color = map.getPaintProperty(layerId, "circle-color") || "#888";
  const radiusExpr = map.getPaintProperty(layerId, "circle-radius");
  const stops = getInterpolateStops(radiusExpr);
  if (!stops.length) return;

  // make two sorted copies
  const stopsAsc = [...stops].sort((a, b) => Number(a[1]) - Number(b[1])); // small → big
  const stopsDesc = [...stops].sort((a, b) => Number(b[1]) - Number(a[1])); // big → small

  const maxR = Math.max(...stopsAsc.map(([, r]) => Number(r)));
  const maxD = Math.max(10, Math.round(maxR * 2));

  // shell
  const box = document.createElement("div");
  box.className = "legend_box";

  const bubbles = document.createElement("div");
  bubbles.className = "legend_bubbles";
  bubbles.style.setProperty("--maxD", `${maxD}px`);
  bubbles.style.setProperty("--color", color);

  const labels = document.createElement("div");
  labels.className = "legend_labels";

  // 1) CIRCLES: largest → smallest so smallest is appended last (on top)
  stopsDesc.forEach(([, r]) => {
    const d = Math.max(10, Math.round(r * 2));
    const c = document.createElement("span");
    c.className = "b";
    c.style.width = `${d}px`;
    c.style.height = `${d}px`;
    bubbles.appendChild(c);
  });

  // 2) LABELS/TICKS: also largest → smallest for a top→bottom descending list
  stopsDesc.forEach(([val, r], i) => {
    const y = maxD - 2 * r; // label positioned at top edge of each circle
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.top = `${y}px`;

    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.style.top = `${y}px`;
    const isLast = i === stopsDesc.length - 1;
    lbl.textContent =
      layerId === "landslides-costpm"
        ? isLast
          ? `≥ ${cf0.format(val)}`
          : `≤ ${cf0.format(val)}`
        : isLast
        ? `≥ ${nf.format(val)}`
        : `≤ ${nf.format(val)}`;

    labels.appendChild(tick);
    labels.appendChild(lbl);
  });

  box.appendChild(bubbles);
  box.appendChild(labels);

  const titleEl = container.querySelector(".legend_title");
  const bodyEl = container.querySelector(".legend_body");
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) {
    bodyEl.innerHTML = "";
    bodyEl.appendChild(box);
  }
}

// ---- Help modal logic (no CSS injection needed) ----
function inputProfile() {
  const anyCoarse =
    window.matchMedia?.("(any-pointer: coarse)")?.matches || false;
  const anyHover = window.matchMedia?.("(any-hover: hover)")?.matches || false;
  const uaMobile =
    navigator.userAgentData?.mobile ||
    /Mobi|Android/i.test(navigator.userAgent);
  return {
    mobileLikely: (anyCoarse && !anyHover) || uaMobile,
    hybridLikely: anyCoarse && anyHover, // example: Surface + mouse
    desktopLikely: !anyCoarse && anyHover,
  };
}

const HELP_STORAGE_KEY = "d12_map_help_dismissed_v1";

function buildHelpHTML() {
  const p = inputProfile();
  // checks if the user is using a mouse and touchpad, returns hybrid help message
  if (p.hybridLikely) {
    return `
      <h3 class="title">How to use this map (Mouse & Touch)</h3>
      <ul class="list">
        <li><b>Pan:</b> left-click + drag • or one-finger drag</li>
        <li><b>Rotate/Tilt:</b> right-click + drag (or Ctrl + left-drag) • or two-finger drag</li>
        <li><b>Zoom:</b> mouse wheel/trackpad • or two-finger pinch</li>
        <li><b>Details:</b> click/tap a circle</li>
      </ul>
    `;
  }
  // checks if the user is on mobile, returns a mobile help message
  if (p.mobileLikely) {
    return `
      <h3 class="title">How to use this map (Mobile)</h3>
      <ul class="list">
        <li><b>Pan:</b> drag with one finger</li>
        <li><b>Zoom:</b> pinch with two fingers</li>
        <li><b>Rotate / Tilt:</b> twist or two-finger drag</li>
        <li><b>Details:</b> tap a circle</li>
      </ul>
    `;
  }
  // checks if the user is on desktop, returns a desktop help message
  return `
    <h3 class="title">How to use this map (Desktop)</h3>
    <ul class="list">
      <li><b>Pan:</b> left-click + drag</li>
      <li><b>Rotate / Tilt:</b> right-click + drag (or Ctrl + left-drag)</li>
      <li><b>Zoom:</b> mouse wheel / trackpad</li>
      <li><b>Details:</b> click a circle</li>
    </ul>
  `;
}

// check which help message version is being loaded in the browser
// console.table({
//   anyPointerCoarse: window.matchMedia?.("(any-pointer: coarse)")?.matches,
//   anyHoverHover: window.matchMedia?.("(any-hover: hover)")?.matches,
//   maxTouchPoints: navigator.maxTouchPoints,
//   uaMobile: navigator.userAgentData?.mobile,
// });

function showHelpModal({ force = false } = {}) {
  if (!force && localStorage.getItem(HELP_STORAGE_KEY) === "1") return;

  const backdrop = document.createElement("div");
  backdrop.className = "maphelp_backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "maphelp_modal";
  modal.innerHTML = `
    <button class="maphelp_close" aria-label="Close help">×</button>
    ${buildHelpHTML()}
    <div class="actions">
      <label class="remember">
        <input type="checkbox" id="maphelp_dont_show" /> Don’t show again
      </label>
      <button class="ok">Got it</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => {
    const dontShow = modal.querySelector("#maphelp_dont_show")?.checked;
    if (dontShow) localStorage.setItem(HELP_STORAGE_KEY, "1");
    backdrop.remove();
  };

  modal.querySelector(".maphelp_close").addEventListener("click", close);
  modal.querySelector(".ok").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && backdrop.isConnected) close();
    },
    { once: true }
  );
}

function injectHelpButton() {
  if (document.querySelector(".maphelp_btn")) return;
  const btn = document.createElement("button");
  btn.className = "maphelp_btn";
  btn.title = "Map help";
  btn.textContent = "?";
  btn.addEventListener("click", () => showHelpModal({ force: true }));
  document.body.appendChild(btn);
}

class HelpControl {
  onAdd(map) {
    this._map = map;
    const c = document.createElement("div");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group maphelp-ctrl";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "maphelp_btn_ctrl";
    btn.setAttribute("aria-label", "Map help");
    btn.innerHTML = "?";
    btn.addEventListener("click", () => showHelpModal({ force: true }));

    c.appendChild(btn);
    this._container = c;
    return c;
  }
  onRemove() {
    this._container?.remove();
    this._map = undefined;
  }
}

map.on("load", async () => {
  map.setPitch(55);
  map.setBearing(35);
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
  map.setTerrain({
    source: "terrainSource",
    exaggeration: 2,
  });
  // add lighting effect to terrain
  // map.setLight({
  //   anchor: "viewport",
  //   color: "white",
  //   intensity: 1,
  //   position: [1.5, 150, 80], // [radial, azimuthal, polar] in degrees
  // });

  // Add sky style to the map, giving an atmospheric effect
  map.setSky({
    "sky-color": "#61C2FEFF",
    "sky-horizon-blend": 0.5,
    "horizon-color": "#EBF1F4FF",
    "horizon-fog-blend": 0.5,
    "fog-color": "#B5B5B5FF",
    "fog-ground-blend": 0.5,
    "atmosphere-blend": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      1,
      10,
      1,
      12,
      0,
    ],
  });

  // GeoJSON layers locally stored
  // Make sure data is in the "public" folder to be served correctly
  // when it's built for production
  // The "public" folder is the root of the web server
  const slidesUrl = "./data/landslides.geojson";
  const slidesRes = await fetch(slidesUrl);
  const slidesGeoJSON = await slidesRes.json();

  // add landslides as a geojson source
  map.addSource("landslides", {
    type: "geojson",
    data: slidesGeoJSON,
  });

  map.addSource("county_labels", {
    type: "geojson",
    data: "./data/appal-county-labels.geojson",
  });

  map.addSource("city_labels", {
    type: "geojson",
    data: "./data/cities.geojson",
  });

  // pull unique type styles from the style.json
  const styleData = await fetch("./style.json").then((r) => r.json());

  // fitBounds to the slidesGeoJSON
  map.fitBounds(getGeoJSONBounds(slidesGeoJSON), { padding: 20, maxZoom: 12 });

  map.addLayer({
    id: "landslides-costpm",
    type: "circle",
    source: "landslides",
    minzoom: 7,
    layout: { visibility: "visible" },
    filter: [
      "all",
      ["has", "Cost per Mile"],
      [">", ["coalesce", ["get", "Cost per Mile"], 0], 0],
    ],
    paint: {
      "circle-color": "#E4C64E",
      "circle-opacity": 0.9,
      "circle-stroke-color": "rgba(0,0,0,0.35)",
      "circle-stroke-width": 0.9,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "Cost per Mile"], 0],
        // Adjust stops to your data distribution
        500000,
        6,
        2000000,
        16,
        5000000,
        26,
        22500000,
        36,
      ],
    },
  });

  // shadow for landslide cost per mile symbol
  map.addLayer(
    {
      id: "landslides-costpm-shadow",
      type: "circle",
      source: "landslides",
      minzoom: 7,
      layout: { visibility: "visible" },
      filter: [
        "all",
        ["has", "Cost per Mile"],
        [">", ["coalesce", ["get", "Cost per Mile"], 0], 0],
      ],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "Cost per Mile"], 0],
          500000,
          10,
          2000000,
          20,
          5000000,
          30,
          22500000,
          40,
        ],
        "circle-color": "rgba(0, 0, 0, 1)",
        "circle-blur": 1, // creates soft edge
        "circle-opacity": 0.5,
      },
    },
    "landslides-costpm"
  ); // add underneath the main layer

  // ---- Graduated by Weighted Occurrences (blue) ----
  map.addLayer({
    id: "landslides-weightedocc",
    type: "circle",
    source: "landslides",
    minzoom: 7,
    layout: { visibility: "none" }, // hidden by default; we’ll toggle this later
    filter: [
      "all",
      ["has", "Weighted Occurrences"],
      [">", ["coalesce", ["get", "Weighted Occurrences"], 0], 0],
    ],
    paint: {
      "circle-color": "#50a1fa",
      "circle-opacity": 0.9,
      "circle-stroke-color": "rgba(0,0,0,0.35)",
      "circle-stroke-width": 0.9,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "Weighted Occurrences"], 0],
        6,
        6,
        12,
        16,
        18,
        26,
        26,
        36,
      ],
    },
  });

  // shadow for weighted occurrences
  map.addLayer(
    {
      id: "landslides-weightedocc-shadow",
      type: "circle",
      source: "landslides",
      minzoom: 7,
      layout: { visibility: "none" },
      filter: [
        "all",
        ["has", "Weighted Occurrences"],
        [">", ["coalesce", ["get", "Weighted Occurrences"], 0], 0],
      ],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "Weighted Occurrences"], 0],
          6,
          12,
          12,
          22,
          18,
          32,
          26,
          42,
        ],
        "circle-color": "rgba(0, 0, 0, 1)",
        "circle-blur": 2, // creates soft edge
        "circle-opacity": 0.5,
      },
    },
    "landslides-weightedocc"
  );

  map.addLayer({
    id: "county-labels",
    type: "symbol",
    source: "county_labels",
    maxzoom: 11,
    filter: [
      "in",
      ["get", "NAME"],
      [
        "literal",
        ["LAWRENCE", "JOHNSON", "MARTIN", "FLOYD", "PIKE", "KNOTT", "LETCHER"],
      ],
    ],
    layout: {
      "symbol-placement": "point",
      "text-field": ["to-string", ["get", "NAME"]],
      "text-font": ["Montserrat Bold", "Montserrat SemiBold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 7, 14, 12, 15, 15, 16],
      "text-allow-overlap": false,
      "text-anchor": "center",
    },
    paint: {
      "text-color": "#FFFFFF",
      "text-halo-color": "#222",
      "text-halo-width": 1.5,
      "text-halo-blur": 2,
    },
  });

  map.addLayer({
    id: "city-labels",
    type: "symbol",
    source: "city_labels",
    minzoom: 10,
    layout: {
      "symbol-placement": "point",
      "text-field": ["to-string", ["get", "NAME2"]],
      "text-font": ["Montserrat SemiBold", "Montserrat Medium"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        12,
        12,
        13,
        15,
        15,
      ],
      "text-allow-overlap": false,
      "text-anchor": "center",
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#222",
      "text-halo-width": 1.2,
      "text-halo-blur": 2,
    },
  });

  // Create legend container if it doesn't exist
  let legend = document.querySelector(".legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `
    <div class="legend_title">Legend</div>
    <div class="legend_body"></div>
    <div class="legend_switch" style="margin-top:8px;">
      <label style="margin-right:10px;">
        <input type="radio" name="metric" value="costpm" checked>
        Cost per Mile
      </label>
      <label>
        <input type="radio" name="metric" value="weighted">
        Weighted Occurrences
      </label>
    </div>
  `;
    document.body.appendChild(legend);
  }

  const num = (v) => (v == null || v === "" ? null : Number(v));
  const safe = (v) => (v == null || v === "" ? "—" : v);
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  // Builds a Street View URL from lon/lat
  function streetViewURL({ lon, lat }) {
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
  }

  // Attach popup handlers for a given layer id
  function attachLandslidePopup(layerId) {
    // pointer cursor affordance
    map.on(
      "mouseenter",
      layerId,
      () => (map.getCanvas().style.cursor = "pointer")
    );
    map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));

    map.on("click", layerId, (e) => {
      const feat = e.features[0];
      const p = feat.properties || {};
      const coords = feat.geometry?.coordinates || [e.lngLat.lng, e.lngLat.lat];

      // pull props safely (support X/x and Y/y just in case)
      const lon = num(p.X ?? p.x ?? coords[0]);
      const lat = num(p.Y ?? p.y ?? coords[1]);

      const id = safe(p["Unique APS-Code"]);
      const county = safe(p.County);
      const route = safe(p.Route);
      const costVal = Number(p["Cost per Mile"]);
      const cost = isNaN(costVal)
        ? "—"
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(costVal);

      const mp = safe(p["Mid MP"]);
      const minMP = safe(p["Min MP"]);
      const maxMP = safe(p["Max MP"]);
      const l = safe(p["Total Distance"]);
      const occ = p.Occurrences ?? p.occurrences ?? p["Weighted Occurrences"];
      const occStr = occ == null ? "—" : nf0.format(occ);
      const aadt = p.AADT == null ? "—" : nf0.format(p.AADT);

      // Build Street View link (only if we have coordinates)
      const sv =
        lon != null && lat != null ? streetViewURL({ lon, lat }) : null;

      const svHtml = sv
        ? `<a class="text-blue-600 hover:text-blue-900 underline font-medium"
        href="${sv}" target="_blank" rel="noopener">Open Street View</a>`
        : "Street View: —";

      const html = `
    <h2 class="text-xl font-bold">Landslide ID: ${id}</h2>
    <p>
    Landslide in ${county} County, occurred along ${route}<br>
     <br><strong>Number of Occurrences</strong>: ${occ} 
     <br><strong>Cost per Mile</strong>: ${cost}
     <br><strong>AADT</strong>: ${aadt} 
     <br><strong>Total Length</strong>: ${l} miles
     <br>&emsp;From Mile Point ${minMP} to ${maxMP}
     <br><strong>Mid Mile Point</strong>: ${mp} &nbsp;•&nbsp; ${svHtml}
     </p>
    `;

      new maplibregl.Popup({ closeButton: true, offset: 10 })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
    });
  }

  // attach to BOTH metric layers
  attachLandslidePopup("landslides-costpm");
  attachLandslidePopup("landslides-weightedocc");

  // initial legend for cost per mile
  buildGraduatedLegend(map, "landslides-costpm");

  // wire radios
  legend.querySelectorAll('input[name="metric"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      const metric = e.target.value; // "costpm" or "weighted"
      window.setLandslideMetric(metric);
      buildGraduatedLegend(
        map,
        metric === "costpm" ? "landslides-costpm" : "landslides-weightedocc"
      );
    });
  });

  // metric: "costpm" or "weighted"
  window.setLandslideMetric = function (metric) {
    const showCost = metric === "costpm";
    map.setLayoutProperty(
      "landslides-costpm-shadow",
      "visibility",
      showCost ? "visible" : "none"
    );
    map.setLayoutProperty(
      "landslides-costpm",
      "visibility",
      showCost ? "visible" : "none"
    );

    map.setLayoutProperty(
      "landslides-weightedocc-shadow",
      "visibility",
      showCost ? "none" : "visible"
    );
    map.setLayoutProperty(
      "landslides-weightedocc",
      "visibility",
      showCost ? "none" : "visible"
    );
  };

  showHelpModal(); // shows the helper function window when the map loads
}); // end map.on("load") function

// Add basic map controls
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.FullscreenControl());
map.addControl(
  new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: "imperial",
  })
);

// Add terrain control for 3D effect
map.addControl(
  new maplibregl.TerrainControl({
    source: "terrainSource",
    exaggeration: 2,
  })
);

map.addControl(new HelpControl(), "top-right"); // adds new helper control button

// Event listeners to monitor map changes
map.on("move", () => {
  const center = map.getCenter();
  // console.log(
  //   `Longitude: ${center.lng.toFixed(4)} Latitude: ${center.lat.toFixed(4)}`
  // );
});

map.on("zoomend", () => {
  console.log("Zoom: ", map.getZoom().toFixed(2));
});
