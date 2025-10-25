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

map.on("load", async () => {
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
  map.fitBounds(getGeoJSONBounds(slidesGeoJSON), { padding: 40, maxZoom: 12 });

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
      const occ = p.Occurrences ?? p.occurrences ?? p["Weighted Occurrences"];
      const occStr = occ == null ? "—" : nf0.format(occ);
      const aadt = p.AADT == null ? "—" : nf0.format(p.AADT);

      // Build Street View link (only if we have coordinates)
      const sv =
        lon != null && lat != null ? streetViewURL({ lon, lat }) : null;

      const svHtml = sv
        ? `<a class="text-blue-600 hover:text-blue-700 underline font-medium"
        href="${sv}" target="_blank" rel="noopener">Open Street View</a>`
        : "Street View: —";

      const html = `
    <h2 class="text-xl">Landslide ID: ${id}</h2><p>Landslide in ${county} County, occurred along ${route}<br>
     <br>Number of Occurrences: ${occ} 
     <br>Cost per Mile: ${cost}
     <br>AADT: ${aadt} 
     <br>Mile Point: ${mp} &nbsp;•&nbsp; ${svHtml}</p>
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

// // Add geolocate control to the map
// map.addControl(
//   new maplibregl.GeolocateControl({
//     positionOptions: {
//       enableHighAccuracy: true,
//     },
//     trackUserLocation: true,
//     showUserHeading: true,
//   })
// );

// Add terrain control for 3D effect
map.addControl(
  new maplibregl.TerrainControl({
    source: "terrainSource",
    exaggeration: 2,
  })
);

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
