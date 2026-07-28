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

  /* Milky Way isophote painter (shared by order pages + landing).
     levels: outermost->inner arrays of rings [[raH,dec],...]; rings are
     filled together per level with the evenodd rule, so disjoint patches
     and the Great Rift holes read as absence of glow. Below-horizon
     vertices are pinned just outside the horizon (r=1.06) with arc
     densification so wrap-around rings never slice across the sky disc.
     Calibrated for Bortle 2-3: the band should be the last thing you
     notice — a faint luminous grain barely above the background. */
  function drawMW(ctx, levels, lstH, sinLat, cosLat, toPx, opts) {
    const alphas = opts.alphas || [0.026, 0.030, 0.036, 0.044];
    const colors = opts.colors ||
      [[214, 224, 250], [220, 228, 250], [228, 232, 248], [238, 236, 226]];
    for (let li = 0; li < levels.length; li++) {
      const [cr, cg, cb] = colors[Math.min(li, colors.length - 1)];
      const a = alphas[Math.min(li, alphas.length - 1)] * (opts.scale || 1);
      if (a <= 0.002) continue;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a.toFixed(4)})`;
      ctx.beginPath();
      for (const ring of levels[li]) {
        let anyUp = false;
        const pts = [];
        for (const [raH, dec] of ring) {
          const [alt, az] = altaz(raH, dec, lstH, sinLat, cosLat);
          if (alt > -2) anyUp = true;
          pts.push([alt, az]);
        }
        if (!anyUp) continue;
        let started = false, prev = null;
        for (const [alt, az] of pts) {
          const r = Math.min((90 - alt) / 90, 1.06);
          if (prev && prev[1] >= 1.05 && r >= 1.05) {
            // both pinned outside the horizon: walk the rim, don't chord
            let d = az - prev[0];
            if (d > 180) d -= 360; if (d < -180) d += 360;
            const steps = Math.floor(Math.abs(d) / 12);
            for (let s2 = 1; s2 <= steps; s2++) {
              const az2 = prev[0] + d * s2 / steps;
              const aa = az2 * RAD;
              const [x, y] = toPx(-1.06 * Math.sin(aa), 1.06 * Math.cos(aa));
              ctx.lineTo(x, y);
            }
          }
          const aa = az * RAD;
          const [x, y] = toPx(-r * Math.sin(aa), r * Math.cos(aa));
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
          prev = [az, r];
        }
        ctx.closePath();
      }
      ctx.fill("evenodd");
    }
  }

  window.UTS = { altaz, proj, jd, gmstHours, lstHours, sunEq, moonEq, drawMW };
})();
