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
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let showLabels = false;
let hlCon = -1, hlUntil = 0;            // gold-highlighted constellation
let twinkleT = 0;
const TWINKLE = [];                     // indices of the brightest stars
for (let i = 0; i < D.stars.length && TWINKLE.length < 14; i++)
  if (D.stars[i][2] < 1.4) TWINKLE.push(i);
const TWSET = new Set(TWINKLE);

const LAT = D.meta.lat * Math.PI / 180;
const SINLAT = Math.sin(LAT), COSLAT = Math.cos(LAT);

/* ---------------- astronomy (shared code path: projection.js) ----------- */
function altaz(raH, decDeg, lstH) {
  return UTS.altaz(raH, decDeg, lstH, SINLAT, COSLAT);
}
const proj = UTS.proj;
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

/* ---------------- milky way pre-render ----------------
   Drawn once per (lst, zoom-bucket) into an offscreen canvas in unit-sky
   space, then composited each frame — layered glow + seeded star-grain,
   density-weighted toward the galactic core. */
const MW = { canvas: document.createElement("canvas"),
             band: document.createElement("canvas"),   // isophotes, pre-blur
             extent: 1.05, key: null };
const MW_BOOST = Math.min(6, Math.max(0,
  parseFloat(new URLSearchParams(location.search).get("mw")) || 1));
const LIGHT = (D.meta.theme === "minimal");
document.documentElement.dataset.theme = LIGHT ? "light" : "dark";
const GROUND = LIGHT ? "#FBFAF7" : "#0B1026";   // the disc's own fill
const INK = LIGHT ? "#20242E" : "#EDF1FF";

function mwRng(seed) {
  let s0 = seed >>> 0 || 1;
  return () => ((s0 = (s0 * 1103515245 + 12345) >>> 0) / 4294967296);
}

function ensureMilky(lst) {
  const zb = Math.min(3, Math.max(1, Math.round(view.s)));   // zoom bucket
  const key = lst.toFixed(2) + ":" + zb + ":" + R;
  if (MW.key === key) return;
  MW.key = key;
  const Q = Math.min(2048, Math.ceil(R * DPR * MW.extent * 2 * Math.min(zb, 2)));
  MW.canvas.width = MW.canvas.height = Q;
  const g = MW.canvas.getContext("2d");
  g.clearRect(0, 0, Q, Q);
  const toQ = (u, v) => [(u + MW.extent) / (2 * MW.extent) * Q,
                         (MW.extent - v) / (2 * MW.extent) * Q];
  // project each band path; remember per-point galactic longitude (idx*3)
  const paths = D.milky.map(path => {
    const pts = [];
    for (let i = 0; i < path.length; i++) {
      const [alt, az] = altaz(path[i][0], path[i][1], lst);
      if (alt < -6) { pts.push(null); continue; }
      const [u, v] = proj(alt, az);
      pts.push([...toQ(u, v), (Math.cos(i * 3 * Math.PI / 180) + 1) / 2]);
    }
    return pts;
  });
  const px1 = Q / (2 * MW.extent);          // px per unit coord
  const baseW = px1 * 0.055;
  g.lineJoin = g.lineCap = "round";
  // isophote fills (Bortle 2-3 calibration): faint nested levels, the
  // Great Rift articulated by the evenodd holes — barely above background.
  //
  // The levels are nested constant-alpha fills, so every contour boundary is
  // a one-pixel brightness step by construction. Composited straight onto the
  // layer the dark-theme stack runs 11 -> 16.3 -> 22.4 -> 29.8 -> 39.0 in R:
  // four steps of 5-9 levels. That is the same terracing that printed as
  // contour lines across the poster (gen/starmap.py, commit 723a4f4), a few
  // times milder — but Mach banding makes low-contrast edges on a smooth dark
  // field read worse than the numbers suggest. So the band goes to its own
  // canvas, gets blurred, and is composited as a glow. The grain below is
  // drawn afterwards and stays crisp, which is the point of it.
  if (D.mw) {
    const toQpx = (u, v) => toQ(u, v);
    if (MW.band.width !== Q) MW.band.width = MW.band.height = Q;
    const bg = MW.band.getContext("2d");
    bg.clearRect(0, 0, Q, Q);
    UTS.drawMW(bg, D.mw, lst, SINLAT, COSLAT, toQpx, {
      // ?mw=<n> scales the glow. The calibration is Bortle 2-3, i.e. "the
      // last thing you notice", which is honest but fragile: on a phone OLED
      // the band can read as a smudge, and the Great Rift's evenodd holes can
      // look like the whole thing is inverted. Undocumented knob so the
      // brightness can be judged on a real device instead of by argument.
      alphas: (LIGHT ? [0.026, 0.030, 0.036, 0.042]
                     : [0.026, 0.030, 0.036, 0.044]).map(a => a * MW_BOOST),
      colors: LIGHT
        ? [[44, 50, 66], [44, 50, 66], [44, 50, 66], [44, 50, 66]]
        : undefined,
    });
    g.save();
    // same proportional radius as the print fix; "filter" is absent on a few
    // old mobile browsers, where compositing unblurred is the current look
    if ("filter" in g) g.filter = `blur(${(px1 * 0.022).toFixed(2)}px)`;
    g.drawImage(MW.band, 0, 0);
    g.restore();
  }
  // 2: fine grain — faint unresolved-star speckles seeded deterministically
  const rnd = mwRng(987654321 ^ Math.round(lst * 100));
  for (let p = 0; p < paths.length; p++) {
    const edge = Math.abs(p - (paths.length - 1) / 2) / ((paths.length - 1) / 2);
    const pts = paths[p];
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const A = pts[i], B = pts[i + 1];
      if (!A || !B) continue;
      const core = A[2];
      const n = Math.round((1 - 0.6 * edge) * (1 + 4 * core) * 1.4);
      for (let k = 0; k < n; k++) {
        const t = rnd();
        const jx = (rnd() - 0.5) * baseW * 2.6 * (1 - 0.4 * edge);
        const jy = (rnd() - 0.5) * baseW * 2.6 * (1 - 0.4 * edge);
        const x = A[0] + (B[0] - A[0]) * t + jx;
        const y = A[1] + (B[1] - A[1]) * t + jy;
        const a = (0.07 + 0.23 * rnd()) * (0.4 + 0.6 * core);
        g.fillStyle = LIGHT ? `rgba(40,46,62,${(a * 0.8).toFixed(3)})`
                            : `rgba(237,241,255,${a.toFixed(3)})`;
        const r = (0.4 + rnd() * 0.7) * DPR * 0.6;
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    }
  }
}

/* ---------------- drawing ---------------- */
let hitStars = [];                     // [x, y, starIndex] for named stars
let hitSegs = [];                      // [x1,y1,x2,y2, conIndex]
let hitShowers = [];                   // [x, y, showerIndex]

function draw() {
  const s = sampleAt(offMin);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // sky disc clip
  const [hx, hy] = [CX + view.x, CY + view.y];
  const hr = R * view.s;
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.clip();
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  // milky way: pre-rendered luminous band, composited (fast pan/zoom)
  ensureMilky(s.lst);
  {
    const ext = MW.extent * R * view.s;
    ctx.drawImage(MW.canvas, hx - ext, hy - ext, ext * 2, ext * 2);
  }

  // constellation lines (highlighted one drawn separately in gold)
  hitSegs = [];
  const hlOn = hlCon >= 0 && performance.now() < hlUntil;
  const hlSegs = [], conAcc = {};
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
    if (hlOn && ci === hlCon) hlSegs.push([x1, y1, x2, y2]);
    else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    hitSegs.push([x1, y1, x2, y2, ci]);
    if (showLabels) {
      (conAcc[ci] = conAcc[ci] || [0, 0, 0]);
      conAcc[ci][0] += x1 + x2; conAcc[ci][1] += y1 + y2; conAcc[ci][2] += 2;
    }
  }
  ctx.stroke();
  if (hlSegs.length) {
    ctx.strokeStyle = "#FFC24B";
    ctx.lineWidth = Math.max(1.6, 1.8 * view.s);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of hlSegs) {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }
  if (showLabels) {
    ctx.fillStyle = "rgba(123,134,164,0.85)";
    ctx.font = `${Math.max(9, 10 * Math.sqrt(view.s))}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    for (const ci in conAcc) {
      const [sx, sy, n] = conAcc[ci];
      ctx.fillText(D.cons[ci].toUpperCase(), sx / n, sy / n);
    }
    ctx.textAlign = "left";
  }

  // meteor-shower radiants: marker + short outward streaks
  hitShowers = [];
  for (let k = 0; k < (D.meta.showers || []).length; k++) {
    const sh = D.meta.showers[k];
    const [alt, az] = altaz(sh.ra, sh.dec, s.lst);
    if (alt < -2) continue;
    const [u, v] = proj(alt, az);
    const [px, py] = toPx(u, v);
    const sc = Math.sqrt(view.s);
    ctx.strokeStyle = "rgba(255,194,75,0.5)";
    ctx.lineWidth = 1.2;
    for (let a = 0; a < 6; a++) {
      const th = a * Math.PI / 3 + 0.35;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(th) * 7 * sc, py + Math.sin(th) * 7 * sc);
      ctx.lineTo(px + Math.cos(th) * 15 * sc, py + Math.sin(th) * 15 * sc);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,194,75,0.9)";
    ctx.beginPath(); ctx.arc(px, py, 1.8 * sc, 0, 7); ctx.fill();
    hitShowers.push([px, py, k]);
  }

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
    // atmospheric extinction: stars genuinely dim toward the horizon
    const ext = alt < 24 ? 0.52 + 0.48 * Math.max(0, alt) / 24 : 1;
    const tw = (!REDUCED && TWSET.has(i))
      ? 0.72 + 0.28 * Math.sin(twinkleT * 0.0021 + i * 2.7) : 1;
    ctx.globalAlpha = ext * tw;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    if (D.names[i]) hitStars.push([px, py, i]);
  }

  // planets
  ctx.fillStyle = "#FFC24B";
  ctx.font = `${11 * Math.sqrt(view.s)}px ui-monospace, monospace`;
  // Planets sit along the ecliptic, so a conjunction puts several of them
  // within a few pixels of each other and the labels print as an unreadable
  // pile — worst from Mars, where Earth is the one label everyone looks for
  // and it lands in the middle of the heap. Track what has been placed and
  // give each label the first free slot: either side, then nudged vertically.
  const labelBoxes = [];
  const lineH = 12 * Math.sqrt(view.s);
  s.planets.forEach((p, k) => {
    const [alt, az] = altaz(p[0], p[1], s.lst);
    if (alt < 2) return;
    const [u, v] = proj(alt, az);
    const [px, py] = toPx(u, v);
    ctx.beginPath(); ctx.arc(px, py, 2.6 * Math.sqrt(view.s), 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 5 * Math.sqrt(view.s), 0, 7);
    ctx.strokeStyle = "#FFC24B"; ctx.lineWidth = 1; ctx.stroke();

    const lbl = D.window.planet_names[k];
    const lw = ctx.measureText(lbl).width, gap = 8;
    const inDisc = (x, y) => Math.hypot(x - hx, y - hy) < hr - 3;
    const hits = (b) => labelBoxes.some(o =>
      b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

    for (const dy of [0, -lineH, lineH, -2 * lineH, 2 * lineH,
                      -3 * lineH, 3 * lineH]) {
      let done = false;
      for (const side of [1, -1]) {
        const x = px + side * gap, y = py + 4 + dy;
        const box = side > 0 ? [x, y - 9, x + lw, y + 3]
                             : [x - lw, y - 9, x, y + 3];
        if (!inDisc(box[0], y) || !inDisc(box[2], y) || hits(box)) continue;
        // a nudged label has drifted off its dot, so tie it back with a hairline
        if (dy !== 0) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,194,75,0.45)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px + side * 5, py);
          ctx.lineTo(x - side * 2, y - 3); ctx.stroke();
          ctx.restore();
        }
        ctx.textAlign = side > 0 ? "left" : "right";
        ctx.fillText(lbl, x, y);
        ctx.textAlign = "left";
        labelBoxes.push(box);
        done = true;
        break;
      }
      if (done) break;
    }
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
  // horizon vignette inside the disc: the sky deepens toward the horizon,
  // which is both true (extinction/airglow) and what lifts the disc off the page
  {
    const vg = ctx.createRadialGradient(hx, hy, hr * 0.68, hx, hy, hr);
    vg.addColorStop(0, LIGHT ? "rgba(180,186,200,0)" : "rgba(4,6,12,0)");
    vg.addColorStop(1, LIGHT ? "rgba(150,158,178,0.30)" : "rgba(3,5,10,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
  }
  ctx.restore();

  // rim: soft outer glow, then a crisp hairline horizon
  ctx.save();
  if (!LIGHT) {
    ctx.strokeStyle = "rgba(122,158,255,0.30)";
    ctx.shadowColor = "rgba(120,158,255,0.55)"; ctx.shadowBlur = 16;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(237,241,255,0.10)"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(hx, hy, hr + 3.5, 0, 7); ctx.stroke();
  }
  ctx.strokeStyle = LIGHT ? "rgba(32,36,46,0.45)" : "rgba(237,241,255,0.72)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 7); ctx.stroke();
  ctx.restore();

  // cardinals, set outside the ring — N in gold, the rest quiet
  const cf = Math.max(10, R * 0.042);
  ctx.font = `600 ${cf}px ui-monospace, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
  const off = hr + Math.max(12, R * 0.062);
  ctx.fillStyle = "#FFC24B";
  ctx.fillText("N", hx, hy - off);
  ctx.fillStyle = LIGHT ? "rgba(107,114,133,0.9)" : "rgba(123,134,164,0.92)";
  ctx.fillText("S", hx, hy + off);
  ctx.fillText("E", hx - off, hy); ctx.fillText("W", hx + off, hy);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

/* ---------------- layout ---------------- */
function size() {
  const w = canvas.parentElement.clientWidth;
  // square stage: a circle wants a square, and it keeps the controls in view
  const h = Math.max(280, Math.min(w, window.innerHeight * 0.58));
  canvas.style.height = h + "px";
  canvas.width = w * DPR; canvas.height = h * DPR;
  W = w; H = h;
  R = Math.min(w, h) / 2 - Math.max(19, w * 0.076);   // room for cardinals
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
  for (const [x, y, k] of hitShowers) {
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < 15 * 15 && (!best || d < bd)) { bd = d; best = { kind: "shower", k, x, y }; }
  }
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
  if (best.kind === "shower") {
    const sh = D.meta.showers[best.k];
    tip.innerHTML = `<b>${sh.name}</b> <span class="sub">meteor radiant · peak ${sh.peak}</span>`;
  } else if (best.kind === "star") {
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

/* ---------------- story strip, fly-to, toggles ---------------- */
const strip = document.getElementById("strip");
const stripNote = document.getElementById("stripnote");
const labelsBtn = document.getElementById("labelsbtn");
const copyBtn = document.getElementById("copybtn");

function showNote(html) {
  stripNote.innerHTML = html;
  stripNote.style.display = "block";
  clearTimeout(stripNote._t);
  stripNote._t = setTimeout(() => stripNote.style.display = "none", 7000);
}

function conIndex(name) { return D.cons.indexOf(name); }
function conCentroidUV(ci, lst) {
  let su = 0, sv = 0, n = 0;
  for (const [ia, ib, c] of D.lines) {
    if (c !== ci) continue;
    for (const idx of [ia, ib]) {
      const [alt, az] = altaz(D.stars[idx][0], D.stars[idx][1], lst);
      if (alt < 0) continue;
      const [u, v] = proj(alt, az);
      su += u; sv += v; n++;
    }
  }
  return n ? { u: su / n, v: sv / n, n } : null;
}

function flyTo(u, v) {
  const s1 = Math.max(view.s, 2.2);
  const tx = -u * R * s1, ty = v * R * s1;
  if (REDUCED) {
    view.s = s1; view.x = tx; view.y = ty; clampView(); draw(); return;
  }
  const from = { ...view }, t0 = performance.now(), dur = 500;
  (function step(now) {
    const t = Math.min(1, (now - t0) / dur), e = t * (2 - t);   // easeOut
    view.s = from.s + (s1 - from.s) * e;
    view.x = from.x + (tx - from.x) * e;
    view.y = from.y + (ty - from.y) * e;
    clampView(); draw();
    if (t < 1) requestAnimationFrame(step);
  })(t0);
}

function chip(ico, label, onTap) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "card";
  b.innerHTML = (ico ? `<span class="ico">${ico}</span>` : "") +
                `<span>${label}</span>`;
  b.addEventListener("click", onTap);
  strip.appendChild(b);
}

/* the moon drawn at its actual phase — same geometry as the chart and the
   printed poster, so the card tells the truth instead of picking an emoji */
function moonIcon(frac, waxing) {
  const r = 7, rx = (Math.abs(2 * frac - 1) * r).toFixed(2);
  const sweep = frac < 0.5 ? 1 : 0;
  const lit = `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} ` +
              `A ${rx} ${r} 0 0 ${sweep} 0 ${-r} Z`;
  return `<svg width="17" height="17" viewBox="-9 -9 18 18" aria-hidden="true">
    <g${waxing ? "" : ' transform="scale(-1,1)"'}>
      <circle r="${r}" fill="#232B47" stroke="rgba(237,241,255,.22)"
              stroke-width=".7"/>
      ${frac > 0.02 ? `<path d="${lit}" fill="#F5F1E8"/>` : ""}
    </g></svg>`;
}
const PLANET_ICON = `<svg width="16" height="16" viewBox="-8 -8 16 16"
  aria-hidden="true"><circle r="2.6" fill="#FFC24B"/>
  <circle r="5.2" fill="none" stroke="#FFC24B" stroke-width=".9"
          opacity=".55"/></svg>`;
/* the Sun, unmistakably itself — the ☉ glyph reads too close to the planet
   marker at card size */
const SUN_ICON = (() => {
  let rays = "";
  for (let a = 0; a < 8; a++) {
    const th = a * Math.PI / 4;
    rays += `<line x1="${(Math.cos(th) * 4.6).toFixed(2)}"
      y1="${(Math.sin(th) * 4.6).toFixed(2)}"
      x2="${(Math.cos(th) * 7.6).toFixed(2)}"
      y2="${(Math.sin(th) * 7.6).toFixed(2)}"/>`;
  }
  return `<svg width="17" height="17" viewBox="-9 -9 18 18" aria-hidden="true">
    <g stroke="#FFC24B" stroke-width="1.1" stroke-linecap="round"
       opacity=".85">${rays}</g>
    <circle r="3.1" fill="#FFC24B"/></svg>`;
})();
const RADIANT_ICON = (() => {
  let rays = "";
  for (let a = 0; a < 6; a++) {
    const th = a * Math.PI / 3 + 0.35;
    rays += `<line x1="${(Math.cos(th) * 3.4).toFixed(2)}"
      y1="${(Math.sin(th) * 3.4).toFixed(2)}"
      x2="${(Math.cos(th) * 7.4).toFixed(2)}"
      y2="${(Math.sin(th) * 7.4).toFixed(2)}"/>`;
  }
  return `<svg width="17" height="17" viewBox="-9 -9 18 18" aria-hidden="true">
    <g stroke="#FFC24B" stroke-width="1.1" opacity=".8">${rays}</g>
    <circle r="1.7" fill="#FFC24B"/></svg>`;
})();

(function buildStrip() {
  const s0 = sampleAt(0);
  // moon
  const phaseName = (D.meta.events[0] || "Moon").split(" · ")[0];
  chip(moonIcon(s0.moon.frac, !!s0.moon.waxing),
       `${phaseName} · ${Math.round(s0.moon.frac * 100)}%`, () => {
    const s = sampleAt(offMin);
    const [alt, az] = altaz(s.moon.ra, s.moon.dec, s.lst);
    if (alt > 0) { const [u, v] = proj(alt, az); flyTo(u, v); }
    else showNote("The Moon was below the horizon at this hour — " +
                  "slide through the night to catch it rising or setting.");
  });
  // planets above the horizon at t0
  D.window.planet_names.forEach((name, k) => {
    const [alt] = altaz(s0.planets[k][0], s0.planets[k][1], s0.lst);
    if (alt < 2) return;
    chip(PLANET_ICON, name, () => {
      const s = sampleAt(offMin);
      const [alt2, az2] = altaz(s.planets[k][0], s.planets[k][1], s.lst);
      if (alt2 > 0) { const [u, v] = proj(alt2, az2); flyTo(u, v); }
      else showNote(`${name} had set by this hour — try an earlier time.`);
    });
  });
  // meteor showers
  (D.meta.showers || []).forEach((sh, k) => {
    chip(RADIANT_ICON, sh.name, () => {
      const s = sampleAt(offMin);
      const [alt, az] = altaz(sh.ra, sh.dec, s.lst);
      showNote(`<b>${sh.name}</b> — active that night, peaking ${sh.peak}. ` +
               (alt > 0 ? "Its radiant is the gold starburst on the chart."
                        : "Its radiant was below the horizon at this hour."));
      if (alt > 0) { const [u, v] = proj(alt, az); flyTo(u, v); }
    });
  });
  // western zodiac
  if (D.meta.zodiac) {
    const z = D.meta.zodiac;
    const zico = z.glyph === "☉" ? SUN_ICON : (z.glyph || null);
    chip(zico, z.text || z.label, () => {
      const ci = conIndex(z.target);
      const s = sampleAt(offMin);
      const c = ci >= 0 ? conCentroidUV(ci, s.lst) : null;
      let extra = "";
      if (c) {
        hlCon = ci; hlUntil = performance.now() + 3200;
        flyTo(c.u, c.v);
        setTimeout(draw, 3300);
      } else {
        extra = ` ${z.target} itself was below the horizon at this hour.`;
      }
      showNote(z.tip + extra);
    });
  }
  // chinese zodiac
  if (D.meta.chinese) {
    const c = D.meta.chinese;
    const jk = D.window.planet_names.indexOf("Jupiter");
    chip(c.hanzi, c.label, () => {
      let extra = "";
      if (jk >= 0) {
        const s = sampleAt(offMin);
        const [alt, az] = altaz(s.planets[jk][0], s.planets[jk][1], s.lst);
        if (alt > 0) { const [u, v] = proj(alt, az); flyTo(u, v); }
        else extra = " Jupiter was beneath the horizon at this hour.";
      }
      showNote(c.tip + extra);
    });
  }
})();

labelsBtn.addEventListener("click", () => {
  showLabels = !showLabels;
  labelsBtn.setAttribute("aria-pressed", showLabels ? "true" : "false");
  draw();
});

copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = location.href; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove();
  }
  copyBtn.textContent = "Copied ✓";
  setTimeout(() => copyBtn.textContent = "Copy link to this sky", 1600);
});

tlabel.textContent = fmtTime(0);
size();

/* gentle twinkle loop (skipped entirely under prefers-reduced-motion) */
if (!REDUCED) {
  let last = 0;
  (function loop(now) {
    if (now - last > 80) { twinkleT = now; last = now; draw(); }
    requestAnimationFrame(loop);
  })(0);
}
