/* Sanity checks for the off-Earth frames. These are physical facts that must
 * hold, not regression fixtures — if any fails the frame maths is wrong. */
require("../viewer/ephem.js");
require("../viewer/worlds.js");
const W = globalThis.UTSWorlds, E = globalThis.UTSEphem;

function angSep(a, b) {           // [raH, decDeg] pairs -> degrees
  const d2r = Math.PI/180;
  const v = p => [Math.cos(p[1]*d2r)*Math.cos(p[0]*15*d2r),
                  Math.cos(p[1]*d2r)*Math.sin(p[0]*15*d2r), Math.sin(p[1]*d2r)];
  const [x,y] = [v(a), v(b)];
  return Math.acos(Math.max(-1,Math.min(1,x[0]*y[0]+x[1]*y[1]+x[2]*y[2])))/d2r;
}

/* 1. EARTH FRAME IS A NO-OP: rotating into Earth's own frame then computing
      hour angle must reproduce plain GMST-based results. */
const t = Date.UTC(2026, 7, 3, 3, 30);
const eEarth = E.sample(t, -82.43, 42.97);
const wEarth = W.window("earth", t, -82.43, 42.97, 0, 30, 0).samples[0];
/* LST is frame-relative: the world frame absorbs 90 deg into the star
   rotation, so raw LST values differ by design. The invariant that must hold
   is the HOUR ANGLE of an actual star. */
const starJ2000 = [6.752, -16.716];                     // Sirius
const mEarth = W.frameMatrix(0, 90);
const starBody = W.rotate(mEarth, starJ2000[0], starJ2000[1]);
const haE = ((eEarth.lst - starJ2000[0]) % 24 + 24) % 24;
const haW = ((wEarth.lst - starBody[0]) % 24 + 24) % 24;
let dHa = Math.abs(haE - haW); dHa = Math.min(dHa, 24 - dHa);
console.log(`Earth frame: star hour angle agrees to ${(dHa*15).toFixed(3)} deg`);
console.log(`      (residual is IAU's simplified W for Earth vs the GMST series;`);
console.log(`       Earth still uses the ephem.js path, so this never ships)`);

/* 2. TIDAL LOCK: from the Moon, Earth must stay nearly fixed in the sky.
      Sample a full lunar day (29.5 Earth days) and measure the spread. */
const TB = { lon: 23.4730, lat: 0.6741 };          // Tranquility Base
/* Tidal lock fixes Earth in the BODY-FIXED frame, which rotates with W.
   In the body-EQUATORIAL frame used for altaz, Earth's RA must drift with the
   month by construction — so measure hour angle, not RA. */
let pts = [];
for (let dday = 0; dday < 29.5; dday += 0.5) {
  const s = W.window("moon", Date.UTC(1969,6,20,20,17) + dday*86400000,
                     TB.lon, TB.lat, 0, 30, 0).samples[0];
  let ha = ((s.lst - s.moon[0]) % 24 + 24) % 24;       // hours
  pts.push([ha, s.moon[1]]);
}
let maxSep = 0;
for (const p of pts) maxSep = Math.max(maxSep, angSep(pts[0], p));
console.log(`Moon: Earth wanders ${maxSep.toFixed(1)} deg in the body-fixed frame`);
console.log(`      (real libration is ~+-8 deg; a rising/setting body gives ~180)`);

/* 3. Earth's altitude at Tranquility Base should be high and roughly constant.
      Armstrong's site is at 23.5E, so Earth sits well off zenith but never sets. */
const d2r = Math.PI/180;
function alt(raH, decDeg, lstH, latDeg) {
  const H = (lstH - raH) * 15 * d2r;
  return Math.asin(Math.sin(decDeg*d2r)*Math.sin(latDeg*d2r) +
         Math.cos(decDeg*d2r)*Math.cos(latDeg*d2r)*Math.cos(H))/d2r;
}
let alts = [];
for (let dday = 0; dday < 29.5; dday += 1) {
  const s = W.window("moon", Date.UTC(1969,6,20,20,17) + dday*86400000,
                     TB.lon, TB.lat, 0, 30, 0).samples[0];
  alts.push(alt(s.moon[0], s.moon[1], s.lst, TB.lat));
}
console.log(`      Earth altitude range ${Math.min(...alts).toFixed(1)} to ${Math.max(...alts).toFixed(1)} deg — never sets: ${Math.min(...alts) > 0}`);

/* 4. MARS DAY LENGTH: the sky must turn once per sol (24h37m), so LST should
      advance ~360 deg in 24.623 h. */
const t0 = Date.UTC(2021,1,18,20,55);
const a = W.window("mars", t0, 77.45, 18.44, 0, 30, 0).samples[0];
const b = W.window("mars", t0 + 24.6229*3600000, 77.45, 18.44, 0, 30, 0).samples[0];
let dh = ((b.lst - a.lst) % 24 + 24) % 24;
console.log(`Mars: LST drift over one sol = ${(Math.min(dh,24-dh)*15).toFixed(2)} deg (want ~0)`);

/* 5. Constellations must be IDENTICAL from every world — stars are at infinity.
      Angular separation between two stars must be frame-invariant. */
const cat = { stars: [[0.0266,-77.066,4.8],[6.752,-16.716,-1.44]], names:{}, lines:[], cons:[], milky:[], mw:[] };
const mMoon = W.frameMatrix(269.99, 66.54), mMars = W.frameMatrix(317.68, 52.89);
const sepE = angSep(cat.stars[0], cat.stars[1]);
const sepM = angSep(W.rotate(mMoon, cat.stars[0][0], cat.stars[0][1]),
                    W.rotate(mMoon, cat.stars[1][0], cat.stars[1][1]));
const sepR = angSep(W.rotate(mMars, cat.stars[0][0], cat.stars[0][1]),
                    W.rotate(mMars, cat.stars[1][0], cat.stars[1][1]));
console.log(`Star separation invariant: Earth ${sepE.toFixed(6)}  Moon ${sepM.toFixed(6)}  Mars ${sepR.toFixed(6)}`);
