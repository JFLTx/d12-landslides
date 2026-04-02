import "maplibre-gl/dist/maplibre-gl.css";
import "/src/style.css";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  center: [-85, 36],
  zoom: 5,
  maxPitch: 85,
  style: "./style.json",
});

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------

const top50Url = "./data/top50-landslides.geojson";
const top300Url = "./data/top300-landslides.geojson";
const landslidesUrl = "./data/landslides.geojson";

const datasets = {
  top50: {
    metric: "top50",
    layer: "top50",
    shadow: "top50-shadow",
    labels: "top50-rank-labels",
    legendTitle: "Top 50 Risk Index",
    chooser: true,
    chooserScoreLabel: "Risk Index",
    chooserValueField: "Risk Index Rank",
    legendIsDecimal: true,
  },
  top300: {
    metric: "top300",
    layer: "top300",
    shadow: "top300-shadow",
    labels: null,
    legendTitle: "LS/RF Desktop Score",
    chooser: true,
    chooserScoreLabel: "Desktop Score",
    chooserValueField: "Normalized DS Score",
    legendIsDecimal: true,
  },
  costpm: {
    metric: "costpm",
    layer: "landslides-costpm",
    shadow: "landslides-costpm-shadow",
    labels: null,
    legendTitle: "Cost",
    chooser: false,
    legendIsCurrency: true,
  },
  weighted: {
    metric: "weighted",
    layer: "landslides-weightedocc",
    shadow: "landslides-weightedocc-shadow",
    labels: null,
    legendTitle: "Weighted Occurrences",
    chooser: false,
    legendIsNumber: true,
  },
  predesktop: {
    metric: "predesktop",
    layer: "landslides-pds",
    shadow: "landslides-pds-shadow",
    labels: null,
    legendTitle: "Norm. Pre-Desktop Score",
    chooser: false,
    legendIsDecimal: true,
  },
};

const groupedFeatures = {
  top50: new Map(),
  top300: new Map(),
};

const helpStorageKey = "d12_map_help_dismissed_v1";

// -----------------------------------------------------------------------------
// GENERAL HELPERS
// -----------------------------------------------------------------------------

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

const nf = new Intl.NumberFormat("en-US");
const cf0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const num = (v) => (v == null || v === "" ? null : Number(v));
const safe = (v) => (v == null || v === "" ? "—" : v);

function streetViewURL({ lon, lat }) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

function scoreTypeLabel(value) {
  if (value === "LS") return "Landslide";
  if (value === "RF") return "Rockfall";
  return safe(value);
}

function scoreTypeColor(value) {
  if (value === "LS") return "#2C5AA0";
  if (value === "RF") return "#C23B32";
  return "#444";
}

function getInterpolateStops(expr) {
  if (!Array.isArray(expr) || expr[0] !== "interpolate") return [];
  const pairs = [];
  for (let i = 3; i < expr.length - 1; i += 2) {
    pairs.push([expr[i], expr[i + 1]]);
  }
  return pairs;
}

function getFeatureCoords(feature) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates || [];
  const lon = num(p.Longitude ?? p.longitude ?? p.X ?? p.x ?? coords[0]);
  const lat = num(p.Latitude ?? p.latitude ?? p.Y ?? p.y ?? coords[1]);
  return { lon, lat, coords: [lon ?? coords[0], lat ?? coords[1]] };
}

function getFeatureKey(feature) {
  const { lon, lat } = getFeatureCoords(feature);
  if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) {
    return "";
  }
  return `${Number(lon).toFixed(8)}|${Number(lat).toFixed(8)}`;
}

// -----------------------------------------------------------------------------
// DATASET INDEXING
// -----------------------------------------------------------------------------

function sortFeatures(features, kind) {
  if (kind === "top50") {
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

  if (kind === "top300") {
    return [...features].sort((a, b) => {
      const dsA = Number(a?.properties?.["Normalized DS Score"]);
      const dsB = Number(b?.properties?.["Normalized DS Score"]);

      if (!Number.isNaN(dsA) && !Number.isNaN(dsB) && dsA !== dsB) {
        return dsB - dsA;
      }

      const typeA = safe(a?.properties?.["Score Type"]);
      const typeB = safe(b?.properties?.["Score Type"]);
      if (typeA !== typeB) return typeA.localeCompare(typeB);

      const apsA = safe(a?.properties?.["Unique APS-Code"]);
      const apsB = safe(b?.properties?.["Unique APS-Code"]);
      return apsA.localeCompare(apsB);
    });
  }

  return features;
}

function indexFeatures(geojson, kind) {
  const store = groupedFeatures[kind];
  if (!store) return;

  store.clear();

  (geojson.features || []).forEach((feature) => {
    const key = getFeatureKey(feature);
    if (!key) return;

    if (!store.has(key)) {
      store.set(key, []);
    }
    store.get(key).push(feature);
  });

  for (const [key, features] of store.entries()) {
    store.set(key, sortFeatures(features, kind));
  }
}

function filterTop50Labels(geojson) {
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

// -----------------------------------------------------------------------------
// LEGEND
// -----------------------------------------------------------------------------

function buildGraduatedLegend(map, metric) {
  const container = document.querySelector(".legend");
  if (!container) return;

  const cfg = datasets[metric];
  if (!cfg) return;

  const layer = map.getLayer(cfg.layer);
  if (!layer) {
    console.warn(
      `Legend skipped: layer "${cfg.layer}" not found in loaded style.`,
    );
    return;
  }

  const radiusExpr = map.getPaintProperty(cfg.layer, "circle-radius");
  const stops = getInterpolateStops(radiusExpr);
  if (!stops.length) return;

  const stopsDesc = [...stops].sort((a, b) => Number(b[1]) - Number(a[1]));
  const maxR = Math.max(...stops.map(([, r]) => Number(r)));
  const maxD = Math.max(10, Math.round(maxR * 2));

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
    metric === "top50" || metric === "top300"
      ? "#ebebeb"
      : map.getPaintProperty(cfg.layer, "circle-color") || "#888",
  );

  const labels = document.createElement("div");
  labels.className = "legend_labels";

  stopsDesc.forEach(([, r]) => {
    const d = Math.max(10, Math.round(r * 2));
    const c = document.createElement("span");
    c.className = "b";
    c.style.width = `${d}px`;
    c.style.height = `${d}px`;
    bubbles.appendChild(c);
  });

  stopsDesc.forEach(([val, r], i) => {
    const y = maxD - 2 * r;
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.top = `${y}px`;

    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.style.top = `${y}px`;

    const isLast = i === stopsDesc.length - 1;

    if (cfg.legendIsDecimal) {
      lbl.textContent = isLast
        ? `≥ ${Number(val).toFixed(3)}`
        : `≤ ${Number(val).toFixed(3)}`;
    } else if (cfg.legendIsCurrency) {
      lbl.textContent = isLast
        ? `≥ ${cf0.format(val)}`
        : `≤ ${cf0.format(val)}`;
    } else {
      lbl.textContent = isLast ? `≥ ${nf.format(val)}` : `≤ ${nf.format(val)}`;
    }

    labels.appendChild(tick);
    labels.appendChild(lbl);
  });

  leftCol.appendChild(bubbles);

  let colorKey = null;
  if (metric === "top50" || metric === "top300") {
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
  if (titleEl) titleEl.textContent = cfg.legendTitle;
  if (bodyEl) {
    bodyEl.innerHTML = "";
    bodyEl.appendChild(wrapper);
  }
}

// -----------------------------------------------------------------------------
// POPUPS
// -----------------------------------------------------------------------------

function buildPopup(feature, kind) {
  const p = feature?.properties || {};
  const { lon, lat } = getFeatureCoords(feature);

  const sv = lon != null && lat != null ? streetViewURL({ lon, lat }) : null;
  const svHtml = sv
    ? `<a class="text-blue-600 hover:text-blue-900 underline font-medium"
        href="${sv}" target="_blank" rel="noopener">Open Street View</a>`
    : "Street View: —";

  if (kind === "top50") {
    const aps = safe(p["Unique APS-Code"]);
    const rank = safe(p["Risk Index Rank"]);
    const county = safe(p["County"]);
    const rteType = safe(p["Rte Type"]);
    const roadNumber = safe(p["RoadNumber"]);
    const mps = safe(p["MP's"]);
    const scoreType = safe(p["Score Type"]);
    const scoreLabel = scoreTypeLabel(scoreType);
    const scoreColor = scoreTypeColor(scoreType);

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

    return `
      <h2 class="text-xl font-bold">
        Incident ID: ${aps}<br>
        Risk Index Rank: ${rank}
      </h2>
      <p>
        Occurred in <strong>${county}</strong> County along <strong>${rteType}-${roadNumber}</strong><br>
        <br><strong>Mile Points</strong>: ${mps} &nbsp;•&nbsp; ${svHtml}
        <br><strong>Score Type</strong>: <span style="color:${scoreColor}; font-weight:700;">${scoreLabel}</span>
        <br><strong>Field Score</strong>: ${fieldScore}
        <br><strong>Criticality Score</strong>: ${criticalityScore}
        <br><strong>Risk Index</strong>: ${riskIndex}
      </p>
    `;
  }

  if (kind === "top300") {
    const aps = safe(p["Unique APS-Code"]);
    const county = safe(p["County"]);
    const scoreType = safe(p["Score Type"]);
    const scoreLabel = scoreTypeLabel(scoreType);
    const beginMP = safe(p["Begin MP"]);
    const endMP = safe(p["End MP"]);
    const ds =
      p["Normalized DS Score"] == null || p["Normalized DS Score"] === ""
        ? "—"
        : Number(p["Normalized DS Score"]).toFixed(2);

    return `
      <h2 class="text-xl font-bold">
        Incident ID: ${aps}
      </h2>
      <p>
        <strong>${scoreLabel}</strong> in <strong>${county}</strong> County
        <br><br>
        <strong>Mile Points:</strong> ${beginMP} to ${endMP} &nbsp;•&nbsp; ${svHtml}
        <br>
        <strong>LS/RF Desktop Score:</strong> ${ds}
      </p>
    `;
  }

  const aps = safe(p["Unique APS-Code"]);
  const county = safe(p["County"]);
  const route = safe(p["Route"]);
  const costVal = Number(p["Cost/Name"]);
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
  const length = safe(p["Total Distance"]);
  const occ = p.Occurrences ?? p.occurrences ?? p["db_Weighted Occurrences"];
  const pds =
    p["Norm. Pre-Desktop Score"] == null || p["Norm. Pre-Desktop Score"] === ""
      ? "—"
      : Number(p["Norm. Pre-Desktop Score"]).toFixed(2);
  const occStr = occ == null ? "—" : nf0.format(occ);
  const aadt = p.AADT == null ? "—" : nf0.format(p.AADT);

  return `
    <h2 class="text-xl font-bold">Incident ID: ${aps}</h2>
    <p>
      Landslide in ${county} County, occurred along ${route}<br>
      <br><strong>Number of Occurrences</strong>: ${occStr}
      <br><strong>Cost</strong>: ${cost}
      <br><strong>Norm. Pre-Desktop Score</strong>: ${pds}
      <br><strong>AADT</strong>: ${aadt}
      <br><strong>Total Length</strong>: ${length} miles
      <br>&emsp;From Mile Point ${minMP} to ${maxMP}
      <br><strong>Mid Mile Point</strong>: ${mp} &nbsp;•&nbsp; ${svHtml}
    </p>
  `;
}

function showPopup(feature, kind) {
  const { coords } = getFeatureCoords(feature);

  new maplibregl.Popup({ closeButton: true, offset: 10 })
    .setLngLat(coords)
    .setHTML(buildPopup(feature, kind))
    .addTo(map);
}

function buildChooserButton(feature, kind, i) {
  const p = feature?.properties || {};
  const aps = safe(p["Unique APS-Code"]);
  const scoreType = safe(p["Score Type"]);
  const scoreLabel = scoreTypeLabel(scoreType);
  const scoreColor = scoreTypeColor(scoreType);

  if (kind === "top50") {
    const rank = safe(p["Risk Index Rank"]);
    return `
      <button
        type="button"
        class="chooser-choice"
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
        <span style="color:${scoreColor}; font-weight:700;">${scoreLabel}</span>
        — ${aps}
      </button>
    `;
  }

  if (kind === "top300") {
    const ds =
      p["Normalized DS Score"] == null || p["Normalized DS Score"] === ""
        ? "—"
        : Number(p["Normalized DS Score"]).toFixed(2);

    return `
      <button
        type="button"
        class="chooser-choice"
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
        <span style="color:${scoreColor}; font-weight:700;">${scoreLabel}</span>
        — ${aps}
        <br>
        <span style="font-size:12px; color:#555;">Desktop Score: ${ds}</span>
      </button>
    `;
  }

  return "";
}

function showChooserPopup(lngLat, features, kind) {
  const html = `
    <div class="chooser-popup">
      <div style="font-weight:700; margin-bottom:8px;">
        ${features.length} records at this location
      </div>
      <div style="font-size:12px; color:#444; margin-bottom:8px;">
        Select a record to view details.
      </div>
      <div class="chooser-list">
        ${features.map((feature, i) => buildChooserButton(feature, kind, i)).join("")}
      </div>
    </div>
  `;

  const popup = new maplibregl.Popup({ closeButton: true, offset: 10 })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);

  const popupEl = popup.getElement();
  popupEl.querySelectorAll(".chooser-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.choiceIndex);
      const selectedFeature = features[i];
      popup.remove();
      showPopup(selectedFeature, kind);
    });
  });
}

// -----------------------------------------------------------------------------
// HELP MODAL
// -----------------------------------------------------------------------------

function inputProfile() {
  const anyCoarse =
    window.matchMedia?.("(any-pointer: coarse)")?.matches || false;
  const anyHover = window.matchMedia?.("(any-hover: hover)")?.matches || false;
  const uaMobile =
    navigator.userAgentData?.mobile ||
    /Mobi|Android/i.test(navigator.userAgent);
  return {
    mobileLikely: (anyCoarse && !anyHover) || uaMobile,
    hybridLikely: anyCoarse && anyHover,
    desktopLikely: !anyCoarse && anyHover,
  };
}

function buildHelpHTML() {
  const p = inputProfile();

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
  if (!force && localStorage.getItem(helpStorageKey) === "1") return;

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
    if (dontShow) localStorage.setItem(helpStorageKey, "1");
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

// -----------------------------------------------------------------------------
// DATASET SWITCHING + EVENTS
// -----------------------------------------------------------------------------

function setMetric(metric) {
  Object.values(datasets).forEach((cfg) => {
    const visible = cfg.metric === metric ? "visible" : "none";

    map.setLayoutProperty(cfg.shadow, "visibility", visible);
    map.setLayoutProperty(cfg.layer, "visibility", visible);

    if (cfg.labels) {
      map.setLayoutProperty(cfg.labels, "visibility", visible);
    }
  });
}

function attachPopup(layerId, kind) {
  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });

  map.on("click", layerId, (e) => {
    const feat = e.features?.[0];
    if (!feat) return;

    const cfg = datasets[kind];

    if (cfg.chooser) {
      const key = getFeatureKey(feat);
      const group = groupedFeatures[kind]?.get(key) || [feat];

      if (group.length > 1) {
        showChooserPopup(e.lngLat, group, kind);
        return;
      }
    }

    showPopup(feat, kind);
  });
}

// -----------------------------------------------------------------------------
// MAP LOAD
// -----------------------------------------------------------------------------

map.on("load", async () => {
  map.setPitch(55);
  map.setBearing(35);
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
  map.setTerrain({
    source: "terrainSource",
    exaggeration: 2,
  });

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

  const slidesRes = await fetch(landslidesUrl);
  if (!slidesRes.ok) {
    throw new Error(`Failed to load landslides.geojson: ${slidesRes.status}`);
  }
  const slidesGeoJSON = await slidesRes.json();

  const top50Res = await fetch(top50Url);
  if (!top50Res.ok) {
    throw new Error(
      `Failed to load top50-landslides.geojson: ${top50Res.status}`,
    );
  }
  const top50GeoJSON = await top50Res.json();

  const top300Res = await fetch(top300Url);
  if (!top300Res.ok) {
    throw new Error(`Failed to load top300 data: ${top300Res.status}`);
  }
  const top300GeoJSON = await top300Res.json();

  const top50LabelSource = map.getSource("top50-labels");
  if (top50LabelSource) {
    top50LabelSource.setData(filterTop50Labels(top50GeoJSON));
  }

  indexFeatures(top50GeoJSON, "top50");
  indexFeatures(top300GeoJSON, "top300");

  map.fitBounds(getGeoJSONBounds(slidesGeoJSON), { padding: 20, maxZoom: 12 });

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

        <label style="display:block; margin-bottom:6px;">
          <input type="radio" name="metric" value="top300">
          Top 300 LS/RF Desktop Score
        </label>

        <div class="legend_section_break">
          <span>Original Dataset</span>
        </div>

        <label style="display:block; margin-bottom:6px;">
          <input type="radio" name="metric" value="costpm">
          Cost
        </label>

        <label style="display:block;">
          <input type="radio" name="metric" value="weighted">
          Weighted Occurrences
        </label>

        <label style="display:block; margin-bottom:6px;">
          <input type="radio" name="metric" value="predesktop">
          Norm. Pre-Desktop Score
        </label>
      </div>
    `;
    document.body.appendChild(legend);
  }

  buildGraduatedLegend(map, "top50");
  setMetric("top50");

  legend.querySelectorAll('input[name="metric"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      const metric = e.target.value;
      setMetric(metric);
      buildGraduatedLegend(map, metric);
    });
  });

  showHelpModal();

  attachPopup("top50", "top50");
  attachPopup("top300", "top300");
  attachPopup("landslides-costpm", "costpm");
  attachPopup("landslides-weightedocc", "weighted");
  attachPopup("landslides-pds", "predesktop");
});

// -----------------------------------------------------------------------------
// CONTROLS
// -----------------------------------------------------------------------------

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.FullscreenControl());

map.addControl(
  new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: "imperial",
  }),
);

map.addControl(
  new maplibregl.TerrainControl({
    source: "terrainSource",
    exaggeration: 2,
  }),
);

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

map.addControl(new HelpControl(), "top-right");
