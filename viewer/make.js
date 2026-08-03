/* make.js — assemble a window.SKY payload in the browser, then hand it to the
 * same projection.js / sky.js the per-order pages use.
 *
 * The per-order pages are built by gen_page.py (Skyfield + JPL). This page has
 * to work on static hosting, so it computes the same payload client-side with
 * viewer/ephem.js, which is validated against gen_page.py output to sub-pixel
 * accuracy (tools/validate_ephem.js).
 *
 * The star catalogue is identical for every sky, so it is fetched once from
 * viewer/catalog.json rather than embedded per page.
 */
(function () {
  "use strict";

  var WINDOW_MIN = 360, STEP_MIN = 30;
  var RADIANTS = {
    "Quadrantids": [15.3, 49.5], "Lyrids": [18.1, 33.6],
    "Eta Aquariids": [22.5, -1.0], "Delta Aquariids": [22.7, -16.4],
    "Perseids": [3.2, 58.0], "Orionids": [6.35, 15.5],
    "Leonids": [10.3, 21.6], "Geminids": [7.55, 32.4],
    "Ursids": [14.5, 75.4]
  };
  /* name, start [m,d], end [m,d], peak [m,d] — mirrors starmap.METEOR_SHOWERS */
  var SHOWERS = [
    ["Quadrantids", [12, 28], [1, 12], [1, 3]],
    ["Lyrids", [4, 14], [4, 30], [4, 22]],
    ["Eta Aquariids", [4, 19], [5, 28], [5, 5]],
    ["Delta Aquariids", [7, 12], [8, 23], [7, 30]],
    ["Perseids", [7, 17], [8, 24], [8, 12]],
    ["Orionids", [10, 2], [11, 7], [10, 21]],
    ["Leonids", [11, 6], [11, 30], [11, 17]],
    ["Geminids", [12, 4], [12, 20], [12, 14]],
    ["Ursids", [12, 17], [12, 26], [12, 22]]
  ];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
              "Oct", "Nov", "Dec"];

  var $ = function (id) { return document.getElementById(id); };

  function activeShowers(month, day) {
    var out = [];
    SHOWERS.forEach(function (s) {
      var st = s[1], en = s[2], pk = s[3];
      var v = month * 100 + day, a = st[0] * 100 + st[1], b = en[0] * 100 + en[1];
      var on = a <= b ? (v >= a && v <= b) : (v >= a || v <= b);  /* year wrap */
      if (on && RADIANTS[s[0]]) {
        out.push({ name: s[0], ra: RADIANTS[s[0]][0], dec: RADIANTS[s[0]][1],
                   peak: MON3[pk[0] - 1] + " " + pk[1] });
      }
    });
    return out;
  }

  function phaseName(frac, waxing) {
    if (frac < 0.02) return "New Moon";
    if (frac > 0.98) return "Full Moon";
    if (Math.abs(frac - 0.5) < 0.06) return waxing ? "First Quarter" : "Last Quarter";
    if (frac < 0.5) return waxing ? "Waxing Crescent" : "Waning Crescent";
    return waxing ? "Waxing Gibbous" : "Waning Gibbous";
  }

  function geocode(q) {
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
            + encodeURIComponent(q);
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("lookup failed (" + r.status + ")");
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.length) throw new Error("Couldn't find that place — try adding a state or country.");
        return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon),
                 name: j[0].display_name.split(",").slice(0, 2).join(",").trim() };
      });
  }

  function build(catalog, place, when, title) {
    var lat = place.lat, lon = place.lon;
    var t0 = when.getTime();
    var offMin = -when.getTimezoneOffset();
    var win = UTSEphem.window(t0, lon, lat, -WINDOW_MIN, STEP_MIN, WINDOW_MIN);

    /* the sample at offset 0 describes the moment itself */
    var mid = win.samples[Math.round(WINDOW_MIN / STEP_MIN)];
    var frac = mid.moon[2], waxing = mid.moon[3];
    var showers = activeShowers(when.getMonth() + 1, when.getDate());

    var events = [phaseName(frac, waxing) + " · " + Math.round(frac * 100) + "% illuminated"];
    showers.forEach(function (s) {
      events.push(s.name + " meteors active · peak " + s.peak);
    });

    var meta = {
      title: (title || "YOUR SKY").toUpperCase(),
      subtitle: "", place: place.name, lat: lat, lon: lon,
      theme: "classic",
      date_label: MONTHS[when.getMonth()] + " " + when.getDate() + ", " + when.getFullYear(),
      t0_epoch_ms: t0, utc_offset_min: offMin,
      events: events, occasion: null, showers: showers
    };

    var SKY = { meta: meta, window: win };
    ["stars", "names", "lines", "cons", "milky", "mw"].forEach(function (k) {
      SKY[k] = catalog[k];
    });
    return SKY;
  }

  function show(SKY) {
    $("rTitle").textContent = SKY.meta.title;
    $("rPlace").textContent = SKY.meta.place;
    $("rCoords").textContent =
      Math.abs(SKY.meta.lat).toFixed(4) + "° " + (SKY.meta.lat >= 0 ? "N" : "S") +
      "   ·   " + Math.abs(SKY.meta.lon).toFixed(4) + "° " + (SKY.meta.lon >= 0 ? "E" : "W");
    $("rEvents").textContent = SKY.meta.events.join("   ·   ");
    $("form").style.display = "none";
    /* must be an explicit value: the stylesheet rule is `#result{display:none}`,
     * so clearing the inline style would leave it hidden and sky.js would size
     * the canvas against a zero-width parent (radius goes negative). */
    $("result").style.display = "block";
    void $("result").offsetWidth;          /* flush layout before sky.js sizes */

    /* sky.js expects the slider to be #time; the form owns that id until now */
    var slider = $("time2");
    if (slider) slider.id = "time";

    window.SKY = SKY;
    var s = document.createElement("script");
    s.src = "viewer/projection.js";
    s.onload = function () {
      var s2 = document.createElement("script");
      s2.src = "viewer/sky.js";
      document.body.appendChild(s2);
    };
    document.body.appendChild(s);
  }

  function init() {
    var d = new Date();
    $("date").value = d.toISOString().slice(0, 10);
    try {
      $("tznote").textContent = "Times read in " +
        Intl.DateTimeFormat().resolvedOptions().timeZone + ".";
    } catch (e) { /* older browsers: leave blank */ }

    $("go").addEventListener("click", function () {
      var q = $("place").value.trim();
      var dv = $("date").value, tv = $("time").value || "21:30";
      $("err").textContent = "";
      if (!q) { $("err").textContent = "Where was it?"; return; }
      if (!dv) { $("err").textContent = "Pick a date."; return; }

      var parts = dv.split("-"), hm = tv.split(":");
      var when = new Date(+parts[0], +parts[1] - 1, +parts[2], +hm[0], +hm[1]);
      if (isNaN(when.getTime())) { $("err").textContent = "That date didn't parse."; return; }
      /* JPL approximate elements are only valid over this span */
      var y = when.getFullYear();
      if (y < 1800 || y > 2050) {
        $("err").textContent = "Planet positions are only accurate for 1800–2050.";
        return;
      }

      $("go").disabled = true;
      $("go").textContent = "Computing…";
      Promise.all([
        geocode(q),
        fetch("viewer/catalog.json").then(function (r) { return r.json(); })
      ]).then(function (res) {
        show(build(res[1], res[0], when, $("title").value.trim()));
      }).catch(function (e) {
        $("err").textContent = e.message || "Something went wrong.";
        $("go").disabled = false;
        $("go").textContent = "Show me that sky →";
      });
    });

    $("again").addEventListener("click", function () { location.reload(); });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
