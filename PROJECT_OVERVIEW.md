# HaLow Relay Planner — What It Does and How It Works

## In one sentence

HaLow Relay Planner is a browser tool that works out **where to put small radio relays so that two places on the surface of the Moon, Mars or Earth can talk to each other**, using real terrain data, and then shows whether that relay network is a better deal than the conventional alternatives.

---

## The problem it solves

Imagine a crew habitat at one spot on the Moon and a science site or rover depot a few kilometres away. They need a reliable local radio link. On the Moon and Mars this is harder than it sounds:

- **The horizon is close.** Both bodies are much smaller than Earth, so the ground curves away quickly. Two 3 m masts lose sight of each other on flat ground at about **6.5 km on the Moon** and **9 km on Mars**, compared with about 14 km on Earth.
- **Terrain gets in the way.** Crater rims, ridges, rilles and canyon walls block radio signals.
- **Everything is expensive to deliver.** Every kilogram sent to the surface costs a great deal, so a heavy 30 m tower or a satellite terminal for every user is very costly.

The project's idea is to use **Wi-Fi HaLow (IEEE 802.11ah)**, a low-power, long-range, sub-GHz Wi-Fi standard, on **small, light relay nodes** placed on high ground. Signals hop from node to node around obstacles, like stepping stones. The planner answers the practical questions:

1. Can A and B talk directly?
2. If not, how few relays are needed, and where should they go?
3. What happens if a relay fails?
4. Can a base station reach an orbiting relay satellite to connect the network to the outside?
5. Is this cheaper and better than the alternatives?

---

## What you do with it

### 1. Pick a world
Switch between **Earth**, **Moon** and **Mars** at the top. Each world has its own radius, terrain data, imagery, typical satellites, cost assumptions and preset locations (for example the Apollo 15 landing site, Jezero crater or the Grand Canyon).

### 2. Place your sites on the globe
The app shows a 3D globe you can spin and zoom. Click the surface to place:

| Node | Meaning |
|---|---|
| **A** and **B** | The two endpoints that must communicate (for example habitat and work site). |
| **Relay** | A small HaLow node on a short mast that passes traffic along. |
| **Base station** | A larger node with a satellite terminal that connects the local network to an orbiting relay satellite. |

You can also type exact coordinates, move or delete nodes, or press **Load demo scenario** for a ready-made example.

### 3. The app fetches real terrain
When you place a node, the app draws a square **planning area** around your sites (from 4 km up to 60 km across on the Moon and Mars, larger on Earth) and downloads real elevation data for it:

| World | Elevation source |
|---|---|
| Moon | NASA LRO **LOLA** laser altimeter map, ~118 m per pixel |
| Mars | USGS **HRSC + MOLA** blended map, 200 m per pixel (from Mars Express stereo cameras and the MGS laser altimeter) |
| Earth | Public terrain tiles (mostly SRTM) |

If the detailed data cannot be reached, the app falls back to coarser maps and **clearly labels the result as orientation only**. It never invents terrain.

### 4. See which links work, instantly
Every pair of nodes is checked as soon as you place or move anything. Links are drawn on the globe and colour-coded:

- 🟢 **Good**: clear line of sight and enough signal.
- 🟡 **Marginal**: works, but the terrain is close to the beam, so expect some fading.
- 🔴 **Fails**: blocked by terrain or curvature, or the signal is too weak.

Each link comes with a plain-English explanation, for example *"Terrain blocks geometric line of sight about 6.98 km along the path (46.8 m above the ray)"* or *"Blocked by body curvature: beyond the radio horizon for these antenna heights."*

### 5. Press "Plan relays"
The planner searches the terrain and suggests **the fewest relays** needed to connect A and B, placed on high ground. Optionally it can also find a **second, independent path** so the network survives the loss of any single relay.

### 6. Test failures
Untick any relay to simulate it breaking. The app immediately shows whether A and B are still connected, and highlights **critical nodes**: single points of failure whose loss would cut the network.

### 7. Compare against the alternatives
The **Cost & coverage** tab compares four ways to solve the same problem on the same terrain (see [below](#comparing-the-alternatives)).

### 8. Save and share
**Export JSON** saves the whole plan: node positions, radio settings, costs, terrain source and the full list of model assumptions. **Import JSON** loads it back, with every field validated.

---

## How it decides whether a link works

For each pair of nodes the planner does the same check a radio engineer would do by hand, just automatically and for every pair at once.

### Step 1: Draw the terrain profile
It samples the ground elevation along the straight line between the two antennas, every few tens of metres.

### Step 2: Account for the curvature of the world
Over distance, the surface "bulges" up between two points because the world is round. The planner adds this bulge using the actual radius of the Moon (1737.4 km), Mars (3389.5 km) or Earth (6371 km).

- On **Earth**, the atmosphere bends radio waves slightly, so signals reach a little further than straight lines suggest. This is modelled with the standard "k-factor" of 4/3, which you can edit.
- On the **Moon** there is no atmosphere, and on **Mars** the atmosphere is so thin (under 1% of Earth's) that the bending is negligible. On both, k is fixed at 1.

### Step 3: Check line of sight
Is there a clear straight line from antenna to antenna above the ground plus bulge? If not, the link **fails**, and the app says whether terrain or the curvature of the world is to blame.

### Step 4: Check the "Fresnel zone"
Radio waves don't travel as a thin line. They spread into a cigar-shaped region called the **first Fresnel zone**, and the signal weakens if terrain intrudes into it even when there is technically line of sight. At least 60% of that zone should be clear. If it isn't, the link is **marginal**, and the extra loss is estimated with a standard method (ITU-R P.526 knife-edge diffraction).

### Step 5: Check the power budget
Finally, the planner calculates how strong the signal will be when it arrives:

> **received power = transmit power + antenna gains − cable losses − distance loss − obstruction loss**

If the received power doesn't beat the receiver's sensitivity by the **required safety margin** (10 dB by default), the link **fails**. Seeing each other is not enough; there must also be enough signal.

### The default radio
The built-in radio profile is an illustrative HaLow example, not a datasheet. Every value can be edited:

| Setting | Default |
|---|---|
| Frequency | 915 MHz |
| Transmit power | 21 dBm |
| Antenna gains | 3 dBi each end |
| Antenna height | 3 m (base stations 6 m) |
| Receiver sensitivity | −98 dBm |
| Required margin | 10 dB |

With these settings the signal alone would carry about **11.6 km** over perfectly open ground. In practice terrain and curvature usually limit range well before that, which is exactly why relays are needed.

---

## How the relays are placed

1. **Find candidate sites.** The planning area is divided into a grid of cells (about one per 1.2 km). In each cell the **highest point** becomes a candidate relay site, because high ground sees further.
2. **Test every pair.** Every pair of candidates and existing nodes within radio range is checked with the full link test above.
3. **Find the cheapest route.** Treating working links as roads between towns, the planner searches for the route from A to B that needs the **fewest new relays**. Relays and base stations you've already placed are reused for free. Among equally short routes it picks the one whose **weakest link is strongest**.
4. **Add redundancy (optional).** It looks for a second route that shares no relay with the first, turning a fragile chain into a resilient mesh.
5. **Connect base stations.** Each base station is joined to the network with as few extra relays as possible.

The result is a good, explainable answer, but it is a heuristic: it only considers the sampled candidate sites. "No feasible route" means none was found among those samples, not that none exists. A denser grid, taller masts or more power may find one.

### Network health
After planning, the app reports:

- **Topology**: *direct* (A and B see each other), *chain* (one path), *mesh* (two or more independent paths) or *disconnected*.
- **Route**: every hop with its distance, received power, margin and status.
- **Weakest margin**: the most fragile link on the route.
- **Independent paths**: how many routes exist that share no relay.
- **Critical nodes**: relays whose failure would disconnect A from B.

---

## Satellite backhaul

Base stations link the local network to orbiting relay satellites, so the surface can reach Earth or mission control. For each base station the planner:

1. Works out where each satellite appears in the sky (direction and elevation angle) and how far away it is.
2. Scans the local **terrain skyline** in that direction. A satellite hidden behind a crater rim is no use.
3. Picks the **closest satellite** that is at least 10° above the skyline, and reports its distance and the one-way signal delay.

The satellites are a fixed illustrative snapshot (for example three made-up lunar relays and three Mars relay orbiters). They are not real spacecraft positions and they don't move. Only geometry is calculated, not a satellite link budget.

---

## Comparing the alternatives

The **Cost & coverage** tab puts the relay plan side by side with three conventional options, all evaluated on the same terrain with the same radio and cost assumptions:

| Strategy | Idea |
|---|---|
| **HaLow relay network** (this plan) | Low masts, relays hop traffic around obstacles, base stations uplink to satellites. |
| **No relay nodes** | The same radios with the relays removed. Shows what you'd get without the planner. |
| **Traditional tall masts** | Fewer, much taller towers (10 m on the Moon and Mars, 30 m on Earth), placed by the same planner. |
| **Satellite terminal per user** | No surface network at all: every site and every user carries their own satellite terminal. |

For each one the app reports:

- **Does it connect A and B?**
- **Coverage**: the percentage of the area where a handheld radio (1.5 m above ground) could get service, shown as a map overlay on the globe.
- **Total cost**: hardware plus installation plus **mass × delivery cost per kg**.
- **Issues** such as *over budget*, *coverage gap*, *single point of failure*, *no satellite visible* or *every additional user needs a terminal*.

### Why delivery cost dominates
On the Moon and Mars, getting hardware to the surface costs far more than the hardware itself. The default (placeholder) figures are:

| | Earth | Moon | Mars |
|---|---|---|---|
| Delivery cost | $0/kg | $1M/kg | $2.5M/kg |
| Relay node | 1.5 kg | 2 kg | 2 kg |
| Tall mast | 2,500 kg | 120 kg | 120 kg |
| Satellite terminal | 5 kg | 15 kg | 15 kg |
| Budget | $30k | $150M | $300M |

This is where light relays win. A 2 kg relay costs about $2M to land on the Moon, while a 120 kg mast costs about $120M. All cost figures are editable placeholders for comparing approaches fairly. They are not quotes.

---

## Example results from the built-in demos

Both demos place A and B about 7 km apart, on opposite sides of a terrain obstacle, with one base station between them.

| | Moon (Apollo 15, Hadley Rille) | Mars (Jezero crater rim) |
|---|---|---|
| Direct A–B link | Blocked by terrain | Blocked by the crater rim |
| Relays suggested | 1 | 1 |
| Route | A → R1 → B, 6.93 km | A → R1 → B, 8.01 km |
| Weakest margin | 16.7 dB | 15.2 dB |
| Weak point | R1 is a single point of failure | R1 is a single point of failure |

Ticking **"Add a second, independent path"** before planning adds relays until the network survives the loss of any one of them.

---

## Optional: the native terrain engine

The planner runs entirely in the browser, but downloading and resampling large terrain areas can be slow. An optional small **Linux helper program** (written in C) can run alongside it on the same computer. It downloads terrain in parallel and hands the browser a ready-made elevation grid. With it running, planning areas can be larger (up to 120 km on the Moon and Mars, 300 km on Earth) and finer. It changes only speed and area size, never the radio calculations. If it isn't running, the browser does the work itself.

---

## What it does not do

The app is upfront about its limits. They are listed in the **Assumptions** tab and written into every exported file.

- **Bare terrain only.** No boulders, landers, buildings or vegetation, so real links will usually be somewhat worse.
- **Terrain detail is limited by the data.** Features smaller than about 120 m (Moon) or 200 m (Mars; ~460 m where only MOLA data exists) are not resolved.
- **No polar regions.** Areas beyond ±84° latitude aren't supported, so the lunar south pole (a popular target for future missions) is out of reach for now.
- **Simplified radio physics.** No ground reflections, multipath, antenna patterns, interference, or effects of regolith and dust.
- **Nothing moves.** Satellites are a fixed snapshot; there is no orbit, timing, sunlight, power or battery modelling, and no throughput or latency-under-load prediction.
- **Illustrative numbers.** The radio profile, costs and satellites are examples to be replaced with real mission values.
- **Not flight-qualified engineering.** Terrestrial HaLow range tests don't prove range on the Moon or Mars, and radiation, thermal, dust and spectrum questions are outside the scope.

It is a **planning and comparison prototype**: a fast way to explore "what if" scenarios and to show, with real terrain, why a relay network makes sense.

---

## Glossary

| Term | Meaning |
|---|---|
| **Wi-Fi HaLow / 802.11ah** | A Wi-Fi standard using sub-1 GHz frequencies for long range at low power. |
| **Relay** | A node that receives and re-transmits traffic so signals can go around obstacles. |
| **Line of sight (LOS)** | An unobstructed straight line between two antennas. |
| **Radio horizon** | The distance beyond which the curvature of the world hides one antenna from another. |
| **Fresnel zone** | The region around the direct line that radio energy actually travels through; it needs to be mostly clear. |
| **Link budget** | The accounting of all gains and losses between transmitter and receiver. |
| **dBm / dB** | Logarithmic units of power and power ratio; +3 dB is roughly double, −10 dB is one tenth. |
| **Margin** | How far the received signal is above the minimum the receiver needs; the safety buffer. |
| **k-factor** | How much the atmosphere bends radio waves; 1 means no bending. |
| **Mesh vs chain** | A chain has one path (any relay failure breaks it); a mesh has backup paths. |
| **Critical node** | A node whose failure alone disconnects A from B. |
| **Backhaul** | The link from the local network to the wider world, here via satellite. |
| **LOLA / MOLA / HRSC** | Instruments that mapped the heights of the Moon (LOLA) and Mars (MOLA, HRSC). |
