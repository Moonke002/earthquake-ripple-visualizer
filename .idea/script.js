// Simple helper to keep things tidy
function $(id) {
  return document.getElementById(id);
}

// --- Canvas + DOM elements ---
const canvas = $("quakeCanvas");
const ctx = canvas.getContext("2d");

const tooltip = $("tooltip");
const statusText = $("statusText");
const mapWrapper = $("mapWrapper");

// --- Controls ---
const magSlider = $("magSlider");
const depthSlider = $("depthSlider");
const speedSlider = $("speedSlider");

const magValue = $("magValue");
const depthValue = $("depthValue");
const speedValue = $("speedValue");

const showQuakesCheckbox = $("showQuakes");
const autoRipplesCheckbox = $("autoRipples");

// Keep control labels in sync
magSlider.addEventListener("input", () => {
  magValue.textContent = Number(magSlider.value).toFixed(1);
});

depthSlider.addEventListener("input", () => {
  depthValue.textContent = depthSlider.value;
});

speedSlider.addEventListener("input", () => {
  speedValue.textContent = speedSlider.value + "x";
});

// --- World map image (equirectangular) ---
const worldMap = new Image();
worldMap.crossOrigin = "anonymous";
worldMap.src =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/World_map_-_low_resolution.svg/1024px-World_map_-_low_resolution.svg.png";

let mapLoaded = false;

worldMap.onload = () => {
  mapLoaded = true;
  statusText.textContent =
    "Loaded. Click to create ripples, drag horizontally to rotate the world.";
};

worldMap.onerror = () => {
  statusText.textContent = "Failed to load map image.";
};

// --- Horizontal “globe” rotation state ---
let mapOffsetX = 0; // offset in pixels (looping)
let isDragging = false;
let dragStartX = 0;
let initialOffsetX = 0;

function normalizeOffset() {
  const w = canvas.width;
  return ((mapOffsetX % w) + w) % w;
}

canvas.addEventListener("mousedown", (evt) => {
  const rect = canvas.getBoundingClientRect();
  const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;

  // (If we ever want to ignore top/bottom margins, we could check y here)
  isDragging = true;
  dragStartX = evt.clientX;
  initialOffsetX = mapOffsetX;
});

window.addEventListener("mouseup", () => {
  isDragging = false;
});

canvas.addEventListener("mousemove", (evt) => {
  if (!isDragging) return;
  const dx = evt.clientX - dragStartX;
  mapOffsetX = initialOffsetX + dx;
});

// --- Ripple + earthquake state ---
const ripples = [];
let recentQuakes = [];

// Each ripple:
// { baseX, baseY, radius, maxRadius, speed, lineWidth, baseColor, opacity, fromAuto }
function createRippleFromWorld(
  baseX,
  baseY,
  magnitude,
  depth,
  speedMultiplier,
  fromAuto = false
) {
  const mag = Math.max(3, Math.min(9, magnitude));
  const depthKm = Math.max(0, Math.min(700, depth));

  const magFactor = (mag - 3) / 6; // 0..1
  const depthFactor = 1 - depthKm / 700; // 1..0 (shallow quakes are “stronger”)

  const baseMaxRadius = 80;
  const extraRadius = 220;
  const maxRadius =
    baseMaxRadius + extraRadius * magFactor * (0.4 + 0.6 * depthFactor);

  const baseSpeed = 1.1;
  const rippleSpeed =
    baseSpeed * speedMultiplier * (0.6 + 0.8 * magFactor);

  const lineWidth = 2 + 3 * magFactor;
  const color = fromAuto ? "#4ade80" : "#22d3ee";

  ripples.push({
    baseX,
    baseY,
    radius: 0,
    maxRadius,
    speed: rippleSpeed,
    lineWidth,
    baseColor: color,
    opacity: 1,
    fromAuto
  });
}

// --- Fetch recent earthquakes from USGS ---
async function fetchRecentQuakes() {
  try {
    statusText.textContent = "Loading recent earthquakes (USGS)…";

    const response = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
    );

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

    const data = await response.json();

    recentQuakes = data.features.map((feature) => {
      const [lon, lat, depth] = feature.geometry.coordinates;
      const mag = feature.properties.mag;
      const place = feature.properties.place;
      const time = new Date(feature.properties.time);

      // Convert lon/lat into canvas coordinates (equirectangular)
      const baseX = ((lon + 180) / 360) * canvas.width;
      const baseY = ((90 - lat) / 180) * canvas.height;

      return { lon, lat, depth, mag, place, time, baseX, baseY };
    });

    statusText.textContent = `Loaded ${recentQuakes.length} recent earthquakes. Click the map or enable auto-ripples.`;
  } catch (err) {
    console.error(err);
    statusText.textContent = "Failed to load recent earthquakes.";
  }
}

fetchRecentQuakes();

// --- Click to create a manual ripple ---
canvas.addEventListener("click", (evt) => {
  // If this click is part of a drag, ignore it
  if (isDragging) return;

  const rect = canvas.getBoundingClientRect();
  const screenX = ((evt.clientX - rect.left) / rect.width) * canvas.width;
  const screenY = ((evt.clientY - rect.top) / rect.height) * canvas.height;

  const offset = normalizeOffset();

  // Convert from rotated “screen” x back to baseX
  let baseX = screenX - offset;
  if (baseX < 0) baseX += canvas.width;

  const magnitude = parseFloat(magSlider.value);
  const depth = parseFloat(depthSlider.value);
  const speedMult = parseFloat(speedSlider.value);

  createRippleFromWorld(baseX, screenY, magnitude, depth, speedMult, false);
});

// --- Tooltip hover near orange dots ---
canvas.addEventListener("mousemove", (evt) => {
  const rect = canvas.getBoundingClientRect();
  const screenX = ((evt.clientX - rect.left) / rect.width) * canvas.width;
  const screenY = ((evt.clientY - rect.top) / rect.height) * canvas.height;

  const offset = normalizeOffset();
  const hoverRadius = 8;
  let hovered = null;

  for (const quake of recentQuakes) {
    let quakeScreenX = quake.baseX + offset;
    if (quakeScreenX > canvas.width) quakeScreenX -= canvas.width;
    const quakeScreenY = quake.baseY;

    const dx = screenX - quakeScreenX;
    const dy = screenY - quakeScreenY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= hoverRadius + (quake.mag || 0)) {
      hovered = { quake, screenX: quakeScreenX, screenY: quakeScreenY };
      break;
    }
  }

  if (!hovered || !showQuakesCheckbox.checked) {
    tooltip.style.display = "none";
    return;
  }

  const { quake, screenX: qx, screenY: qy } = hovered;

  const wrapperRect = mapWrapper.getBoundingClientRect();
  const relX = (qx / canvas.width) * wrapperRect.width;
  const relY = (qy / canvas.height) * wrapperRect.height;

  tooltip.style.display = "block";
  tooltip.innerHTML =
    `<strong>M${quake.mag.toFixed(1)}</strong><br>` +
    `${quake.place}<br>` +
    `${quake.time.toLocaleString()}`;

  // Position tooltip near the point, but keep it inside the wrapper
  tooltip.style.left = relX + "px";
  tooltip.style.top = relY + "px";

  const tooltipWidth = tooltip.offsetWidth || 160;
  const tooltipHeight = tooltip.offsetHeight || 60;

  let left = relX + 8;
  let top = relY + 8;

  const maxLeft = wrapperRect.width - tooltipWidth - 4;
  const maxTop = wrapperRect.height - tooltipHeight - 4;

  if (left > maxLeft) left = maxLeft;
  if (top > maxTop) top = maxTop;
  if (left < 4) left = 4;
  if (top < 4) top = 4;

  tooltip.style.left = left + "px";
  tooltip.style.top = top + "px";
});

canvas.addEventListener("mouseleave", () => {
  tooltip.style.display = "none";
});

// --- Auto-ripple logic (plays through recent quakes) ---
let autoRippleIndex = 0;
let lastAutoRippleTime = 0;
const AUTO_RIPPLE_INTERVAL = 2000; // ms

function maybeSpawnAutoRipple(timestamp) {
  if (!autoRipplesCheckbox.checked || recentQuakes.length === 0) return;
  if (timestamp - lastAutoRippleTime < AUTO_RIPPLE_INTERVAL) return;

  const quake = recentQuakes[autoRippleIndex % recentQuakes.length];
  autoRippleIndex += 1;
  lastAutoRippleTime = timestamp;

  const speedMult = parseFloat(speedSlider.value);
  createRippleFromWorld(
    quake.baseX,
    quake.baseY,
    quake.mag,
    quake.depth,
    speedMult,
    true
  );
}

// --- Animation loop ---
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawFrame(timestamp) {
  requestAnimationFrame(drawFrame);

  const offset = normalizeOffset();

  // Background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mapLoaded) {
    const w = canvas.width;
    const h = canvas.height;

    const x1 = offset - w;
    const x2 = offset;

    ctx.drawImage(worldMap, x1, 0, w, h);
    ctx.drawImage(worldMap, x2, 0, w, h);
  } else {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Earthquake markers
  if (showQuakesCheckbox.checked) {
    for (const quake of recentQuakes) {
      const mag = quake.mag || 0;
      const radius = 2 + mag;

      let screenX = quake.baseX + offset;
      if (screenX > canvas.width) screenX -= canvas.width;
      const screenY = quake.baseY;

      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f97316";
      ctx.fill();
    }
  }

  // Auto ripples
  maybeSpawnAutoRipple(timestamp);

  // Ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.radius += r.speed;
    const t = r.radius / r.maxRadius;
    r.opacity = 1 - t;

    if (r.radius >= r.maxRadius || r.opacity <= 0) {
      ripples.splice(i, 1);
      continue;
    }

    let screenX = r.baseX + offset;
    if (screenX > canvas.width) screenX -= canvas.width;
    const screenY = r.baseY;

    const gradient = ctx.createRadialGradient(
      screenX,
      screenY,
      r.radius * 0.7,
      screenX,
      screenY,
      r.radius
    );

    gradient.addColorStop(0, "rgba(15,23,42,0)");
    gradient.addColorStop(1, hexToRgba(r.baseColor, r.opacity));

    ctx.beginPath();
    ctx.arc(screenX, screenY, r.radius, 0, Math.PI * 2);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = r.lineWidth;
    ctx.stroke();
  }
}

requestAnimationFrame(drawFrame);
