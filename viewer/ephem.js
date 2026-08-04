/* ephem.js — Sun, Moon, planets and sidereal time, computed in the browser.
 *
 * Why this exists: the printed charts and the per-order pages are built by
 * gen_page.py using Skyfield + JPL ephemerides. That needs Python, and the
 * public "make your own sky" page has to run on static hosting with no
 * server. So the same window.SKY payload is assembled client-side instead,
 * using standard analytical series.
 *
 * ACCURACY, stated honestly because accuracy is the whole product claim:
 *   Sun     Meeus low-precision series      ~0.01 deg
 *   Moon    Meeus ch.47, main terms         ~0.1-0.2 deg
 *   Planets JPL approximate Keplerian
 *           elements, valid 1800-2050       ~arcminutes
 *   LST     IAU GMST + longitude            exact for our purposes
 *
 * A full-sky chart spans 180 deg across roughly 800 px, i.e. ~0.22 deg per
 * pixel, so the worst of these (the Moon) lands inside one pixel. That is
 * why the approximation is legitimate here — but the PRINTED chart still
 * comes from Skyfield/JPL, and marketing copy should not claim this page is
 * JPL-derived beyond the planetary elements, which genuinely are.
 *
 * Validated against gen_page.py output in tools/validate_ephem.js.
 */
(function (root) {
  "use strict";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }
  function sin(d) { return Math.sin(d * D2R); }
  function cos(d) { return Math.cos(d * D2R); }

  /* Julian Date from a JS epoch (ms, UTC) */
  function jd(ms) { return ms / 86400000 + 2440587.5; }

  /* Greenwich mean sidereal time (hours), IAU 1982 series */
  function gmst(JD) {
    var T = (JD - 2451545.0) / 36525.0;
    var g = 280.46061837 + 360.98564736629 * (JD - 2451545.0)
          + 0.000387933 * T * T - T * T * T / 38710000.0;
    return norm360(g) / 15.0;
  }

  /* Local apparent sidereal time (hours). lonDeg east-positive. */
  function lst(JD, lonDeg) {
    var h = gmst(JD) + lonDeg / 15.0;
    h %= 24; return h < 0 ? h + 24 : h;
  }

  /* General precession in ecliptic longitude, date -> J2000 (deg).
   * p = 5029.0966"/century; T is centuries from J2000 (negative in the past).
   * The star catalogue is J2000, so Sun/Moon must be expressed in that frame
   * or they slide against the constellations they sit in. */
  function toJ2000(lam, T) { return norm360(lam - 1.3969712 * T); }

  /* Obliquity of the ecliptic (deg) */
  function obliquity(T) {
    return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  }

  /* ecliptic (lambda,beta) -> equatorial [raHours, decDeg] */
  function eclToEq(lam, bet, eps) {
    var sl = sin(lam), cl = cos(lam), sb = sin(bet), cb = cos(bet),
        se = sin(eps), ce = cos(eps);
    var ra = Math.atan2(sl * ce - (sb / cb) * se, cl) * R2D;
    var dec = Math.asin(sb * ce + cb * se * sl) * R2D;
    return [norm360(ra) / 15.0, dec];
  }

  /* ---- Sun: Meeus, low precision (~0.01 deg) ---- */
  function sun(JD) {
    var n = JD - 2451545.0, T = n / 36525.0;
    var L = norm360(280.460 + 0.9856474 * n);
    var g = norm360(357.528 + 0.9856003 * n);
    var lam = L + 1.915 * sin(g) + 0.020 * sin(2 * g);
    var lj = toJ2000(lam, T);
    return { eq: eclToEq(lj, 0, 23.4392911), lam: lj };
  }

  /* ---- Moon: Meeus ch.47, principal periodic terms (~0.1-0.2 deg) ---- */
  function moon(JD) {
    var T = (JD - 2451545.0) / 36525.0;
    var Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
    var Dd = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
    var M  = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
    var Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
    var F  = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T);

    var lam = Lp
      + 6.288774 * sin(Mp)
      + 1.274027 * sin(2 * Dd - Mp)
      + 0.658314 * sin(2 * Dd)
      + 0.213618 * sin(2 * Mp)
      - 0.185116 * sin(M)
      - 0.114332 * sin(2 * F)
      + 0.058793 * sin(2 * Dd - 2 * Mp)
      + 0.057066 * sin(2 * Dd - M - Mp)
      + 0.053322 * sin(2 * Dd + Mp)
      + 0.045758 * sin(2 * Dd - M)
      - 0.040923 * sin(M - Mp)
      - 0.034720 * sin(Dd)
      - 0.030383 * sin(M + Mp)
      + 0.015327 * sin(2 * Dd - 2 * F)
      - 0.012528 * sin(Mp + 2 * F)
      + 0.010980 * sin(Mp - 2 * F)
      + 0.010675 * sin(4 * Dd - Mp)
      + 0.010034 * sin(3 * Mp)
      + 0.008548 * sin(4 * Dd - 2 * Mp);

    var bet =
        5.128122 * sin(F)
      + 0.280602 * sin(Mp + F)
      + 0.277693 * sin(Mp - F)
      + 0.173237 * sin(2 * Dd - F)
      + 0.055413 * sin(2 * Dd - Mp + F)
      + 0.046271 * sin(2 * Dd - Mp - F)
      + 0.032573 * sin(2 * Dd + F)
      + 0.017198 * sin(2 * Mp + F)
      + 0.009266 * sin(2 * Dd + Mp - F)
      + 0.008822 * sin(2 * Mp - F)
      + 0.008216 * sin(2 * Dd - M - F)
      + 0.004324 * sin(2 * Dd - 2 * Mp - F);

    /* distance (km) — needed for horizontal parallax */
    var r = 385000.56
      - 20905.355 * cos(Mp)
      - 3699.111 * cos(2 * Dd - Mp)
      - 2955.968 * cos(2 * Dd)
      - 569.925 * cos(2 * Mp)
      + 246.158 * cos(2 * Dd - 2 * Mp)
      - 204.586 * cos(2 * Dd - M)
      - 170.733 * cos(2 * Dd + Mp)
      - 152.138 * cos(2 * Dd - M - Mp)
      - 129.620 * cos(M - Mp)
      + 108.743 * cos(Dd)
      + 104.755 * cos(M + Mp)
      + 79.661 * cos(Mp - 2 * F)
      + 48.888 * cos(M);

    var lj = toJ2000(lam, T);
    return { eq: eclToEq(lj, bet, 23.4392911), lam: lj, bet: bet, dist: r };
  }

  /* Geocentric -> topocentric (Meeus ch.40). Matters only for the Moon.
   * distKm is the geocentric distance; lstH the local sidereal time. */
  function topocentric(eq, distKm, latDeg, lstH) {
    var sinPi = 6378.14 / distKm;                    /* horizontal parallax */
    var u = Math.atan(0.99664719 * Math.tan(latDeg * D2R));
    var rhoSin = 0.99664719 * Math.sin(u);           /* ignoring elevation */
    var rhoCos = Math.cos(u);
    var H = norm360((lstH - eq[0]) * 15);            /* hour angle, deg */
    var dec = eq[1];
    var dRa = Math.atan2(-rhoCos * sinPi * sin(H),
                         cos(dec) - rhoCos * sinPi * cos(H));
    var decT = Math.atan2((sin(dec) - rhoSin * sinPi) * Math.cos(dRa),
                          cos(dec) - rhoCos * sinPi * cos(H)) * R2D;
    var raT = eq[0] + dRa * R2D / 15;
    raT %= 24; if (raT < 0) raT += 24;
    return [raT, decT];
  }

  /* ---- Planets: JPL approximate Keplerian elements, 1800-2050 ----
   * [a, e, I, L, longPeri, longNode] and their per-century rates.       */
  var PL = {
    Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
              [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
              [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
    Earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
              [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
    Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
              [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
              [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
              [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]]
  };

  /* Heliocentric ecliptic rectangular coords (AU) for one body */
  function helio(name, T) {
    var el = PL[name], a = el[0][0] + el[1][0] * T, e = el[0][1] + el[1][1] * T,
        I = el[0][2] + el[1][2] * T, L = el[0][3] + el[1][3] * T,
        wbar = el[0][4] + el[1][4] * T, Om = el[0][5] + el[1][5] * T;
    var w = wbar - Om, M = norm360(L - wbar);
    if (M > 180) M -= 360;
    /* Kepler, Newton-Raphson — converges in a few iterations at these e */
    var E = M + e * R2D * sin(M);
    for (var i = 0; i < 8; i++) {
      var dM = M - (E - e * R2D * sin(E));
      var dE = dM / (1 - e * cos(E));
      E += dE;
      if (Math.abs(dE) < 1e-9) break;
    }
    var xp = a * (cos(E) - e), yp = a * Math.sqrt(1 - e * e) * sin(E);
    /* orbital plane -> J2000 ecliptic */
    var cw = cos(w), sw = sin(w), cO = cos(Om), sO = sin(Om), cI = cos(I), sI = sin(I);
    return [
      (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      (sw * sI) * xp + (cw * sI) * yp
    ];
  }

  /* Geocentric [raHours, decDeg] for a planet */
  function planet(name, JD) {
    var T = (JD - 2451545.0) / 36525.0;
    var p = helio(name, T), earth = helio("Earth", T);
    var x = p[0] - earth[0], y = p[1] - earth[1], z = p[2] - earth[2];
    var lam = norm360(Math.atan2(y, x) * R2D);
    var bet = Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D;
    return eclToEq(lam, bet, 23.4392911);
  }

  /* Illuminated fraction and waxing flag */
  function moonPhase(sunL, moonL, sunEq, moonEq) {
    var psi = Math.acos(
      Math.max(-1, Math.min(1,
        sin(sunEq[1]) * sin(moonEq[1]) +
        cos(sunEq[1]) * cos(moonEq[1]) * cos((sunEq[0] - moonEq[0]) * 15)))) * R2D;
    var frac = (1 - cos(psi)) / 2;   /* psi = elongation; full moon -> 1 */
    var elong = norm360(moonL - sunL);
    return { frac: Math.max(0, Math.min(1, frac)), waxing: elong < 180 ? 1 : 0 };
  }

  var NAMES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

  /* One sample at a given epoch — matches gen_page.py's sample shape */
  function sample(ms, lonDeg, latDeg) {
    var JD = jd(ms);
    var s = sun(JD), m = moon(JD);
    var ph = moonPhase(s.lam, m.lam, s.eq, m.eq);
    var L = lst(JD, lonDeg);
    var mt = topocentric(m.eq, m.dist, latDeg, L);
    return {
      lst: L,
      moon: [mt[0], mt[1], ph.frac, ph.waxing],
      sun: [s.eq[0], s.eq[1]],
      planets: NAMES.map(function (n) { return planet(n, JD); })
    };
  }

  /* Full window of samples on the same grid gen_page.py uses */
  function window_(t0ms, lonDeg, latDeg, startMin, stepMin, endMin) {
    var out = [];
    for (var off = startMin; off <= endMin; off += stepMin) {
      out.push(sample(t0ms + off * 60000, lonDeg, latDeg));
    }
    return { start_min: startMin, step_min: stepMin, samples: out,
             planet_names: NAMES.slice() };
  }

  root.UTSEphem = { jd: jd, gmst: gmst, lst: lst, sun: sun, moon: moon,
                    planet: planet, sample: sample, window: window_,
                    helio: helio, eclToEq: eclToEq, PLANET_NAMES: NAMES };
})(typeof window !== "undefined" ? window : globalThis);
