/* Under This Sky — landing background: the real sky over Port Huron,
   Michigan, right now. Same projection code path as the order pages
   (projection.js); LST from the actual clock, re-projected every 45 s so
   the sky genuinely wheels as Earth turns. Sun altitude (low-precision
   series) drives day / twilight / night rendering. */
"use strict";
const H = window.HOME, U = window.UTS;
const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SINLAT = Math.sin(H.lat * Math.PI / 180);
const COSLAT = Math.cos(H.lat * Math.PI / 180);

let W = 0, HT = 0, R = 0, CX = 0, CY = 0, twT = 0;
const TW = [];
for (let i = 0; i < H.stars.length && TW.length < 12; i++)
  if (H.stars[i][2] < 1.4) TW.push(i);
const TWSET = new Set(TW);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

function toPx(u, v) { return [CX + u * R, CY - v * R]; }

function draw() {
  const ms = Date.now();
  const lst = U.lstHours(ms, H.lon);
  const sun = U.sunEq(ms);
  const sunAlt = U.altaz(sun.ra, sun.dec, lst, SINLAT, COSLAT)[0];

  // light regime: 1 = full night (sun below -12), 0 = full day
  const night = Math.max(0, Math.min(1, -sunAlt / 12));
  const starA = 0.06 + 0.94 * night * night;
  const milkyA = Math.max(0, Math.min(1, (-sunAlt - 6) / 6));
  const warm = Math.max(0, 1 - Math.abs(sunAlt + 3) / 6);   // civil twilight

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, HT);

  // backdrop: navy, lifted blue by day, warm horizon band in twilight
  ctx.fillStyle = "#0B1026";
  ctx.fillRect(0, 0, W, HT);
  if (night < 1) {
    const lift = ctx.createLinearGradient(0, 0, 0, HT);
    lift.addColorStop(0, `rgba(74,96,158,${(0.35 * (1 - night)).toFixed(3)})`);
    lift.addColorStop(1, `rgba(46,60,104,${(0.15 * (1 - night)).toFixed(3)})`);
    ctx.fillStyle = lift;
    ctx.fillRect(0, 0, W, HT);
  }
  if (warm > 0) {
    const g = ctx.createLinearGradient(0, HT, 0, HT * 0.45);
    g.addColorStop(0, `rgba(196,124,64,${(0.4 * warm).toFixed(3)})`);
    g.addColorStop(1, "rgba(196,124,64,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HT);
  }

  // milky way: soft band + grain (compact cousin of the viewer recipe)
  if (milkyA > 0.02) {
    const paths = H.milky.map(path => {
      const pts = [];
      for (let i = 0; i < path.length; i++) {
        const [alt, az] = U.altaz(path[i][0], path[i][1], lst, SINLAT, COSLAT);
        if (alt < -4) { pts.push(null); continue; }
        const [u, v] = U.proj(alt, az);
        pts.push([...toPx(u, v), (Math.cos(i * 3 * Math.PI / 180) + 1) / 2]);
      }
      return pts;
    });
    if (H.mw)
      U.drawMW(ctx, H.mw, lst, SINLAT, COSLAT, toPx, { scale: milkyA });
    const rr = rng(424242);
    ctx.fillStyle = `rgba(237,241,255,${(0.14 * milkyA).toFixed(3)})`;
    for (let p = 0; p < paths.length; p++) {
      const pts = paths[p];
      for (let i = 0; i + 1 < pts.length; i++) {
        const A = pts[i], B = pts[i + 1];
        if (!A || !B) continue;
        const n = Math.round(1 + 3 * A[2]);
        for (let k = 0; k < n; k++) {
          const t = rr(), j = R * 0.06;
          ctx.beginPath();
          ctx.arc(A[0] + (B[0] - A[0]) * t + (rr() - 0.5) * j,
                  A[1] + (B[1] - A[1]) * t + (rr() - 0.5) * j,
                  (0.3 + rr() * 0.6) * DPR, 0, 7);
          ctx.fill();
        }
      }
    }
  }

  // constellation lines, whisper-quiet
  ctx.strokeStyle = `rgba(58,74,122,${(0.5 * night).toFixed(3)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [ia, ib] of H.lines) {
    const A = H.stars[ia], B = H.stars[ib];
    const [aA, zA] = U.altaz(A[0], A[1], lst, SINLAT, COSLAT);
    const [aB, zB] = U.altaz(B[0], B[1], lst, SINLAT, COSLAT);
    if (aA < 0 && aB < 0) continue;
    const [x1, y1] = toPx(...U.proj(aA, zA));
    const [x2, y2] = toPx(...U.proj(aB, zB));
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  }
  ctx.stroke();

  // stars
  ctx.fillStyle = "#EDF1FF";
  for (let i = 0; i < H.stars.length; i++) {
    const [ra, dec, mag] = H.stars[i];
    if (mag > 5.6) continue;
    const [alt, az] = U.altaz(ra, dec, lst, SINLAT, COSLAT);
    if (alt < 0) continue;
    const [px, py] = toPx(...U.proj(alt, az));
    const r = Math.max(0.4, Math.pow(10, -0.14 * mag) * 1.5) * DPR * 0.8;
    let a = starA * Math.min(1, 0.35 + (5.6 - mag) / 5);
    if (!REDUCED && TWSET.has(i))
      a *= 0.72 + 0.28 * Math.sin(twT * 0.0021 + i * 2.7);
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // moon with true-ish phase (visible by day too, pale)
  const m = U.moonEq(ms);
  const [mAlt, mAz] = U.altaz(m.ra, m.dec, lst, SINLAT, COSLAT);
  if (mAlt > 0) {
    const [mx, my] = toPx(...U.proj(mAlt, mAz));
    const [sAlt2, sAz2] = U.altaz(sun.ra, sun.dec, lst, SINLAT, COSLAT);
    const [sx, sy] = toPx(...U.proj(sAlt2, sAz2));
    const ang = Math.atan2(sy - my, sx - mx);
    const mr = Math.max(6, R * 0.016);
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * night;
    ctx.translate(mx, my); ctx.rotate(ang);
    ctx.beginPath(); ctx.arc(0, 0, mr, 0, 7);
    ctx.fillStyle = "#232B47"; ctx.fill();
    const rx = Math.abs(2 * m.frac - 1) * mr;
    const lit = new Path2D();
    lit.arc(0, 0, mr, -Math.PI / 2, Math.PI / 2, false);
    lit.ellipse(0, 0, rx, mr, 0, Math.PI / 2, -Math.PI / 2, m.frac < 0.5);
    ctx.fillStyle = "#F5F1E8"; ctx.fill(lit);
    ctx.restore();
  }
}

function size() {
  W = innerWidth; HT = innerHeight;
  canvas.width = W * DPR; canvas.height = HT * DPR;
  R = Math.max(W, HT) * 0.72;
  CX = W / 2; CY = HT * 0.6;
  draw();
}
addEventListener("resize", size);
size();

setInterval(draw, 45000);                       // Earth turns; so does this
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) draw();
});
if (!REDUCED) {
  let last = 0;
  (function loop(now) {
    if (now - last > 110) { twT = now; last = now; draw(); }
    requestAnimationFrame(loop);
  })(0);
}
