#!/usr/bin/env python3
"""Derive compact Milky Way isophote levels for the viewer.

Source: d3-celestial's mw.json (Olaf Frohn, BSD-3-Clause) — five nested
isophote MultiPolygons in equatorial GeoJSON ([lon_deg -180..180, dec]).
We decimate to background-grade resolution and ship 4 levels (outermost ->
core), rings rendered with the evenodd rule so disjoint patches and the
Great Rift holes articulate as absence of glow.

Attribution retained per BSD-3: portions derived from d3-celestial
(https://github.com/ofrohn/d3-celestial), (c) Olaf Frohn, BSD-3-Clause.
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data_src_mw.json")
OUT = os.path.join(HERE, "viewer", "mw_levels.json")
URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/mw.json"


def decimate(ring):
    n = len(ring)
    if n < 8:
        return None                    # sub-degree specks: invisible here
    step = max(1, n // 45) if n > 60 else (3 if n > 24 else 2)
    pts = ring[::step]
    if len(pts) < 5:
        return None
    out = []
    for lon, lat in pts:
        ra_h = ((lon % 360) + 360) % 360 / 15.0
        out.append([round(ra_h, 3), round(lat, 1)])
    return out


def main():
    if not os.path.exists(SRC):
        urllib.request.urlretrieve(URL, SRC)
    d = json.load(open(SRC))
    levels = []
    for feat in d["features"]:
        if feat["id"] not in ("ol1", "ol2", "ol3", "ol4"):
            continue
        rings = []
        for poly in feat["geometry"]["coordinates"]:
            for ring in poly:
                r = decimate(ring)
                if r:
                    rings.append(r)
        levels.append(rings)
    out = {
        "attribution": ("Milky Way isophotes derived from d3-celestial "
                        "(c) Olaf Frohn, BSD-3-Clause"),
        "levels": levels,
    }
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    npts = sum(len(r) for lv in levels for r in lv)
    print(f"{OUT}: {os.path.getsize(OUT) / 1024:.0f} KB, "
          f"{len(levels)} levels, {npts} points")


if __name__ == "__main__":
    main()
