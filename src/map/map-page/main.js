import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

/**
 * The map, running inside a WebView.
 *
 * React Native owns the data: it fetches the pins (that endpoint is
 * authenticated and the page has no token) and hands them in through
 * `window.setPins`. The page owns only the rendering.
 *
 * The basemap is fetched by the page directly, which works only because
 * /api/map/basemap has no auth check. If that ever changes, the tiles have to
 * come through React Native too.
 *
 * NO GLYPH FONTS, and therefore no place labels. Web serves Protomaps glyph
 * .pbf files from its own /public; there is nowhere equivalent to serve them
 * from inside a WebView without shipping 1.4MB of fonts in the JS bundle. The
 * geometry still answers "where were my photos taken", which is the question.
 *
 * EVERYTHING IS DRAWN ON THE GPU. The first version of this page created one
 * `maplibregl.Marker` - i.e. one DOM element - per pin, for every pin on the
 * planet, and MapLibre rewrites the transform of every live marker element on
 * every frame of every pan. Measured in Chromium at 6x CPU throttle (a stand-in
 * for a low-end Android), the same drag gesture cost 1.6s at 200 pins and 10.5s
 * at 5000, and building the markers alone cost 757ms. A clustered GeoJSON
 * source has no DOM at all: MapLibre clusters in a worker and draws circles in
 * one draw call, so cost stops tracking library size. Cluster counts are drawn
 * as sprite images generated on demand (see `styleimagemissing`) because
 * `text-field` would need glyph fonts we have nowhere to serve from.
 */
maplibregl.addProtocol("pmtiles", new Protocol().tile);

const LIGHT = { water: "#a3d0ef", earth: "#eef1de", landuse: "#c7e2a4", roads: "#ffffff", boundaries: "#b3b9bf" };
const DARK = { water: "#0d1b2a", earth: "#1c2b22", landuse: "#223a2a", roads: "#43564c", boundaries: "#3c4c42" };

const SRC = "pins";
const L_PIN = "pin-dots";
const L_CLUSTER = "pin-clusters";
const L_COUNT = "pin-counts";

/**
 * Zoom past which MapLibre stops clustering and hands back raw points.
 *
 * Files that only have an IP-derived fallback coordinate all share the SAME
 * point, so a 2000-photo upload is 2000 identical coordinates: zooming can
 * never separate them. Tapping such a cluster opens the first photo instead of
 * zooming into a pile (see `expandOrOpen`).
 */
const CLUSTER_MAX_ZOOM = 16;

function emptyStyle(dark) {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": dark ? "#0f1720" : "#e7ebef" } }],
  };
}

function basemapStyle(dark, apiBase) {
  const c = dark ? DARK : LIGHT;
  return {
    version: 8,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${apiBase}/api/map/basemap`, attribution: "© OpenStreetMap" },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.water } },
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: { "fill-color": c.earth } },
      { id: "landuse", type: "fill", source: "protomaps", "source-layer": "landuse", paint: { "fill-color": c.landuse } },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: { "fill-color": c.water } },
      { id: "roads", type: "line", source: "protomaps", "source-layer": "roads", paint: { "line-color": c.roads, "line-width": 0.7 } },
      { id: "boundaries", type: "line", source: "protomaps", "source-layer": "boundaries", paint: { "line-color": c.boundaries, "line-width": 0.5 } },
    ],
  };
}

const post = (msg) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

let map = null;
let dark = false;
/** Pins handed over before the style finished loading, replayed on load. */
let queued = null;
let sourceReady = false;

/**
 * Pins arrive as `[id, lon, lat, kind]` tuples rather than objects.
 *
 * They cross the React Native bridge as JavaScript source text, so the shape is
 * a transfer format, not a model: at 2000 pins the objects the API returns are
 * 927KB of mostly-unused file metadata, and tuples of just what the map plots
 * are a fraction of that to serialise, ship and parse.
 */
function toGeoJSON(pins) {
  const features = new Array(pins.length);
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i];
    features[i] = {
      type: "Feature",
      properties: { id: p[0], kind: p[3] === "d" ? "folder" : "file" },
      geometry: { type: "Point", coordinates: [p[1], p[2]] },
    };
  }
  return { type: "FeatureCollection", features };
}

/**
 * A cluster's count, drawn into a sprite.
 *
 * MapLibre's `text-field` needs glyph fonts, which this page has none of, so
 * the number is rasterised here and registered as an image instead. Ids look
 * like `n-23` / `n-1.2k`; MapLibre asks for whichever ones it actually needs
 * through `styleimagemissing`, so only the handful of distinct counts on screen
 * are ever drawn.
 */
function countSprite(text) {
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const font = `600 ${12 * ratio}px -apple-system, Roboto, sans-serif`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  const w = Math.max(Math.ceil(ctx.measureText(text).width) + 4 * ratio, 8 * ratio);
  const h = Math.ceil(16 * ratio);
  canvas.width = w;
  canvas.height = h;
  // Sizing the canvas resets the context, so the font has to be set again.
  const c = canvas.getContext("2d");
  c.font = font;
  c.fillStyle = "#ffffff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, w / 2, h / 2);
  return { data: c.getImageData(0, 0, w, h), ratio };
}

function addLayers() {
  const stroke = dark ? "#0f1720" : "#ffffff";
  map.addLayer({
    id: L_CLUSTER,
    type: "circle",
    source: SRC,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#706E69",
      "circle-stroke-color": stroke,
      "circle-stroke-width": 2,
      // Bigger groups read as bigger dots even before the number is legible.
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 18, 100, 21, 1000, 25],
    },
  });
  map.addLayer({
    id: L_COUNT,
    type: "symbol",
    source: SRC,
    filter: ["has", "point_count"],
    layout: {
      "icon-image": ["concat", "n-", ["get", "point_count_abbreviated"]],
      // The number belongs to its circle: never drop or shift it to avoid a
      // neighbour, or counts end up sitting on the wrong cluster.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: L_PIN,
    type: "circle",
    source: SRC,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#706E69",
      "circle-stroke-color": stroke,
      "circle-stroke-width": 2,
      "circle-radius": 7,
    },
  });
}

function ensureSource(data) {
  if (map.getSource(SRC)) {
    map.getSource(SRC).setData(data);
    return;
  }
  map.addSource(SRC, {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 60,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
  });
  addLayers();
  wireTaps();
}

/** Frame every pin, with a sensible view when there is exactly one. */
function fitTo(pins) {
  if (!map || pins.length === 0) return;
  if (pins.length === 1) {
    map.jumpTo({ center: [pins[0][1], pins[0][2]], zoom: 12 });
    return;
  }
  const b = new maplibregl.LngLatBounds();
  for (const p of pins) b.extend([p[1], p[2]]);
  map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 0 });
}

/** v5 returns promises here, v4 took callbacks. Accept either. */
function promisify(fn, ...args) {
  return new Promise((resolve, reject) => {
    let out;
    try {
      out = fn(...args, (err, value) => (err ? reject(err) : resolve(value)));
    } catch (err) {
      reject(err);
      return;
    }
    if (out && typeof out.then === "function") out.then(resolve, reject);
  });
}

/** Open whichever file a cluster is standing in for. */
function openFirstLeaf(clusterId) {
  const src = map.getSource(SRC);
  promisify(src.getClusterLeaves.bind(src), clusterId, 1, 0)
    .then((leaves) => {
      const f = leaves && leaves[0];
      if (f) post({ type: "open", id: f.properties.id, kind: f.properties.kind });
    })
    .catch(() => {});
}

function expandOrOpen(feature) {
  const clusterId = feature.properties.cluster_id;
  const src = map.getSource(SRC);
  promisify(src.getClusterExpansionZoom.bind(src), clusterId)
    .then((zoom) => {
      // Past the clustering ceiling the members share one coordinate, so zooming
      // in only produces a pile of stacked dots. Open the photo instead.
      if (!Number.isFinite(zoom) || zoom > CLUSTER_MAX_ZOOM) {
        openFirstLeaf(clusterId);
        return;
      }
      map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 350 });
    })
    .catch(() => openFirstLeaf(clusterId));
}

function wireTaps() {
  // Tapping a pin is a navigation event, and navigation belongs to the app
  // shell - the page just says which file was touched.
  map.on("click", L_PIN, (e) => {
    const f = e.features && e.features[0];
    if (f) post({ type: "open", id: f.properties.id, kind: f.properties.kind });
  });
  map.on("click", L_CLUSTER, (e) => {
    const f = e.features && e.features[0];
    if (f) expandOrOpen(f);
  });
  // The count sprite sits on top of its circle and would otherwise swallow the
  // tap that was aimed at the cluster underneath it.
  map.on("click", L_COUNT, (e) => {
    const f = e.features && e.features[0];
    if (f) expandOrOpen(f);
  });
}

window.initMap = function initMap(opts) {
  dark = !!opts.dark;
  map = new maplibregl.Map({
    container: "map",
    style: opts.hasBasemap ? basemapStyle(dark, opts.apiBase) : emptyStyle(dark),
    center: [0, 20],
    zoom: 1,
    attributionControl: false,
    // A phone map that can tilt and spin is a phone map you knock askew by
    // accident, and pitch would make the flat circles hover off their points.
    pitchWithRotate: false,
    dragRotate: false,
  });
  map.touchZoomRotate?.disableRotation();

  map.on("styleimagemissing", (e) => {
    if (!e.id || e.id.indexOf("n-") !== 0 || map.hasImage(e.id)) return;
    const { data, ratio } = countSprite(e.id.slice(2));
    map.addImage(e.id, data, { pixelRatio: ratio });
  });

  map.on("load", () => {
    sourceReady = true;
    if (queued) {
      const { pins, shouldFit } = queued;
      queued = null;
      window.setPins(pins, shouldFit);
    }
    post({ type: "ready" });
  });
  // A missing or broken basemap must not take the pins down with it.
  map.on("error", () => post({ type: "styleerror" }));
};

window.setPins = function setPins(pins, shouldFit) {
  if (!map) return;
  // Pins can arrive before the style is up (the fetch is often quicker than
  // parsing a megabyte of MapLibre). Holding them is the difference between a
  // slow map and an empty one.
  if (!sourceReady) {
    queued = { pins, shouldFit };
    return;
  }
  ensureSource(toGeoJSON(pins));
  if (shouldFit) fitTo(pins);
};
