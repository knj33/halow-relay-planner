import type { BodyId, TerrainMeta } from './types';

export interface AssumptionGroup {
  title: string;
  items: string[];
}

/** Shown in the Assumptions panel and written into every export so a file carries its own caveats. */
export function modelAssumptions(body: BodyId, terrain?: TerrainMeta | null): AssumptionGroup[] {
  const real = terrain && !terrain.synthetic;
  return [
    {
      title: 'Terrain',
      items: [
        real
          ? `Real elevation: ${terrain!.attribution}`
          : 'Synthetic demonstration terrain: procedurally generated, deterministic, and not a real location on Earth, the Moon or Mars. Choose a site on the globe to plan on real elevation instead.',
        'The regional grid is 257 × 257 points in a local east/north frame centred on the site (azimuthal equidistant on a sphere of the body radius). Elevation data is resampled bilinearly, so terrain detail finer than the source resolution or grid spacing is not represented.',
        body === 'earth'
          ? 'Earth elevation comes from a blend of public DEMs (mostly SRTM on land). It is a surface model with gaps filled and is not survey grade; heights may be referenced to a geoid rather than the ellipsoid used for curvature, which does not affect relative terrain blocking.'
          : body === 'moon'
            ? 'Lunar elevation is LRO LOLA, heights relative to a 1737.4 km sphere. Near the poles the cylindrical mosaic cannot be used and permanently shadowed terrain is not specially treated.'
            : 'Mars elevation is the USGS HRSC + MOLA blended DEM (200 m per pixel), heights relative to the MOLA areoid. Where Mars Express HRSC stereo coverage is missing the blend carries MOLA laser altimetry, whose true resolution is coarser (~460 m), so small craters and scarps there are smoothed. Near the poles the cylindrical mosaic cannot be used.',
        'The globe view (imagery and relief) is for orientation and site choice only; link calculations use the regional grid above, never the globe.',
        'All calculations use metres. Vertical exaggeration, mast size and satellite positions in the 3D view are rendering choices only and never enter the physics.',
        'Elevation data alone does not include buildings, vegetation, boulders, landers or other clutter. Real links will usually be worse than a bare-terrain estimate.',
      ],
    },
    {
      title: 'Propagation model',
      items: [
        'Path loss is free-space loss plus one knife-edge diffraction estimate (ITU-R P.526 single-edge approximation) for the worst terrain intrusion.',
        'Geometric line of sight and first-Fresnel-zone clearance (60%) are checked separately. A link with clear line of sight but an obstructed Fresnel zone is shown as marginal.',
        'Terrain visibility is necessary, not sufficient: a link is called feasible only if received power also meets sensitivity plus the required margin.',
        body === 'earth'
          ? 'Earth curvature uses a 6371 km radius with an editable effective-radius factor (default k = 4/3, a standard-atmosphere convention that varies with weather).'
          : body === 'moon'
            ? 'Lunar curvature uses a 1737.4 km radius with k = 1. There is no atmosphere, so no atmospheric refraction is assumed.'
            : 'Martian curvature uses a 3389.5 km mean radius with k = 1. The CO₂ atmosphere is about 0.6% of Earth’s surface pressure, so radio refraction is negligible and none is assumed.',
        'Not modelled: ground reflection and multipath, antenna patterns and polarisation, interference, noise-floor variation, rain or foliage loss, regolith electrical properties, and multi-edge diffraction.',
        ...(body === 'mars'
          ? ['Not modelled on Mars: dust-storm attenuation and dust on antennas (expected to be small at sub-GHz frequencies), ionospheric effects, and seasonal CO₂ frost.']
          : []),
      ],
    },
    {
      title: 'Radio profile',
      items: [
        'The example HaLow profile is illustrative. It is not a datasheet, a regulatory limit or a qualified hardware specification.',
        body === 'mars'
          ? 'Terrestrial Wi-Fi HaLow range demonstrations do not establish range on Mars. Mars hardware qualification (thermal cycling, radiation, dust) and spectrum coordination for the Martian surface are outside this prototype.'
          : 'Terrestrial Wi-Fi HaLow range demonstrations do not establish lunar range. Lunar hardware qualification (thermal, radiation, dust) and lunar spectrum authorisation are outside this prototype.',
        'No throughput, latency-under-load or battery-life prediction is made.',
      ],
    },
    {
      title: 'Automatic placement',
      items: [
        'Placement is a heuristic over sampled candidates: one candidate per grid cell at its highest elevation sample. It minimises relay count, then prefers the route whose weakest link has the most margin.',
        'It is optimal only within the sampled candidate set and this link model, not globally. A denser grid or different sampling can find a different or shorter answer.',
        '"No feasible route" means none was found among the samples, not that none can exist.',
      ],
    },
    {
      title: 'Survey map',
      items: [
        'The survey map is drawn from the same planning grid as the link calculations. Hillshade uses 3× vertical exaggeration and a fine grain texture, both for display only.',
        `Channels are where water would collect if it flowed over today's surface (D8 flow routing on the grid after filling hollows).${body === 'mars' ? ' On Mars they often follow ancient valleys, but they are derived from elevation, not mapped river beds.' : ' They are derived from elevation, not mapped watercourses.'}`,
        'Zoomed-in survey detail and the 3D relief view are drawn from a smooth (bicubic) interpolation of the grid. Below the elevation source resolution, the smoothness and sharp lines are interpolation, not measured detail. The 3D view applies body curvature like the link model; its vertical exaggeration is display only and scales terrain and antenna heights together.',
        'Depressions are closed hollows found by filling the grid; most are craters. Depth is the fill depth at the deepest sample and is limited by the grid spacing.',
        'The crew path runs from A through the crew waypoints, in order, to B. It is an A* search on the grid with three tiers of cost: crossing a hazard (ground steeper than the walking limit, within the cliff buffer, within the crater-rim buffer, or inside a drawn no-go zone) costs far more than walking without radio signal, which costs more than effort (grade and roughness). So it is the safest path first, then the best covered, then the easiest. If no fully safe or fully covered path exists it still returns one and reports every hazard crossing and every stretch without signal.',
        'Cliffs are grid cells steeper than the cliff slope; craters are closed depressions deeper than the minimum depth found by filling the grid. Buffers are measured from those cells. Rocks, boulders, soil strength, lighting and anything smaller than one grid cell are not modelled.',
        "Crew radio coverage is a line-of-sight test from each working relay, base station and endpoint that still connects to A or to a base station (a relay cut off by a failure relays nothing, so it does not count) to a radio at the client antenna height, within the free-space range at the required margin, with curvature as in the link model. It allows nothing for Fresnel-zone obstruction or diffraction, so it is slightly more optimistic than the link model's own link evaluation.",
        'The failure simulation switches a node off and recomputes everything from that state: the radio route, the coverage and the crew path. It does not model how long a real network takes to notice a failure or converge.',
      ],
    },
    {
      title: 'Satellite backhaul',
      items: [
        'Satellites are a fixed illustrative snapshot, not an ephemeris or a real constellation. Real satellites move; visibility changes minute to minute.',
        'A base station picks the closest satellite that clears the local terrain skyline by the minimum elevation. Only geometry (range, elevation, light-time delay) is computed; no satellite link budget is claimed.',
      ],
    },
    {
      title: 'Cost and comparison',
      items: [
        'All cost figures are editable placeholders for comparing architectures on equal footing. They are not quotes or mission estimates. Operating costs, service fees, power and maintenance are excluded.',
        'Coverage is the share of sampled cells from which a client radio can close a link, by the same link model, to the network connected to endpoint A.',
        'The tall-mast alternative reuses the same radio and placement heuristic with a taller antenna; it is a like-for-like geometry comparison, not a cellular network design.',
      ],
    },
  ];
}
