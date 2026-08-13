/* Under This Sky — shared sky math.
   One code path for every page: the order-page viewer and the landing
   page both project through these functions. Angles: RA in hours, Dec in
   degrees, LST in hours. Low-precision solar/lunar positions are
   Meeus-style truncated series — background-grade (arcminutes), no
   ephemeris files needed client-side. */
"use strict";
(function () {
  const RAD = Math.PI / 180;

  function altaz(raH, decDeg, lstH, sinLat, cosLat) {
    const ha = (lstH - raH) * 15 * RAD;
    const dec = decDeg * RAD;
    const sinAlt = Math.sin(dec) * sinLat +
                   Math.cos(dec) * cosLat * Math.cos(ha);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const y = -Math.sin(ha) * Math.cos(dec);
    const x = Math.sin(dec) * cosLat - Math.cos(dec) * sinLat * Math.cos(ha);
    return [alt / RAD, ((Math.atan2(y, x) / RAD) + 360) % 360];
  }

  function proj(alt, az) {           // zenith-centered equidistant, E left
    const r = (90 - alt) / 90;
    const a = az * RAD;
    return [-r * Math.sin(a), r * Math.cos(a)];
  }

  function jd(ms) { return ms / 86400000 + 2440587.5; }

  function gmstHours(ms) {           // IAU 1982-style linear GMST
    const d = jd(ms) - 2451545.0;
    return (((280.46061837 + 360.98564736629 * d) % 360) + 360) % 360 / 15;
  }

  function lstHours(ms, lonDeg) {
    return ((gmstHours(ms) + lonDeg / 15) % 24 + 24) % 24;
  }

  function obliquity(T) { return (23.4392911 - 0.0130042 * T) * RAD; }

  function eclToEq(lonDeg, latDeg, T) {
    const e = obliquity(T), l = lonDeg * RAD, b = latDeg * RAD;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e) -
                          Math.tan(b) * Math.sin(e), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(e) +
                          Math.cos(b) * Math.sin(e) * Math.sin(l));
    return [((ra / RAD + 360) % 360) / 15, dec / RAD];
  }

  function sunEq(ms) {               // Meeus ch.25, low precision
    const T = (jd(ms) - 2451545.0) / 36525;
    const L0 = 280.46646 + 36000.76983 * T;
    const M = (357.52911 + 35999.05029 * T) * RAD;
    const C = (1.914602 - 0.004817 * T) * Math.sin(M) +
              0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    const lon = ((L0 + C) % 360 + 360) % 360;
    const [ra, dec] = eclToEq(lon, 0, T);
    return { ra, dec, lon };
  }

  function moonEq(ms) {              // Meeus ch.47, leading terms only
    const T = (jd(ms) - 2451545.0) / 36525;
    const Lp = 218.3164477 + 481267.88123421 * T;
    const D = (297.8501921 + 445267.1114034 * T) * RAD;
    const M = (357.5291092 + 35999.0502909 * T) * RAD;
    const Mp = (134.9633964 + 477198.8675055 * T) * RAD;
    const F = (93.2720950 + 483202.0175233 * T) * RAD;
    const lon = Lp + 6.288774 * Math.sin(Mp) +
      1.274027 * Math.sin(2 * D - Mp) + 0.658314 * Math.sin(2 * D) +
      0.213618 * Math.sin(2 * Mp) - 0.185116 * Math.sin(M) -
      0.114332 * Math.sin(2 * F);
    const lat = 5.128122 * Math.sin(F) + 0.280602 * Math.sin(Mp + F) +
      0.277693 * Math.sin(Mp - F);
    const [ra, dec] = eclToEq(((lon % 360) + 360) % 360, lat, T);
    const elong = ((lon - sunEq(ms).lon) % 360 + 360) % 360;
    return { ra, dec,
             frac: (1 - Math.cos(elong * RAD)) / 2,
             waxing: elong < 180 };
  }

  /* ---- Milky Way ------------------------------------------------------

     Rasterised from a galactic-frame master rather than filled as polygons
     in the sky frame, and the reason is worth recording because two
     plausible-looking fixes failed before this one.

     The sky-frame projection r = (90-alt)/90 is only injective on the
     visible hemisphere. Extended over the whole sphere it blows the nadir
     up into the entire circle r = 2, so any region containing the nadir
     touches that boundary and evenodd fills its complement. Over Port Huron
     on 2026-08-13 the band was right at 9:25pm and inverted by 10:05pm,
     purely because the Milky Way had swung underfoot. Detecting that after
     the fact does not work: deciding by claimed area misfires when a faint
     level genuinely covers about half the visible sky (seen as a flicker
     while scrubbing time), and testing whether the nadir is inside the
     region is wrong too, because for a band whose complement is two polar
     caps the parity depends on the whole nesting, not on one point.

     So the degeneracy is removed instead of compensated for. The isophotes
     are drawn once into a master image in a frame centred on the north
     galactic pole. That frame has the same degeneracy at its own rim — the
     south galactic pole — but the Milky Way never contains either galactic
     pole, so there evenodd is unconditionally correct. At draw time each
     output pixel's direction is rotated into galactic coordinates and the
     master is sampled. No polygons, no clipping, no wrap-around rings and
     no nadir at run time, so the whole class of bug is gone rather than
     patched. */

  const RAD2 = Math.PI / 180;
  const NGP_RA = 192.85948 * RAD2, NGP_DEC = 27.12825 * RAD2,
        L_NCP = 122.93192 * RAD2;
  function galactic(raH, decDeg) {
    const ra = raH * 15 * RAD2, dec = decDeg * RAD2;
    const sb = Math.sin(dec) * Math.sin(NGP_DEC) +
               Math.cos(dec) * Math.cos(NGP_DEC) * Math.cos(ra - NGP_RA);
    const b = Math.asin(Math.max(-1, Math.min(1, sb)));
    const l = L_NCP - Math.atan2(
      Math.cos(dec) * Math.sin(ra - NGP_RA),
      Math.sin(dec) * Math.cos(NGP_DEC) -
      Math.cos(dec) * Math.sin(NGP_DEC) * Math.cos(ra - NGP_RA));
    return [l, b / RAD2];
  }

  /* J2000 equatorial -> galactic rotation. */
  const GAL = [[-0.054875560, -0.873437090, -0.483835020],
               [ 0.494109430, -0.444829600,  0.746982180],
               [-0.867666150, -0.198076370,  0.455983820]];
  function mul3(A, B) {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
    return C;
  }

  /* The master: level index (0 = none, 1..n = which isophote) over a disc
     where the north galactic pole is the centre and the south pole the rim. */
  const MASTER = 1024;
  let master = null;
  function buildMaster(levels) {
    const S = MASTER, half = S / 2, scale = half / 2;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#000";
    g.fillRect(0, 0, S, S);
    for (let li = 0; li < levels.length; li++) {
      const v = li + 1;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      for (const ring of levels[li]) {
        for (let i = 0; i < ring.length; i++) {
          const [l, b] = galactic(ring[i][0], ring[i][1]);
          const r = (90 - b) / 90;
          const x = half + scale * r * Math.cos(l);
          const y = half + scale * r * Math.sin(l);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
      }
      g.fill("evenodd");
    }
    const px = g.getImageData(0, 0, S, S).data;
    const data = new Uint8Array(S * S);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = px[j];
    return { data, size: S, half, scale };
  }

  /* Radial LUT: altitude is a function of r alone, so the trig is shared. */
  const LUT_N = 2048;
  const LUT_S = new Float32Array(LUT_N + 1), LUT_C = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const t = (i / LUT_N) * Math.PI / 2;      // r * pi/2
    LUT_S[i] = Math.sin(t);                   // cos(alt)
    LUT_C[i] = Math.cos(t);                   // sin(alt)
  }

  /* Paint the band into a size x size canvas spanning [-extent, extent] in
     sky-disc units, ready to be blurred and composited by the caller. */
  function mwRaster(levels, lstH, sinLat, cosLat, size, extent, opts) {
    if (!master) master = buildMaster(levels);
    const alphas = opts.alphas || [0.026, 0.030, 0.036, 0.044];
    const colors = opts.colors ||
      [[214, 224, 250], [220, 228, 250], [228, 232, 248], [238, 236, 226]];
    const scaleA = opts.scale || 1;
    // composite each level index down to one RGBA, matching what stacked
    // source-over fills used to produce
    const n = levels.length;
    const LR = new Float32Array(n + 1), LG = new Float32Array(n + 1),
          LB = new Float32Array(n + 1), LA = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let li = 0; li < k; li++) {
        const [cr, cg, cb] = colors[Math.min(li, colors.length - 1)];
        const av = Math.min(1, alphas[Math.min(li, alphas.length - 1)] * scaleA);
        r = cr * av + r * (1 - av);
        g = cg * av + g * (1 - av);
        b = cb * av + b * (1 - av);
        a = av + a * (1 - av);
      }
      LR[k] = r; LG[k] = g; LB[k] = b; LA[k] = a;
    }
    // horizon [N,E,U] -> equatorial -> galactic, composed once
    const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const sp = Math.sin(lat), cp = Math.cos(lat);
    const th = lstH * 15 * RAD2, st = Math.sin(th), ct = Math.cos(th);
    const P = [[-sp, 0, cp], [0, -1, 0], [cp, 0, sp]];
    const R = [[ct, st, 0], [st, -ct, 0], [0, 0, 1]];
    const M = mul3(GAL, mul3(R, P));
    const m00 = M[0][0], m01 = M[0][1], m02 = M[0][2],
          m10 = M[1][0], m11 = M[1][1], m12 = M[1][2],
          m20 = M[2][0], m21 = M[2][1], m22 = M[2][2];

    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const octx = cv.getContext("2d");
    const out = octx.createImageData(size, size);
    const o = out.data;
    const md = master.data, ms = master.size, mh = master.half,
          msc = master.scale;
    const step = 2 * extent / size;
    for (let y = 0, i = 0; y < size; y++) {
      const v = extent - (y + 0.5) * step;
      for (let x = 0; x < size; x++, i += 4) {
        const u = -extent + (x + 0.5) * step;
        const r = Math.sqrt(u * u + v * v);
        if (r > 1) continue;                       // below the horizon
        const li2 = (r * LUT_N) | 0;
        const ca = LUT_S[li2], sa = LUT_C[li2];    // cos(alt), sin(alt)
        const inv = r > 1e-9 ? ca / r : 0;
        const hN = r > 1e-9 ? v * inv : 0;
        const hE = r > 1e-9 ? -u * inv : 0;
        const hU = sa;
        const gx = m00 * hN + m01 * hE + m02 * hU;
        const gy = m10 * hN + m11 * hE + m12 * hU;
        const gz = m20 * hN + m21 * hE + m22 * hU;
        const rg = 1 - Math.asin(gz < -1 ? -1 : gz > 1 ? 1 : gz) / (Math.PI / 2);
        const hyp = Math.sqrt(gx * gx + gy * gy);
        const dx = hyp > 1e-9 ? gx / hyp : 1, dy = hyp > 1e-9 ? gy / hyp : 0;
        const mx = (mh + msc * rg * dx) | 0, my = (mh + msc * rg * dy) | 0;
        if (mx < 0 || my < 0 || mx >= ms || my >= ms) continue;
        const lvl = md[my * ms + mx];
        if (!lvl) continue;
        o[i] = LR[lvl]; o[i + 1] = LG[lvl]; o[i + 2] = LB[lvl];
        o[i + 3] = LA[lvl] * 255;
      }
    }
    octx.putImageData(out, 0, 0);
    return cv;
  }

  /* Backwards-compatible entry point: paint the band through the caller's
     own toPx mapping. */
  function drawMW(ctx, levels, lstH, sinLat, cosLat, toPx, opts) {
    const [ox, oy] = toPx(0, 0);
    const [ex, ey] = toPx(1, 0);
    const horizon = Math.hypot(ex - ox, ey - oy);
    const extent = opts.extent || 1;
    const size = Math.min(1024, Math.max(64, Math.round(horizon * extent * 2)));
    const cv = mwRaster(levels, lstH, sinLat, cosLat, size, extent, opts);
    const s = horizon * extent;
    ctx.drawImage(cv, ox - s, oy - s, s * 2, s * 2);
  }

  window.UTS = { altaz, proj, jd, gmstHours, lstHours, sunEq, moonEq,
                 drawMW, mwRaster, galactic };
})();
