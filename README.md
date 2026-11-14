# HaLow Relay Planner (Earth / Moon / Mars)

A browser prototype for planning Wi-Fi HaLow relay deployments between two surface points, A and B, on Earth, the Moon or Mars. It runs on one seamless, Google-Earth-style globe: click the surface to place nodes, stream real elevation for the resulting planning area, place relays, check every link against terrain and a link budget, attach base stations to the nearest visible satellite, and compare the relay plan with conventional alternatives.

It is a communications planning prototype. It has not been checked against the full requirements of any particular NASA Space Apps challenge.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine and store tests (Vitest)
make -C native test # native request, failure and thread-pool regression tests
npm run build      # type-check + production build in dist/
npm run preview    # serve the production build
```

No backend, accounts or API keys. Imagery, elevation and the lunar and Martian DEMs stream public data over the internet; the bundled base maps and synthetic terrain work offline.

## Data sources by body

| Body | Planning elevation (fallbacks in order) | Globe imagery |
|---|---|---|
| Earth | Mapzen Terrain Tiles on AWS | Sentinel-2 cloudless (EOX) |
| Moon | USGS LRO LOLA 118 m → bundled LOLA 16 px/deg | LRO WAC mosaic via NASA Moon Trek |
| Mars | USGS HRSC + MOLA blend 200 m → USGS MOLA 463 m → bundled MOLA MEGDR 16 px/deg | Viking MDIM 2.1 colour mosaic via NASA Mars Trek |

The bundled Mars assets are rebuilt with `node scripts/build-mars-tiles.mjs <megt90n000eb.img>` (NASA PDS MOLA MEGDR) and `python scripts/build-trek-base.py <Mars Trek tile URL> public/base/mars.jpg 2`.

## Optional native Relay Engine

The planner works on its own. It can also use a small native helper, built from `native/` in C for x86-64-v3 (`-O3 -march=x86-64-v3 -mtune=native -flto`), which downloads and resamples terrain with a thread pool and returns a compact binary grid over loopback.

```bash
sudo apt install build-essential libcurl4-openssl-dev libpng-dev   # Debian / Ubuntu
cd native
make
make install           # optional: ~/.local/bin/relay-engine, no sudo
./relay-engine          # http://127.0.0.1:8765
```
