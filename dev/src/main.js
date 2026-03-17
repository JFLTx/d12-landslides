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

  const layer = map.getLayer(layerId);
  if (!layer) {
    console.warn(
      `Legend skipped: layer "${layerId}" not found in loaded style.`,
    );
    return;
  }

  const metric = opts.metric || "costpm";

  const title =
    metric === "top50"
      ? "Top 50 Risk Index"
      : layerId === "landslides-costpm"
        ? "Cost per Mile"
        : "Weighted Occurrences";
  const color = map.getPaintProperty(layerId, "circle-color") || "#888";
  const radiusExpr = map.getPaintProperty(layerId, "circle-radius");
  const stops = getInterpolateStops(radiusExpr);
  if (!stops.length) return;

  // make two sorted copies
  const stopsDesc = [...stops].sort((a, b) => Number(b[1]) - Number(a[1])); // big → small

  const maxR = Math.max(...stops.map(([, r]) => Number(r)));
  const maxD = Math.max(10, Math.round(maxR * 2));

  // shell
  const box = document.createElement("div");
  box.className = "legend_box";

  const leftCol = document.createElement("div");
  leftCol.style.display = "flex";
  leftCol.style.flexDirection = "column";
  leftCol.style.gap = "8px";

  const bubbles = document.createElement("div");
  bubbles.className = "legend_bubbles";
  bubbles.style.setProperty("--maxD", `${maxD}px`);
  bubbles.style.setProperty(
    "--color",
    metric === "top50"
      ? "#ebebeb"
      : map.getPaintProperty(layerId, "circle-color") || "#888",
  );

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
    if (metric === "top50") {
      lbl.textContent = isLast
        ? `≥ ${Number(val).toFixed(3)}`
        : `≤ ${Number(val).toFixed(3)}`;
    } else {
      lbl.textContent =
        layerId === "landslides-costpm"
          ? isLast
            ? `≥ ${cf0.format(val)}`
            : `≤ ${cf0.format(val)}`
          : isLast
            ? `≥ ${nf.format(val)}`
            : `≤ ${nf.format(val)}`;
    }

    labels.appendChild(tick);
    labels.appendChild(lbl);
  });

  leftCol.appendChild(bubbles);

  let colorKey = null;
  if (metric === "top50") {
    colorKey = document.createElement("div");
    colorKey.className = "legend_color_key";
    colorKey.innerHTML = `
      <div class="legend_color_item">
        <span class="legend_swatch" style="background:#2C5AA0;"></span>
        <span>Landslide</span>
      </div>
      <div class="legend_color_item">
        <span class="legend_swatch" style="background:#C23B32;"></span>
        <span>Rockfall</span>
      </div>
    `;
  }

  box.appendChild(leftCol);
  box.appendChild(labels);

  const wrapper = document.createElement("div");
  wrapper.className = "legend_wrapper";
  wrapper.appendChild(box);

  if (colorKey) {
    wrapper.appendChild(colorKey);
  }

  const titleEl = container.querySelector(".legend_title");
  const bodyEl = container.querySelector(".legend_body");
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) {
    bodyEl.innerHTML = "";
    bodyEl.appendChild(wrapper);
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
    { once: true },
  );
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

const num = (v) => (v == null || v === "" ? null : Number(v));
const safe = (v) => (v == null || v === "" ? "—" : v);
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Builds a Street View URL from lon/lat
function streetViewURL({ lon, lat }) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

const top50Key = new Map();

function getTop50Key(feature) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates || [];
  const lon = num(p.Longitude ?? p.longitude ?? coords[0]);
  const lat = num(p.Latitude ?? p.latitude ?? coords[1]);

  if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) {
    return "";
  }

  return `${Number(lon).toFixed(8)}|${Number(lat).toFixed(8)}`;
}

function sortTop50Features(features) {
  return [...features].sort((a, b) => {
    const rankA = Number(a?.properties?.["Risk Index Rank"]);
    const rankB = Number(b?.properties?.["Risk Index Rank"]);

    if (!Number.isNaN(rankA) && !Number.isNaN(rankB) && rankA !== rankB) {
      return rankA - rankB;
    }

    const typeA = safe(a?.properties?.["Score Type"]);
    const typeB = safe(b?.properties?.["Score Type"]);
    if (typeA !== typeB) return typeA.localeCompare(typeB);

    const apsA = safe(a?.properties?.["Unique APS-Code"]);
    const apsB = safe(b?.properties?.["Unique APS-Code"]);
    return apsA.localeCompare(apsB);
  });
}

function indexTop50(geojson) {
  top50Key.clear();

  (geojson.features || []).forEach((feature) => {
    const key = getTop50Key(feature);
    if (!key) return;

    if (!top50Key.has(key)) {
      top50Key.set(key, []);
    }
    top50Key.get(key).push(feature);
  });

  for (const [key, features] of top50Key.entries()) {
    top50Key.set(key, sortTop50Features(features));
  }
}

function buildTop50Popup(feature) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates || [];

  const aps = safe(p["Unique APS-Code"]);
  const rank = safe(p["Risk Index Rank"]);
  const county = safe(p["County"]);
  const rteType = safe(p["Rte Type"]);
  const roadNumber = safe(p["RoadNumber"]);
  const mps = safe(p["MP's"]);

  const lon = num(p.Longitude ?? p.longitude ?? coords[0]);
  const lat = num(p.Latitude ?? p.latitude ?? coords[1]);

  const scoreType = safe(p["Score Type"]);
  const scoreTypeLabel =
    scoreType === "LS"
      ? "Landslide"
      : scoreType === "RF"
        ? "Rockfall"
        : scoreType;

  const fieldScore =
    p["Field Score"] == null || p["Field Score"] === ""
      ? "—"
      : Number(p["Field Score"]).toFixed(3);

  const criticalityScore =
    p["Criticality Score"] == null || p["Criticality Score"] === ""
      ? "—"
      : Number(p["Criticality Score"]).toFixed(3);

  const riskIndex =
    p["Risk Index"] == null || p["Risk Index"] === ""
      ? "—"
      : Number(p["Risk Index"]).toFixed(3);

  const scoreColor =
    scoreType === "LS" ? "#2C5AA0" : scoreType === "RF" ? "#C23B32" : "#444";

  const sv = lon != null && lat != null ? streetViewURL({ lon, lat }) : null;

  const svHtml = sv
    ? `<a class="text-blue-600 hover:text-blue-900 underline font-medium"
        href="${sv}" target="_blank" rel="noopener">Open Street View</a>`
    : "Street View: —";

  return `
    <h2 class="text-xl font-bold">
      Incident ID: ${aps}<br>
      Risk Index Rank: ${rank}
    </h2>
    <p>
      Occurred in <strong>${county}</strong> County along <strong>${rteType}-${roadNumber}</strong><br>
      <br><strong>Mile Points</strong>: ${mps} &nbsp;•&nbsp; ${svHtml}
      <br><strong>Score Type</strong>: <span style="color:${scoreColor}; font-weight:700;">${scoreTypeLabel}</span>
      <br><strong>Field Score</strong>: ${fieldScore}
      <br><strong>Criticality Score</strong>: ${criticalityScore}
      <br><strong>Risk Index</strong>: ${riskIndex}
    </p>
  `;
}

function showTop50DetailPopup(feature) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates || [
    num(p.Longitude),
    num(p.Latitude),
  ];

  new maplibregl.Popup({ closeButton: true, offset: 10 })
    .setLngLat(coords)
    .setHTML(buildTop50Popup(feature))
    .addTo(map);
}

function showTop50ChooserPopup(lngLat, features) {
  const html = `
    <div class="top50-chooser">
      <div style="font-weight:700; margin-bottom:8px;">
        ${features.length} records at this location
      </div>
      <div style="font-size:12px; color:#444; margin-bottom:8px;">
        Select a record to view details.
      </div>
      <div class="top50-chooser-list">
        ${features
          .map((feature, i) => {
            const p = feature?.properties || {};
            const aps = safe(p["Unique APS-Code"]);
            const rank = safe(p["Risk Index Rank"]);
            const scoreType = safe(p["Score Type"]);
            const scoreTypeLabel =
              scoreType === "LS"
                ? "Landslide"
                : scoreType === "RF"
                  ? "Rockfall"
                  : scoreType;

            const scoreColor =
              scoreType === "LS"
                ? "#2C5AA0"
                : scoreType === "RF"
                  ? "#C23B32"
                  : "#444";

            return `
              <button
                type="button"
                class="top50-choice"
                data-choice-index="${i}"
                style="
                  display:block;
                  width:100%;
                  text-align:left;
                  padding:8px 10px;
                  margin:0 0 6px 0;
                  border:1px solid #d7d7d7;
                  border-radius:8px;
                  background:#fff;
                  cursor:pointer;
                "
              >
                <strong>#${rank}</strong>
                <span style="color:${scoreColor}; font-weight:700;">${scoreTypeLabel}</span>
                — ${aps}
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;

  const popup = new maplibregl.Popup({ closeButton: true, offset: 10 })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);

  const popupEl = popup.getElement();
  popupEl.querySelectorAll(".top50-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.choiceIndex);
      const selectedFeature = features[i];
      popup.remove();
      showTop50DetailPopup(selectedFeature);
    });
  });
}

function filterLabels(geojson) {
  const byAPS = new Map();

  (geojson.features || []).forEach((feature) => {
    const p = feature.properties || {};
    const aps = p["Unique APS-Code"];
    const rank = Number(p["Risk Index Rank"]);

    if (!aps) return;

    if (!byAPS.has(aps)) {
      byAPS.set(aps, feature);
      return;
    }

    const existing = byAPS.get(aps);
    const existingRank = Number(existing?.properties?.["Risk Index Rank"]);

    // keep the better rank (smaller number) for labeling
    if (
      !Number.isNaN(rank) &&
      !Number.isNaN(existingRank) &&
      rank < existingRank
    ) {
      byAPS.set(aps, feature);
    }
  });

  return {
    type: "FeatureCollection",
    features: [...byAPS.values()],
  };
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

  // Fetch landslides GeoJSON once so we can fit the map to its bounds
  // Make sure data is in the "public" folder to be served correctly
  // when it's built for production
  // The "public" folder is the root of the web server
  const slidesRes = await fetch("./data/landslides.geojson");
  if (!slidesRes.ok) {
    throw new Error(`Failed to load landslides.geojson: ${slidesRes.status}`);
  }
  const slidesGeoJSON = await slidesRes.json();

  const top50Res = await fetch("./data/top50-landslides.geojson");
  if (!top50Res.ok) {
    throw new Error(
      `Failed to load top50-landslides.geojson: ${top50Res.status}`,
    );
  }
  const top50GeoJSON = await top50Res.json();
  const top50Label = filterLabels(top50GeoJSON);
  map.getSource("top50-labels").setData(top50Label);
  indexTop50(top50GeoJSON);

  // fitBounds to the slidesGeoJSON
  map.fitBounds(getGeoJSONBounds(slidesGeoJSON), { padding: 20, maxZoom: 12 });

  // Create legend container if it doesn't exist
  let legend = document.querySelector(".legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `
      <div class="legend_title">Legend</div>
      <div class="legend_body"></div>
      <div class="legend_switch" style="margin-top:8px;">
        <label style="display:block; margin-bottom:6px;">
          <input type="radio" name="metric" value="top50" checked>
          Top 50 Risk Index
        </label>

        <div class="legend_section_break">
          <span>Original Dataset</span>
        </div>

        <label style="display:block; margin-bottom:6px;">
          <input type="radio" name="metric" value="costpm">
          Cost per Mile
        </label>
        <label style="display:block;">
          <input type="radio" name="metric" value="weighted">
          Weighted Occurrences
        </label>
      </div>
    `;
    document.body.appendChild(legend);
  }
  buildGraduatedLegend(map, "top50", { metric: "top50" });

  // wire radios
  legend.querySelectorAll('input[name="metric"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      const metric = e.target.value;
      setLandslideMetric(metric);

      buildGraduatedLegend(
        map,
        metric === "top50"
          ? "top50"
          : metric === "costpm"
            ? "landslides-costpm"
            : "landslides-weightedocc",
        { metric },
      );
    });
  });

  // metric: top50 Risk Index, "costpm" or "weighted"
  const setLandslideMetric = function (metric) {
    const showTop50 = metric === "top50";
    const showCost = metric === "costpm";
    const showWeighted = metric === "weighted";

    map.setLayoutProperty(
      "top50-shadow",
      "visibility",
      showTop50 ? "visible" : "none",
    );
    map.setLayoutProperty(
      "top50",
      "visibility",
      showTop50 ? "visible" : "none",
    );

    map.setLayoutProperty(
      "landslides-costpm-shadow",
      "visibility",
      showCost ? "visible" : "none",
    );
    map.setLayoutProperty(
      "landslides-costpm",
      "visibility",
      showCost ? "visible" : "none",
    );

    map.setLayoutProperty(
      "landslides-weightedocc-shadow",
      "visibility",
      showWeighted ? "visible" : "none",
    );
    map.setLayoutProperty(
      "landslides-weightedocc",
      "visibility",
      showWeighted ? "visible" : "none",
    );

    map.setLayoutProperty(
      "top50-rank-labels",
      "visibility",
      showTop50 ? "visible" : "none",
    );
  };

  showHelpModal(); // shows the helper function window when the map loads

  // attach to BOTH metric layers
  attachLandslidePopup("landslides-costpm");
  attachLandslidePopup("landslides-weightedocc");
  attachLandslidePopup("top50");
}); // end map.on("load") function

// Attach popup handlers for a given layer id
function attachLandslidePopup(layerId) {
  // pointer cursor affordance
  map.on(
    "mouseenter",
    layerId,
    () => (map.getCanvas().style.cursor = "pointer"),
  );
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));

  map.on("click", layerId, (e) => {
    const feat = e.features?.[0];
    if (!feat) return;
    const p = feat.properties || {};
    const coords = feat.geometry?.coordinates || [e.lngLat.lng, e.lngLat.lat];

    // ----------------------------
    // TOP 50 POPUP LOGIC
    // ----------------------------
    if (layerId === "top50") {
      const coordKey = getTop50Key(feat);
      const sameLocationFeatures = top50Key.get(coordKey) || [feat];

      if (sameLocationFeatures.length > 1) {
        showTop50ChooserPopup(e.lngLat, sameLocationFeatures);
        return;
      }

      showTop50DetailPopup(feat);
      return;
    }

    // ----------------------------
    // ORIGINAL LANDSLIDES POPUP LOGIC
    // ----------------------------
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

    const sv = lon != null && lat != null ? streetViewURL({ lon, lat }) : null;

    const svHtml = sv
      ? `<a class="text-blue-600 hover:text-blue-900 underline font-medium"
        href="${sv}" target="_blank" rel="noopener">Open Street View</a>`
      : "Street View: —";

    const html = `
      <h2 class="text-xl font-bold">Incident ID: ${id}</h2>
      <p>
      Landslide in ${county} County, occurred along ${route}<br>
      <br><strong>Number of Occurrences</strong>: ${occStr}
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

// Add basic map controls
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.FullscreenControl());
map.addControl(
  new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: "imperial",
  }),
);

// Add terrain control for 3D effect
map.addControl(
  new maplibregl.TerrainControl({
    source: "terrainSource",
    exaggeration: 2,
  }),
);

// allow users to geolocate their position
map.addControl(
  new maplibregl.GeolocateControl({
    positionOptions: {
      enableHighAccuracy: true,
    },
    trackUserLocation: true,
    showUserHeading: true,
    showAccuracyCircle: true,
    fitBoundsOptions: {
      maxZoom: 14,
    },
  }),
  "top-right",
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
