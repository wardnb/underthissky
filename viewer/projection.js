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

  /* Is this level's evenodd fill inverted?

     Deciding it from a fixed sky position does not work: the obvious probe,
     the galactic centre, is inside the two faint levels but outside the two
     bright ones, because in visible light the centre is dust-obscured and
     the brightest isophotes sit in the Sagittarius and Cygnus star clouds.

     So ask the geometry instead. Render the level tiny and measure how much
     of the sky it claims. The Milky Way is a band — a minority of the sky,
     around a third of the visible hemisphere at its most overhead. If
     evenodd says it covers most of the sky, the nadir is inside the region
     and the sense has flipped. The two cases are ~30% against ~100%, so the
     half-way threshold has a wide margin. */
  const PROBE = 64;
  let probeCanvas = null;
  function fillInverted(rings, ox, oy, horizon) {
    if (!probeCanvas) {
      probeCanvas = document.createElement("canvas");
      probeCanvas.width = probeCanvas.height = PROBE;
    }
    const p = probeCanvas.getContext("2d", { willReadFrequently: true });
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.clearRect(0, 0, PROBE, PROBE);
    const h = PROBE / 2, k = (h - 1) / horizon;
    p.setTransform(k, 0, 0, k, h - ox * k, h - oy * k);
    p.fillStyle = "#fff";
    p.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        if (i === 0) p.moveTo(ring[i][0], ring[i][1]);
        else p.lineTo(ring[i][0], ring[i][1]);
      }
      p.closePath();
    }
    p.fill("evenodd");
    p.setTransform(1, 0, 0, 1, 0, 0);
    const d = p.getImageData(0, 0, PROBE, PROBE).data;
    let n = 0, lit = 0;
    for (let y = 0; y < PROBE; y++) {
      for (let x = 0; x < PROBE; x++) {
        if (Math.hypot(x - h, y - h) > h - 1) continue;
        n++;
        if (d[(y * PROBE + x) * 4 + 3] > 128) lit++;
      }
    }
    return lit > n * 0.5;
  }

  /* Milky Way isophote painter (shared by order pages + landing).
     levels: outermost->inner arrays of rings [[raH,dec],...]; rings are
     filled together per level with the evenodd rule, so disjoint patches
     and the Great Rift holes read as absence of glow.

     Two things make this harder than it looks, both learned the hard way.

     (1) Below-horizon vertices used to be pinned to a fixed radius (1.06),
     which collapsed the whole lower hemisphere onto one circle: distinct
     directions landed on the same pixels, closed rings self-intersected,
     and evenodd cancels self-intersections. So r is now the plain
     continuous extension (90-alt)/90, which is well defined below the
     horizon too and maps the sphere onto a disc of radius 2. Simple closed
     rings stay simple. What must not be seen is removed by clipping to the
     horizon, not by deforming the geometry.

     (2) That projection blows the nadir up into the whole outer circle, so
     a region *containing* the nadir touches the outer boundary and evenodd
     fills its complement instead. This is not hypothetical: over Port Huron
     on 2026-08-13 the band renders correctly at 9:25pm, and by 10:05pm the
     Milky Way has swung underfoot, the nadir falls inside it, and the fill
     inverts — the bug reported as the band "breaking up". So each level is
     checked with fillInverted() above, and when the sense has flipped an
     enclosing ring is added to flip the whole level back.

     Calibrated for Bortle 2-3: the band should be the last thing you
     notice — a faint luminous grain barely above the background. */
  function drawMW(ctx, levels, lstH, sinLat, cosLat, toPx, opts) {
    const alphas = opts.alphas || [0.026, 0.030, 0.036, 0.044];
    const colors = opts.colors ||
      [[214, 224, 250], [220, 228, 250], [228, 232, 248], [238, 236, 226]];
    const project = (raH, dec) => {
      const [alt, az] = altaz(raH, dec, lstH, sinLat, cosLat);
      const r = (90 - alt) / 90, aa = az * RAD;
      return toPx(-r * Math.sin(aa), r * Math.cos(aa));
    };
    const [ox, oy] = toPx(0, 0);
    const [ex, ey] = toPx(1, 0);
    const horizon = Math.hypot(ex - ox, ey - oy);

    ctx.save();
    ctx.beginPath();
    ctx.arc(ox, oy, horizon, 0, Math.PI * 2);
    ctx.clip();
    for (let li = 0; li < levels.length; li++) {
      const [cr, cg, cb] = colors[Math.min(li, colors.length - 1)];
      const a = alphas[Math.min(li, alphas.length - 1)] * (opts.scale || 1);
      if (a <= 0.002) continue;
      const rings = levels[li].map(ring => ring.map(p => project(p[0], p[1])));
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a.toFixed(4)})`;
      ctx.beginPath();
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          if (i === 0) ctx.moveTo(ring[i][0], ring[i][1]);
          else ctx.lineTo(ring[i][0], ring[i][1]);
        }
        ctx.closePath();
      }
      if (fillInverted(rings, ox, oy, horizon)) {
        // the nadir is inside this level, so evenodd has it inverted —
        // enclose everything (the sphere reaches r=2) and flip the parity
        ctx.moveTo(ox + 3 * horizon, oy);
        ctx.arc(ox, oy, 3 * horizon, 0, Math.PI * 2);
      }
      ctx.fill("evenodd");
    }
    ctx.restore();
  }

  window.UTS = { altaz, proj, jd, gmstHours, lstHours, sunEq, moonEq, drawMW };
})();
