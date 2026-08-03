/* Compare the browser ephemeris against gen_page.py (Skyfield + JPL) output
 * for a real generated page. Any regression here is a product-claim bug. */
const fs = require("fs");
require("../viewer/ephem.js");
const E = globalThis.UTSEphem;
const ref = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { lat, lon, t0_epoch_ms } = ref.meta;
const W = ref.window;
const mine = E.window(t0_epoch_ms, lon, lat, W.start_min, W.step_min,
                      W.start_min + W.step_min * (W.samples.length - 1));

function dAng(aDeg, bDeg) { let d = Math.abs(aDeg - bDeg) % 360; return d > 180 ? 360 - d : d; }
const worst = { lst: 0, moon: 0, sun: 0, planet: 0 };
for (let i = 0; i < W.samples.length; i++) {
  const r = W.samples[i], m = mine.samples[i];
  let dl = Math.abs(r.lst - m.lst) % 24; if (dl > 12) dl = 24 - dl;
  worst.lst = Math.max(worst.lst, dl * 15);                       // hours -> deg
  worst.moon = Math.max(worst.moon,
    dAng(r.moon[0] * 15, m.moon[0] * 15), dAng(r.moon[1], m.moon[1]));
  worst.sun = Math.max(worst.sun,
    dAng(r.sun[0] * 15, m.sun[0] * 15), dAng(r.sun[1], m.sun[1]));
  for (let k = 0; k < r.planets.length; k++)
    worst.planet = Math.max(worst.planet,
      dAng(r.planets[k][0] * 15, m.planets[k][0] * 15),
      dAng(r.planets[k][1], m.planets[k][1]));
}
const fracErr = Math.max(...W.samples.map((r, i) =>
  Math.abs(r.moon[2] - mine.samples[i].moon[2])));
const waxOk = W.samples.every((r, i) => r.moon[3] === mine.samples[i].moon[3]);
console.log(`reference: ${ref.meta.date_label}  lat ${lat} lon ${lon}  ` +
            `${W.samples.length} samples`);
console.log(`  max error, sidereal time : ${worst.lst.toFixed(4)} deg`);
console.log(`  max error, Sun           : ${worst.sun.toFixed(4)} deg`);
console.log(`  max error, Moon          : ${worst.moon.toFixed(4)} deg`);
console.log(`  max error, planets       : ${worst.planet.toFixed(4)} deg`);
console.log(`  moon illumination error  : ${(fracErr*100).toFixed(2)} %`);
console.log(`  waxing flag matches      : ${waxOk}`);
const PX = 0.22;   // deg per pixel on a full-sky chart at ~800px
const bad = Math.max(worst.lst, worst.sun, worst.moon, worst.planet);
console.log(`\n  worst overall ${bad.toFixed(3)} deg = ${(bad/PX).toFixed(2)} px on an 800px sky`);
console.log(bad < PX ? "  PASS — sub-pixel" : "  CHECK — visible at chart scale");
