#!/usr/bin/env python3
"""Generate an underthissky.net order page: an interactive sky viewer for one
moment and place, from the same catalogs/ephemerides as the printed charts.

The page is fully static and self-contained (viewer files are copied in, sky
data is embedded as JSON in equatorial coordinates; the browser projects
stars from RA/Dec + interpolated sidereal time, so the time slider is real).

  ./gen_page.py --order-id 4127985788 --date 1995-07-01 --time 21:00 \
      --lat 43.2681 --lon -82.5305 --place "Lexington, Michigan" \
      --tz America/Detroit --title "OUR FIRST DATE" --occasion first-date
"""
import argparse
import base64
import csv
import hashlib
import json
import math
import os
import shutil
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PRODUCTS = os.path.expanduser("~/biz/products")
sys.path.insert(0, PRODUCTS)

from gen.starmap import (DATA, METEOR_SHOWERS, OCCASIONS,          # noqa: E402
                         galactic_to_equatorial, moon_phase_name)
from skyfield.api import Loader, wgs84                             # noqa: E402
from skyfield.framelib import ecliptic_frame                       # noqa: E402

SALT = "uts-starlight-2026"
MAG_DISPLAY = 5.6   # stars drawn
MAG_ANCHOR = 6.5    # kept only as constellation-line anchors
WINDOW_MIN = 360    # slider = t0 +- 6h
STEP_MIN = 30

PLANETS = [("mercury", "Mercury"), ("venus", "Venus"), ("mars", "Mars"),
           ("jupiter barycenter", "Jupiter"), ("saturn barycenter", "Saturn")]


def page_code(order_id: str) -> str:
    digest = hashlib.sha256(f"uts:{order_id}:{SALT}".encode()).digest()
    return base64.b32encode(digest).decode().lower().rstrip("=")[:8]


def load_stars():
    """HYG subset + stellarium lines -> compact indexed arrays."""
    rows = []
    with open(os.path.join(DATA, "hyg.csv")) as f:
        for row in csv.DictReader(f):
            try:
                mag = float(row["mag"])
            except ValueError:
                continue
            if mag > MAG_ANCHOR or row["proper"] == "Sol":
                continue
            hip = int(row["hip"]) if row["hip"] else None
            rows.append((float(row["ra"]), float(row["dec"]), mag,
                         row["proper"], hip))

    culture = json.load(open(os.path.join(DATA, "stellarium_modern.json")))
    used_hips, raw_lines, cons = set(), [], []
    for con in culture["constellations"]:
        name = con.get("common_name", {}).get("native") or con["id"][-3:]
        ci = len(cons)
        cons.append(name)
        for seg in con["lines"]:
            for a, b in zip(seg, seg[1:]):
                raw_lines.append((a, b, ci))
                used_hips.add(a)
                used_hips.add(b)

    hip_to_idx, stars, names = {}, [], {}
    for ra, dec, mag, proper, hip in rows:
        if mag <= MAG_DISPLAY or (hip and hip in used_hips):
            idx = len(stars)
            stars.append([round(ra, 4), round(dec, 3), round(mag, 1)])
            if hip:
                hip_to_idx[hip] = idx
            if proper and mag <= MAG_DISPLAY:
                names[idx] = proper
    lines = [[hip_to_idx[a], hip_to_idx[b], ci] for a, b, ci in raw_lines
             if a in hip_to_idx and b in hip_to_idx]
    return stars, names, lines, cons


def milky_paths():
    out = []
    for b_off in (-8, -4, 0, 4, 8):
        gl = np.arange(0, 361, 3, dtype=float)
        ra, dec = galactic_to_equatorial(gl, np.full_like(gl, b_off))
        out.append([[round(float(r), 3), round(float(d), 2)]
                    for r, d in zip(ra, dec)])
    return out


def sample_window(dt0, lat, lon):
    load = Loader(DATA, verbose=False)
    ts = load.timescale()
    eph = load("de421.bsp")
    obs = eph["earth"] + wgs84.latlon(lat, lon)
    sun, moon = eph["sun"], eph["moon"]

    samples = []
    for off in range(-WINDOW_MIN, WINDOW_MIN + 1, STEP_MIN):
        t = ts.from_datetime(dt0 + timedelta(minutes=off))
        lst = (t.gast + lon / 15.0) % 24.0
        m_app = obs.at(t).observe(moon).apparent()
        s_app = obs.at(t).observe(sun).apparent()
        m_ra, m_dec, _ = m_app.radec()
        s_ra, s_dec, _ = s_app.radec()
        frac = float(m_app.fraction_illuminated(sun))
        _, mlon, _ = m_app.frame_latlon(ecliptic_frame)
        _, slon, _ = s_app.frame_latlon(ecliptic_frame)
        waxing = ((mlon.degrees - slon.degrees) % 360.0) < 180.0
        planets = []
        for key, _label in PLANETS:
            p_ra, p_dec, _ = obs.at(t).observe(eph[key]).apparent().radec()
            planets.append([round(p_ra.hours, 4), round(p_dec.degrees, 3)])
        samples.append({
            "lst": round(lst, 5),
            "moon": [round(m_ra.hours, 4), round(m_dec.degrees, 3),
                     round(frac, 3), 1 if waxing else 0],
            "sun": [round(s_ra.hours, 4), round(s_dec.degrees, 3)],
            "planets": planets,
        })
    return samples


def events_for(d, frac, waxing):
    ev = [f"{moon_phase_name(frac, waxing)} · {round(frac * 100)}% illuminated"]
    for name, (sm, sd), (em, ed), (pm, pd) in METEOR_SHOWERS:
        start, end = d.replace(month=sm, day=sd), d.replace(month=em, day=ed)
        active = start <= d <= end if start <= end else (d >= start or d <= end)
        if active:
            ev.append(f"{name} meteors active · peak "
                      f"{datetime(d.year, pm, pd):%b %-d}")
    return ev


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--order-id", required=True)
    ap.add_argument("--date", required=True)
    ap.add_argument("--time", default="21:00")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--place", required=True)
    ap.add_argument("--tz", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default=None)
    ap.add_argument("--occasion", default=None, choices=list(OCCASIONS))
    ap.add_argument("--theme", default="classic")
    a = ap.parse_args()
    subtitle = a.subtitle or (OCCASIONS[a.occasion] if a.occasion else "")

    dt0 = datetime.fromisoformat(f"{a.date}T{a.time}").replace(
        tzinfo=ZoneInfo(a.tz))
    stars, names, lines, cons = load_stars()
    samples = sample_window(dt0, a.lat, a.lon)
    mid = samples[len(samples) // 2]
    events = events_for(dt0.date(), mid["moon"][2], bool(mid["moon"][3]))

    data = {
        "meta": {
            "title": a.title, "subtitle": subtitle, "place": a.place,
            "lat": a.lat, "lon": a.lon, "tz": a.tz, "theme": a.theme,
            "date_label": f"{dt0:%B %-d, %Y}",
            "t0_epoch_ms": int(dt0.timestamp() * 1000),
            "utc_offset_min": int(dt0.utcoffset().total_seconds() // 60),
            "events": events,
        },
        "window": {"start_min": -WINDOW_MIN, "step_min": STEP_MIN,
                   "samples": samples,
                   "planet_names": [lbl for _k, lbl in PLANETS]},
        "stars": stars,
        "names": names,
        "lines": lines,
        "cons": cons,
        "milky": milky_paths(),
    }

    coords = (f"{abs(a.lat):.4f}° {'N' if a.lat >= 0 else 'S'}   ·   "
              f"{abs(a.lon):.4f}° {'W' if a.lon < 0 else 'E'}")
    tpl = open(os.path.join(HERE, "viewer", "template.html")).read()
    html = (tpl.replace("%%TITLE%%", a.title)
               .replace("%%SUBTITLE%%", subtitle)
               .replace("%%PLACE%%", a.place)
               .replace("%%COORDS%%", coords)
               .replace("%%DATE_LABEL%%", data["meta"]["date_label"])
               .replace("%%EVENTS%%", "   ·   ".join(events))
               .replace("%%T_MIN%%", str(-WINDOW_MIN))
               .replace("%%T_MAX%%", str(WINDOW_MIN))
               .replace("%%DATA%%", json.dumps(data, separators=(",", ":"))))

    code = page_code(a.order_id)
    out = os.path.join(HERE, "s", code)
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "index.html"), "w").write(html)
    for f in ("sky.js", "sky.css"):
        shutil.copy(os.path.join(HERE, "viewer", f), os.path.join(out, f))
    size_kb = os.path.getsize(os.path.join(out, "index.html")) / 1024
    print(f"https://underthissky.net/s/{code}/  ({size_kb:.0f} KB, "
          f"{len(stars)} stars, {len(lines)} lines)")


if __name__ == "__main__":
    main()
