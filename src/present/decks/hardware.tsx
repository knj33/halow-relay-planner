import { Frame } from '../kit';
import type { SlideDef } from '../types';
import { HW_MODELS, HardwareShowcase } from './HardwareShowcase';

/** The hardware slide (both PCBs turning in their enclosures), shared by the SMMS and sample decks. */
export const hardwareSlide: SlideDef = {
  id: 'hardware',
  title: 'The hardware',
  transition: 'fade',
  notes:
    'Both boards are the real KiCad designs, exported to 3D and turning slowly. Left: the relay node, 46 × 110 mm, 2 copper layers, 57 parts: ESP32-S3 controller, SX1262 sub-GHz radio module on 868/915 MHz through a u.FL antenna port, solar input with a BQ24074 charger and a 1S Li-ion cell, INA219 power monitor, GPS and microSD. Right: the base station, 240 × 180 mm, 12 copper layers, 818 parts: AMD XQR Versal SoC (XQRVE2302), two Morse Micro MM6108 Wi-Fi HaLow radios with Skyworks SKY66423 front ends, a Vorago VA41630 supervisor and TI TPS7H radiation-hardened power. The models are shown at the same on-screen size; the base station is about twice as long in reality. Base station parts are coloured by type so the density shows (yellow resistors, cyan capacitors, violet inductors, pink ICs). Each board sits in a simple illustrative box enclosure with a solar panel as its lid. On a ~10 s loop the box stays closed for 3 s, then the lid rises and fades and the walls clear so the whole PCB shows for about 4 s, then it closes again. Antennas exit the box above or beside the real antenna connectors (J32/J33 HaLow SMA on the base station, through the side wall; J7 u.FL on the node, through the lid). The enclosures, panels and antennas are not part of the PCB files.',
  render: () => (
    <Frame title="Two boards: a relay node and a base station">
      <HardwareShowcase
        items={[
          {
            url: HW_MODELS.node,
            name: 'Relay node',
            specs: '46 × 110 mm · 2 layers · 57 parts',
            detail: 'ESP32-S3 controller and a sub-GHz radio (SX1262, 868/915 MHz). Runs on a solar panel and a Li-ion cell, with GPS and a microSD logger.',
            // Whip above the u.FL antenna port J7 at its exported position (quarter wave at 868 MHz ≈ 86 mm), standing on the solar lid.
            dressing: { antennas: [[0.1375, 0.0016, 0.161]], antennaM: 0.086, shell: true },
          },
          {
            url: HW_MODELS.base,
            name: 'Base station',
            specs: '240 × 180 mm · 12 layers · 818 parts',
            detail: 'AMD XQR Versal SoC, two Morse Micro MM6108 Wi-Fi HaLow radios with Skyworks front ends, a Vorago supervisor and radiation-hardened TI power.',
            // Parts coloured by type (baked into the GLB); antennas on the HaLow SMA ports J32 (HALOW_A) and J33 (HALOW_B) at their exported positions.
            dressing: {
              antennas: [
                [0.2667, 0.0019, 0.126],
                [0.2667, 0.0019, 0.18],
              ],
              edgeMount: true,
              antennaM: 0.15,
              shell: true,
            },
          },
        ]}
      />
    </Frame>
  ),
};
