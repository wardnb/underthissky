/* worlds.js — the sky from somewhere other than Earth.
 *
 * The central fact that makes this cheap: STARS DO NOT MOVE. The nearest is
 * four light-years away, so shifting the observer by 1.5 AU changes nothing
 * visible. The constellations over Mars are the constellations over Idaho.
 * The whole catalogue transfers untouched — only the FRAME changes.
 *
 * Three things differ per world, and all three are well-specified:
 *   1. Which way the pole points. Each body has IAU-published pole direction
 *      (a0, d0 in J2000) and prime-meridian angle W(t). Rotating the star
 *      vectors into the body's frame lets the existing altaz() work unchanged.
 *   2. How fast the sky turns — that falls out of W(t).
 *   3. Where the other bodies are, including Earth, which becomes a planet.
 *
 * The rotation follows the IAU convention
 *     R = Rz(W) . Rx(90 - d0) . Rz(90 + a0)
 * We split it: the Rx.Rz part defines a body-EQUATORIAL frame (not rotating),
 * and W + east longitude plays the role of local sidereal time. Sanity check
 * on Earth: a0=0, d0=90, W = 190.147 + 360.9856235d, so hour angle reduces to
 * GMST - RA exactly as before.
 *
 * Accuracy: pole/W models are IAU means. For the Moon the physical libration
 * terms are included (they reach ~0.1 deg and would otherwise smear the
 * Earth's position); for Mars the mean elements are used, good to well under
 * a pixel at chart scale.
 */
(function (root) {
  "use strict";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, AU_KM = 149597870.7;
  function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }
  function sin(d) { return Math.sin(d * D2R); }
  function cos(d) { return Math.cos(d * D2R); }

  /* ---------------- body orientation (IAU) ---------------- */

  function moonOrientation(d, T) {
    /* physical libration arguments */
    var E1 = 125.045 - 0.0529921 * d, E2 = 250.089 - 0.1059842 * d,
        E3 = 260.008 + 13.0120009 * d, E4 = 176.625 + 13.3407154 * d,
        E5 = 357.529 + 0.9856003 * d, E6 = 311.589 + 26.4057084 * d,
        E7 = 134.963 + 13.0649930 * d, E8 = 276.617 + 0.3287146 * d,
        E9 = 34.226 + 1.7484877 * d, E10 = 15.134 - 0.1589763 * d,
        E11 = 119.743 + 0.0036096 * d, E12 = 239.961 + 0.1643573 * d,
        E13 = 25.053 + 12.9590088 * d;
    var a0 = 269.9949 + 0.0031 * T
      - 3.8787 * sin(E1) - 0.1204 * sin(E2) + 0.0700 * sin(E3)
      - 0.0172 * sin(E4) + 0.0072 * sin(E6) - 0.0052 * sin(E10)
      + 0.0043 * sin(E13);
    var d0 = 66.5392 + 0.0130 * T
      + 1.5419 * cos(E1) + 0.0239 * cos(E2) - 0.0278 * cos(E3)
      + 0.0068 * cos(E4) - 0.0029 * cos(E6) + 0.0009 * cos(E7)
      + 0.0008 * cos(E10) - 0.0009 * cos(E13);
    var W = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d
      + 3.5610 * sin(E1) + 0.1208 * sin(E2) - 0.0642 * sin(E3)
      + 0.0158 * sin(E4) + 0.0252 * sin(E5) - 0.0066 * sin(E6)
      - 0.0047 * sin(E7) - 0.0046 * sin(E8) + 0.0028 * sin(E9)
      + 0.0052 * sin(E10) + 0.0040 * sin(E11) + 0.0019 * sin(E12)
      - 0.0044 * sin(E13);
    return { a0: a0, d0: d0, W: norm360(W) };
  }

  var BODIES = {
    earth: {
      label: "Earth", rotHours: 23.934,
      orient: function (d, T) {
        return { a0: 0.00 - 0.641 * T, d0: 90.00 - 0.557 * T,
                 W: norm360(190.147 + 360.9856235 * d) };
      },
      /* bodies shown as labelled dots */
      planets: ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"],
      /* body drawn as a phased disc, or null */
      companion: "Moon"
    },
    moon: {
      label: "the Moon", rotHours: 655.7, orient: moonOrientation,
      planets: ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"],
      companion: "Earth"
    },
    mars: {
      label: "Mars", rotHours: 24.623,
      orient: function (d, T) {
        return { a0: 317.68143 - 0.1061 * T, d0: 52.88650 - 0.0609 * T,
                 W: norm360(176.630 + 350.89198226 * d) };
      },
      /* Earth is a bright dot from Mars, not a disc — label it honestly */
      planets: ["Mercury", "Venus", "Earth", "Jupiter", "Saturn"],
      companion: null
    }
  };

  /* ---------------- frame rotation ---------------- */

  /* Rx(90-d0) . Rz(90+a0) as a 3x3, applied to J2000 equatorial unit vectors */
  function frameMatrix(a0, d0) {
    var z = 90 + a0, x = 90 - d0;
    var cz = cos(z), sz = sin(z), cx = cos(x), sx = sin(x);
    return [
      [cz, sz, 0],
      [-cx * sz, cx * cz, sx],
      [sx * sz, -sx * cz, cx]
    ];
  }

  function rotate(M, raH, decDeg) {
    var ra = raH * 15;
    var v = [cos(decDeg) * cos(ra), cos(decDeg) * sin(ra), sin(decDeg)];
    var x = M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2];
    var y = M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2];
    var z = M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2];
    return [norm360(Math.atan2(y, x) * R2D) / 15, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
  }

  /* Whole catalogue into the body frame. Star INDICES are untouched, so
   * constellation lines and names need no work — only coordinates move. */
  function transformCatalog(cat, M) {
    var out = { names: cat.names, lines: cat.lines, cons: cat.cons };
    out.stars = cat.stars.map(function (s) {
      var p = rotate(M, s[0], s[1]); return [p[0], p[1], s[2]];
    });
    var path = function (p) {
      return p.map(function (q) { return rotate(M, q[0], q[1]); });
    };
    out.milky = cat.milky.map(path);
    out.mw = cat.mw.map(function (layer) { return layer.map(path); });
    return out;
  }

  /* ---------------- where everything is ---------------- */

  function eclRect(lamDeg, betDeg, rAU) {
    return [rAU * cos(betDeg) * cos(lamDeg),
            rAU * cos(betDeg) * sin(lamDeg),
            rAU * sin(betDeg)];
  }

  /* Heliocentric ecliptic position of the observer's world (AU) */
  function observerHelio(world, JD) {
    var T = (JD - 2451545.0) / 36525.0;
    if (world === "mars") return UTSEphem.helio("Mars", T);
    var e = UTSEphem.helio("Earth", T);
    if (world === "earth") return e;
    var m = UTSEphem.moon(JD);                       /* geocentric */
    var r = eclRect(m.lam, m.bet, m.dist / AU_KM);
    return [e[0] + r[0], e[1] + r[1], e[2] + r[2]];
  }

  /* Heliocentric position of any target (AU) */
  function targetHelio(name, JD) {
    var T = (JD - 2451545.0) / 36525.0;
    if (name === "Sun") return [0, 0, 0];
    if (name === "Earth") return UTSEphem.helio("Earth", T);
    if (name === "Moon") {
      var e = UTSEphem.helio("Earth", T), m = UTSEphem.moon(JD);
      var r = eclRect(m.lam, m.bet, m.dist / AU_KM);
      return [e[0] + r[0], e[1] + r[1], e[2] + r[2]];
    }
    return UTSEphem.helio(name, T);
  }

  /* Apparent [raH, decDeg] of a target, in the observer world's frame */
  function apparent(name, JD, obs, M) {
    var t = targetHelio(name, JD);
    var x = t[0] - obs[0], y = t[1] - obs[1], z = t[2] - obs[2];
    var lam = norm360(Math.atan2(y, x) * R2D);
    var bet = Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D;
    var eq = UTSEphem.eclToEq(lam, bet, 23.4392911);
    var p = rotate(M, eq[0], eq[1]);
    return { eq: p, dist: Math.sqrt(x * x + y * y + z * z) };
  }

  /* Illuminated fraction of `name` as seen from obs (phase geometry) */
  function phaseOf(name, JD, obs) {
    var t = targetHelio(name, JD);
    var toObs = [obs[0] - t[0], obs[1] - t[1], obs[2] - t[2]];
    var toSun = [-t[0], -t[1], -t[2]];
    var dot = toObs[0] * toSun[0] + toObs[1] * toSun[1] + toObs[2] * toSun[2];
    var na = Math.hypot(toObs[0], toObs[1], toObs[2]);
    var nb = Math.hypot(toSun[0], toSun[1], toSun[2]);
    var phase = Math.acos(Math.max(-1, Math.min(1, dot / (na * nb)))) * R2D;
    return (1 + cos(phase)) / 2;
  }

  /* One sample for a non-Earth world, in gen_page.py's sample shape */
  function sample(world, ms, lonDeg, latDeg) {
    var B = BODIES[world];
    var JD = UTSEphem.jd(ms);
    var d = JD - 2451545.0, T = d / 36525.0;
    var o = B.orient(d, T);
    var M = frameMatrix(o.a0, o.d0);
    var obs = observerHelio(world, JD);

    var lstH = norm360(o.W + lonDeg) / 15;
    var sunP = apparent("Sun", JD, obs, M);

    var comp;
    if (B.companion) {
      var c = apparent(B.companion, JD, obs, M);
      var f = phaseOf(B.companion, JD, obs);
      /* waxing flag only drives which limb is lit; the renderer rotates the
       * terminator toward the Sun anyway, so 1 is safe here */
      comp = [c.eq[0], c.eq[1], f, 1];
    } else {
      /* no companion body: park it below the horizon so the renderer culls it */
      comp = [0, latDeg >= 0 ? -89.9 : 89.9, 0, 1];
    }

    return {
      lst: lstH,
      moon: comp,
      sun: [sunP.eq[0], sunP.eq[1]],
      planets: B.planets.map(function (n) { return apparent(n, JD, obs, M).eq; })
    };
  }

  function window_(world, t0ms, lonDeg, latDeg, startMin, stepMin, endMin) {
    var out = [];
    for (var off = startMin; off <= endMin; off += stepMin) {
      out.push(sample(world, t0ms + off * 60000, lonDeg, latDeg));
    }
    return { start_min: startMin, step_min: stepMin, samples: out,
             planet_names: BODIES[world].planets.slice() };
  }

  /* Body-frame star catalogue for a given world and time */
  function catalogFor(world, catalog, JD) {
    var d = JD - 2451545.0, T = d / 36525.0;
    var o = BODIES[world].orient(d, T);
    return transformCatalog(catalog, frameMatrix(o.a0, o.d0));
  }

  root.UTSWorlds = {
    BODIES: BODIES, window: window_, catalogFor: catalogFor,
    frameMatrix: frameMatrix, rotate: rotate
  };
})(typeof window !== "undefined" ? window : globalThis);
