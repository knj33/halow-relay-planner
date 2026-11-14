import type { BodyId } from './engine';
import type { GeoPoint } from './engine/terrain/geo';

export interface Preset {
  name: string;
  lat: number;
  lon: number;
  note: string;
}

/** Well-known sites with interesting relief. Coordinates are approximate centres (Mars: planetocentric, east-positive). */
export const PRESETS: Record<BodyId, Preset[]> = {
  earth: [
    { name: 'Grand Canyon, USA', lat: 36.1, lon: -112.11, note: 'Deep canyon, strong terrain blocking' },
    { name: 'Mont Blanc massif, Alps', lat: 45.86, lon: 6.88, note: 'Alpine ridges and valleys' },
    { name: 'Mount Everest, Himalaya', lat: 27.99, lon: 86.93, note: 'Extreme relief' },
    { name: 'Atacama, Chajnantor plateau', lat: -23.02, lon: -67.75, note: 'High desert plateau' },
    { name: 'Mauna Kea, Hawaii', lat: 19.82, lon: -155.47, note: 'Shield volcano summit' },
    { name: 'Longyearbyen, Svalbard', lat: 78.22, lon: 15.63, note: 'Arctic fjord terrain' },
  ],
  moon: [
    { name: 'Apollo 15, Hadley Rille', lat: 26.13, lon: 3.63, note: 'Sinuous rille beside the Apennine mountains' },
    { name: 'Apollo 17, Taurus-Littrow', lat: 20.19, lon: 30.77, note: 'Valley between massifs' },
    { name: 'Apollo 11, Tranquility Base', lat: 0.674, lon: 23.473, note: 'Flat mare plain' },
    { name: 'Tycho crater rim', lat: -43.3, lon: -11.36, note: 'Young crater, steep walls' },
    { name: 'Copernicus crater', lat: 9.62, lon: -20.08, note: 'Large complex crater' },
    { name: 'Aristarchus plateau', lat: 23.7, lon: -47.4, note: 'Plateau and Vallis Schröteri' },
  ],
  mars: [
    // Checked on the HRSC + MOLA grid through plan → auto-fit → reload: the rim blocks the demo A–B
    // link, one relay bridges it with ~15 dB margin, and the planning area does not have to grow.
    { name: 'Jezero crater, north-east rim (Perseverance)', lat: 18.619, lon: 77.832, note: 'Crater rim between the floor and the outer plains' },
    { name: 'Gale crater, Aeolis Mons (Curiosity)', lat: -4.59, lon: 137.44, note: 'Crater floor beside a 5 km central mound' },
    { name: 'Valles Marineris, Candor Chasma', lat: -6.5, lon: -71.0, note: 'Canyon walls several kilometres deep' },
    { name: 'Olympus Mons caldera', lat: 18.4, lon: -133.9, note: 'Summit caldera of the largest volcano' },
    { name: 'Utopia Planitia (Zhurong)', lat: 25.07, lon: 109.93, note: 'Smooth northern lowland plain' },
    { name: 'Elysium Planitia (InSight)', lat: 4.5, lon: 135.62, note: 'Flat lava plain' },
    // HiRISE ESP_060706_2195. Also the centre of the premade 200 km "Demo" scenario (public/demo).
    { name: 'Arcadia Planitia (SpaceX Starship candidate site)', lat: 39.09, lon: -170.21, note: 'Ice-rich northern plain proposed for Starship landings' },
  ],
};

/** Which preset each body's demo scenario is built around. */
export const DEMO_PRESET: Record<BodyId, number> = { earth: 1, moon: 0, mars: 0 };

/** Demo scenario centres: taken from a preset so the preset list and the demo agree. */
export const DEMO_SITES: Record<BodyId, GeoPoint> = {
  earth: { lat: PRESETS.earth[DEMO_PRESET.earth].lat, lon: PRESETS.earth[DEMO_PRESET.earth].lon },
  moon: { lat: PRESETS.moon[DEMO_PRESET.moon].lat, lon: PRESETS.moon[DEMO_PRESET.moon].lon },
  mars: { lat: PRESETS.mars[DEMO_PRESET.mars].lat, lon: PRESETS.mars[DEMO_PRESET.mars].lon },
};

/** Demo A/B offsets from the demo centre, metres east and north (A at minus, B at plus). */
export const DEMO_SPAN: Record<BodyId, { east: number; north: number }> = {
  earth: { east: 3000, north: 2000 },
  moon: { east: 2500, north: 1500 },
  mars: { east: 3000, north: 2000 },
};
