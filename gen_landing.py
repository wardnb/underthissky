#!/usr/bin/env python3
"""Build home_sky.js — the star catalog the landing page projects live.

The landing page shows the REAL current sky over Port Huron, Michigan (the
founders' hometown): stars + constellation lines + milky way band embedded
once; the browser computes LST from Date.now() and re-projects as Earth
turns. Sun/Moon come from projection.js's low-precision series at runtime.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.expanduser("~/biz/products"))

from gen_page import load_stars, milky_paths          # noqa: E402

LAT, LON = 42.9709, -82.4249                          # Port Huron, MI


def main():
    stars, _names, lines, _cons = load_stars()
    data = {
        "lat": LAT, "lon": LON,
        "stars": stars,                       # [ra_h, dec_deg, mag]
        "lines": [[a, b] for a, b, _ci in lines],
        "milky": milky_paths(),
    }
    js = "window.HOME = " + json.dumps(data, separators=(",", ":")) + ";\n"
    path = os.path.join(HERE, "home_sky.js")
    open(path, "w").write(js)
    print(f"{path}: {os.path.getsize(path) / 1024:.0f} KB, "
          f"{len(stars)} stars, {len(lines)} lines")


if __name__ == "__main__":
    main()
