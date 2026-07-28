/* Under This Sky — interactive sky viewer.
   Renders the embedded SKY data (equatorial coordinates) entirely
   client-side: stars/lines are projected from RA/Dec + interpolated
   local sidereal time, so the time slider is continuous and honest.
   Zenith-centered equidistant projection, N up, E left (looking UP). */
"use strict";
const D = window.SKY;

const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");
const tip = document.getElementById("tip");
const slider = document.getElementById("time");
const tlabel = document.getElementById("tlabel");
const whenEl = document.getElementById("when");

const DPR = Math.min(window.devicePixelRatio || 1, 3);
let W = 0, H = 0, R = 0, CX = 0, CY = 0;
let view = { s: 1, x: 0, y: 0 };        // zoom scale + pan (canvas px)
let offMin = 0;                          // slider offset, minutes from t0

const LAT = D.meta.lat * Math.PI / 180;
const SINLAT = Math.sin(LAT), COSLAT = Math.cos(LAT);

/* ---------------- astronomy ---------------- */
function altaz(raH, decDeg, lstH) {
  const ha = (lstH - raH) * 15 * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const sinAlt = Math.sin(dec) * SINLAT + Math.cos(dec) * COSLAT * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const y = -Math.sin(ha) * Math.cos(dec);
  const x = Math.sin(dec) * COSLAT - Math.cos(dec) * SINLAT * Math.cos(ha);
  return [alt * 180 / Math.PI, ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360];
}
function proj(alt, az) {               // -> unit-circle coords (r=1 horizon)
  const r = (90 - alt) / 90;
  const a = az * Math.PI / 180;
  return [-r * Math.sin(a), r * Math.cos(a)];
}
function toPx(u, v) {                  // unit coords -> canvas px (view applied)
  return [CX + view.x + (u * R) * view.s,
          CY + view.y - (v * R) * view.s];
}

/* interpolate window samples (30-min grid) at current offset */
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRa(a, b, t) {             // hours, wrap-aware
  let d = b - a;
  if (d > 12) d -= 24; if (d < -12) d += 24;
  return ((a + d * t) % 24 + 24) % 24;
}
function sampleAt(off) {
  const S = D.window.samples, step = D.window.step_min;
  const f = (off - D.window.start_min) / step;
  const i = Math.max(0, Math.min(S.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  const a = S[i], b = S[i + 1];
  return {
    lst: (lerp(a.lst, b.lst + (b.lst < a.lst ? 24 : 0), t)) % 24,
    moon: { ra: lerpRa(a.moon[0], b.moon[0], t), dec: lerp(a.moon[1], b.moon[1], t),
            frac: lerp(a.moon[2], b.moon[2], t), waxing: a.moon[3] },
    sun: { ra: lerpRa(a.sun[0], b.sun[0], t), dec: lerp(a.sun[1], b.sun[1], t) },
    planets: a.planets.map((p, k) =>
      [lerpRa(p[0], b.planets[k][0], t), lerp(p[1], b.planets[k][1], t)]),
  };
}

/* ---------------- drawing ---------------- */
let hitStars = [];                     // [x, y, starIndex] for named stars
let hitSegs = [];                      // [x1,y1,x2,y2, conIndex]

function draw() {
  const s = sampleAt(offMin);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // sky disc clip
  const [hx, hy] = [CX + view.x, CY + view.y];
  const hr = R * view.s;
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.clip();
  ctx.fillStyle = "#0B1026";
  ctx.fillRect(0, 0, W, H);

  // milky way band
  ctx.strokeStyle = "rgba(37,51,94,0.55)";
  ctx.lineWidth = 14 * view.s;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const path of D.milky) {
    ctx.beginPath();
    let pen = false;
    for (const [ra, dec] of path) {
      const [alt, az] = altaz(ra, dec, s.lst);
      if (alt < -4) { pen = false; continue; }
      const [u, v] = proj(alt, az);
      const [px, py] = toPx(u, v);
      if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // constellation lines
  hitSegs = [];
  ctx.strokeStyle = "#3A4A7A";
  ctx.lineWidth = Math.max(1, 1.1 * view.s);
  ctx.beginPath();
  for (const [ia, ib, ci] of D.lines) {
    const A = D.stars[ia], B = D.stars[ib];
    const [altA, azA] = altaz(A[0], A[1], s.lst);
    const [altB, azB] = altaz(B[0], B[1], s.lst);
    if (altA < -2 && altB < -2) continue;
    const [ux, uy] = proj(altA, azA), [vx2, vy2] = proj(altB, azB);
    const [x1, y1] = toPx(ux, uy), [x2, y2] = toPx(vx2, vy2);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    hitSegs.push([x1, y1, x2, y2, ci]);
  }
  ctx.stroke();

  // stars
  hitStars = [];
  ctx.fillStyle = "#EDF1FF";
  for (let i = 0; i < D.stars.length; i++) {
    const [ra, dec, mag] = D.stars[i];
    if (mag > 5.6) continue;                     // line-anchor-only stars
    const [alt, az] = altaz(ra, dec, s.lst);
    if (alt < -0.5) continue;
    const [u, v] = proj(alt, az);
    const [px, py] = toPx(u, v);
    const r = Math.max(0.5, Math.pow(10, -0.14 * mag) * 3.2 * (R / 340)) *
              Math.sqrt(view.s);
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    if (D.names[i]) hitStars.push([px, py, i]);
  }

  // planets
  ctx.fillStyle = "#FFC24B";
  ctx.font = `${11 * Math.sqrt(view.s)}px ui-monospace, monospace`;
  s.planets.forEach((p, k) => {
    const [alt, az] = altaz(p[0], p[1], s.lst);
    if (alt < 2) return;
    const [u, v] = proj(alt, az);
    const [px, py] = toPx(u, v);
    ctx.beginPath(); ctx.arc(px, py, 2.6 * Math.sqrt(view.s), 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 5 * Math.sqrt(view.s), 0, 7);
    ctx.strokeStyle = "#FFC24B"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText(D.window.planet_names[k], px + 8, py + 4);
  });

  // moon with true phase, lit limb toward the sun
  {
    const [malt, maz] = altaz(s.moon.ra, s.moon.dec, s.lst);
    if (malt > 0) {
      const [mu, mv] = proj(malt, maz);
      const [mx, my] = toPx(mu, mv);
      const [salt2, saz2] = altaz(s.sun.ra, s.sun.dec, s.lst);
      const [su, sv] = proj(salt2, saz2);
      const [sx, sy] = toPx(su, sv);
      const ang = Math.atan2(sy - my, sx - mx);
      const mr = Math.max(7, R * 0.028) * Math.sqrt(view.s);
      ctx.save();
      ctx.translate(mx, my); ctx.rotate(ang);
      ctx.beginPath(); ctx.arc(0, 0, mr, 0, 7);
      ctx.fillStyle = "#232B47"; ctx.fill();
      const f = s.moon.frac, rx = Math.abs(2 * f - 1) * mr;
      const lit = new Path2D();
      lit.arc(0, 0, mr, -Math.PI / 2, Math.PI / 2, false);
      lit.ellipse(0, 0, rx, mr, 0, Math.PI / 2, -Math.PI / 2, f < 0.5);
      ctx.fillStyle = "#F5F1E8"; ctx.fill(lit);
      ctx.restore();
    }
  }
  ctx.restore();

  // horizon ring + cardinals
  ctx.strokeStyle = "#EDF1FF"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.stroke();
  ctx.fillStyle = "#FFC24B";
  ctx.font = `700 ${Math.max(11, R * 0.045)}px ui-monospace, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const off = hr + Math.max(10, R * 0.05);
  ctx.fillText("N", hx, hy - off); ctx.fillText("S", hx, hy + off);
  ctx.fillText("E", hx - off, hy); ctx.fillText("W", hx + off, hy);
  ctx.textAlign = "left";
}

/* ---------------- layout ---------------- */
function size() {
  const w = canvas.parentElement.clientWidth;
  const h = Math.min(Math.max(w, 300), window.innerHeight * 0.72);
  canvas.style.height = h + "px";
  canvas.width = w * DPR; canvas.height = h * DPR;
  W = w; H = h;
  R = Math.min(w, h) / 2 - Math.max(16, w * 0.05);
  CX = w / 2; CY = h / 2;
  draw();
}
window.addEventListener("resize", size);

/* ---------------- interactions ---------------- */
const ptrs = new Map();
let lastPinch = 0, moved = false;
canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  moved = false;
});
canvas.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (ptrs.size === 1) {
    const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    view.x += dx; view.y += dy; clampView(); draw();
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (lastPinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / lastPinch);
    lastPinch = d; moved = true;
  }
});
function endPtr(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) lastPinch = 0;
  if (!moved && e.type === "pointerup") tap(e.offsetX, e.offsetY);
}
canvas.addEventListener("pointerup", endPtr);
canvas.addEventListener("pointercancel", endPtr);
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

function zoomAt(px, py, k) {
  const ns = Math.max(1, Math.min(6, view.s * k));
  k = ns / view.s;
  view.x = px - CX - (px - CX - view.x) * k;
  view.y = py - CY - (py - CY - view.y) * k;
  view.s = ns; clampView(); draw();
}
function clampView() {
  if (view.s === 1) { view.x = 0; view.y = 0; return; }
  const m = R * (view.s - 1);
  view.x = Math.max(-m, Math.min(m, view.x));
  view.y = Math.max(-m, Math.min(m, view.y));
}

function tap(px, py) {
  let best = null, bd = 16 * 16;
  for (const [x, y, i] of hitStars) {
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = { kind: "star", i, x, y }; }
  }
  if (!best) {
    bd = 11 * 11;
    for (const [x1, y1, x2, y2, ci] of hitSegs) {
      const d = segDist2(px, py, x1, y1, x2, y2);
      if (d < bd) { bd = d; best = { kind: "con", ci, x: px, y: py }; }
    }
  }
  if (!best) { tip.style.display = "none"; return; }
  if (best.kind === "star") {
    const s = D.stars[best.i];
    tip.innerHTML = `<b>${D.names[best.i]}</b> <span class="sub">mag ${s[2].toFixed(1)}</span>`;
  } else {
    tip.innerHTML = `<b>${D.cons[best.ci]}</b> <span class="sub">constellation</span>`;
  }
  tip.style.left = best.x + "px"; tip.style.top = best.y + "px";
  tip.style.display = "block";
  clearTimeout(tip._t); tip._t = setTimeout(() => tip.style.display = "none", 2600);
}
function segDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return (px - qx) ** 2 + (py - qy) ** 2;
}

/* ---------------- time slider ---------------- */
function fmtTime(off) {
  const base = new Date(D.meta.t0_epoch_ms + off * 60000);
  // render in the sky's own UTC offset (fixed across the window)
  const loc = new Date(base.getTime() + D.meta.utc_offset_min * 60000);
  let h = loc.getUTCHours(), m = loc.getUTCMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
slider.addEventListener("input", () => {
  offMin = +slider.value;
  tlabel.textContent = fmtTime(offMin);
  whenEl.textContent = D.meta.date_label + " · " + fmtTime(offMin);
  draw();
});

tlabel.textContent = fmtTime(0);
size();
