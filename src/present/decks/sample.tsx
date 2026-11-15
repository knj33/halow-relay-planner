import { Caption, Columns, Compare, Cover, Figure, Frame, Points, Step } from '../kit';
import type { Deck } from '../types';
import { MeshHeal } from './MeshHeal';
import { hardwareSlide } from './hardware';

/**
 * Engine sample deck. It is a test card for the presentation engine, not the real talk: one slide
 * per feature (builds, layouts, every transition, live slides driving the planner). Copy it as the
 * starting point for a real deck; see docs/PRESENTATION.md.
 */
export const sampleDeck: Deck = {
  id: 'sample',
  title: 'Presentation engine sample',
  slides: [
    {
      id: 'cover',
      title: 'Cover',
      transition: 'fade',
      notes: 'Cover slide. Space or → advances; ? lists every shortcut.',
      render: () => <Cover title="HALOW" subtitle="Presentation engine sample deck" meta="Replace these slides with the real talk. Press ? for the controls." />,
    },
    {
      id: 'builds',
      title: 'Builds',
      steps: 3,
      notes: 'Three build steps. Each press of Next reveals one point; Previous hides them again in reverse.',
      render: () => (
        <Frame kicker="Builds" title="Points arrive one press at a time">
          <Points
            items={[
              'A slide declares how many build steps it has.',
              'Each Step element appears at its step and keeps its space while hidden, so nothing reflows.',
              'Going back from the next slide lands on this one fully built.',
            ]}
          />
        </Frame>
      ),
    },
    {
      id: 'columns',
      title: 'Columns and figures',
      steps: 2,
      transition: 'rise',
      notes: 'Two-column layout with figures. The figures are the second and third build.',
      render: () => (
        <Frame kicker="Layout" title="Columns and figures">
          <Columns ratio="1.1fr 1fr">
            <div className="pz-prose">
              <p>Slides are laid out once at 1920 × 1080 and scaled to the screen with a single transform. Text wraps the same on a laptop and on a projector.</p>
              <p>Figures here are placeholders until the real deck is written.</p>
            </div>
            <div className="pz-figures">
              <Step at={1}>
                <Figure value="200" unit="km" label="Side of the premade demo area" />
              </Step>
              <Step at={2}>
                <Figure value="63" label="Relays the planner placed in it" />
              </Step>
            </div>
          </Columns>
        </Frame>
      ),
    },
    {
      id: 'transitions',
      title: 'Transitions',
      transition: 'fade',
      notes: 'Transitions available: slide (default), fade, rise, none. All animate only opacity and transform.',
      render: () => (
        <Frame kicker="Motion" title="Four transitions, all on the compositor">
          <Points from={0} items={['slide: the default, a short horizontal move with a fade', 'fade: a cross-fade', 'rise: a short vertical move with a fade', 'none: an instant cut']} />
          <p className="pz-small">With reduced motion requested by the system, every transition becomes a quick cross-fade.</p>
        </Frame>
      ),
    },
    {
      id: 'satellite-vs-mesh',
      title: 'Relay satellite vs surface mesh',
      steps: 3,
      transition: 'rise',
      notes:
        'Three builds, one row each. 1) Speed: Lunar Pathfinder relays surface data to Earth over X-band; 384,400 km / c = 1.28 s each way before any processing. Across 100 km of surface, light takes 0.33 ms; each hop adds its own radio processing on top. 2) Terrain: a sky link needs the satellite or Earth above the local skyline, so crater walls and ridges cut the usable time. NASA\'s Artemis III site selection prefers regions with more Earth visibility if it uses direct-to-Earth comms. A mesh puts relays on rims and ridges and hops around obstacles. 3) Failure: Pathfinder is one 280 kg spacecraft. A mesh has multiple possible routes, so losing one relay reroutes traffic (next slide shows it).',
      render: () => (
        <Frame kicker="Moon · Communications" title="Relay satellite or surface mesh?">
          <Compare
            leftTitle="Relay satellite"
            rightTitle="HaLow surface mesh"
            rows={[
              {
                label: 'Speed',
                left: {
                  figure: '≥ 1.28 s',
                  text: (
                    <>
                      Each way, through Earth. Lunar Pathfinder relays surface data to Earth<sup>1</sup>, 384,400 km away<sup>2</sup>: light alone takes 1.28 s.
                    </>
                  ),
                },
                right: {
                  figure: '0.33 ms',
                  text: 'Crew-to-base traffic stays on the surface: light crosses 100 km in 0.33 ms, plus each hop’s radio processing.',
                },
              },
              {
                label: 'Terrain',
                left: {
                  figure: 'Skyline-bound',
                  text: (
                    <>
                      The link works only while the satellite or Earth is above the local skyline. At the south pole, Earth visibility varies by site, and NASA weighs it when choosing landing regions<sup>3</sup>.
                    </>
                  ),
                },
                right: {
                  figure: 'Goes around',
                  text: 'Relays stand on rims and ridges and hop around a hill or down into a crater, so coverage follows the ground.',
                },
              },
              {
                label: 'Failure',
                left: {
                  figure: '1 craft',
                  text: (
                    <>
                      Lunar Pathfinder is a single 280 kg spacecraft<sup>1</sup>. If it fails, the link is gone until a replacement launches.
                    </>
                  ),
                },
                right: {
                  figure: 'Many routes',
                  text: 'Multiple possible routes: lose one relay and traffic reroutes through its neighbours.',
                },
              },
            ]}
            sources={[
              <>ESA / eoPortal, “Lunar Pathfinder”: one 280 kg spacecraft in an elliptical lunar frozen orbit, relaying S-band/UHF from the surface to Earth over X-band; 8-year design life.</>,
              <>NASA NSSDC, Moon Fact Sheet: mean Earth–Moon distance 384,400 km (384,400 km ÷ speed of light = 1.28 s; 100 km ÷ speed of light = 0.33 ms).</>,
              <>T. George, M. A. Rubio, S. J. Lawrence, P. Curell, “Artemis III Site Selection Update: Downselection From Thirteen to Nine Candidate Regions”, Lunar and Planetary Science Conference 2026, NASA NTRS 20250011660.</>,
            ]}
          />
        </Frame>
      ),
    },
    {
      id: 'mesh-heals',
      title: 'A mesh heals itself',
      steps: 2,
      transition: 'fade',
      notes:
        'Animated, two builds. Start: signal pulses flow A to B hop by hop. Next: the centre relay goes dark, the route past it turns red and B reports no signal. Next: a standby relay wakes, fills the gap, the new route draws in green and the pulses reach B again. The live slides after this show the same thing on the real 200 km plan.',
      render: () => (
        <Frame kicker="Mesh networks · Self-healing" title="One relay goes dark. The signal still arrives.">
          <MeshHeal />
        </Frame>
      ),
    },
    hardwareSlide,
    {
      id: 'live-demo',
      title: 'Live: the 200 km demo',
      kind: 'live',
      notes: 'Live slide. onEnter loads the bundled demo and shows the survey map. The planner is interactive: pan and zoom while talking. PageDown or L then → to move on.',
      onEnter: async (app) => {
        await app.loadPremadeDemo();
        app.setView('survey');
      },
      render: () => (
        <Caption title="Live planner">
          <p>The slide hands the screen to the real app. This one loaded the premade Arcadia Planitia scenario on entry.</p>
        </Caption>
      ),
    },
    {
      id: 'live-failure',
      title: 'Live: a relay fails',
      kind: 'live',
      steps: 1,
      notes: 'Entering restores every node. The build step is just a cue: press Next to fail a random relay on the route; the map animates the reroute.',
      onEnter: (app) => {
        app.setView('survey');
        app.restoreAll();
      },
      // Builds can drive the planner too: step 1 fails a relay, stepping back restores it.
      onStep: (app, step) => (step >= 1 ? app.randomFailure() : app.restoreAll()),
      render: ({ step }) => (
        <Caption title={step ? 'A relay went dark' : 'Fail a relay'}>
          <p>{step ? 'The network and the crew path re-plan around it, and the signal keeps flowing.' : 'Press Next to knock out a random relay on the route.'}</p>
        </Caption>
      ),
    },
    {
      id: 'live-3d',
      title: 'Live: 3D relief',
      kind: 'live',
      onEnter: (app) => {
        app.restoreAll();
        app.setView('3d');
      },
      notes: 'The same scenario in the 3D relief view. Drag to rotate while the planner has control.',
      render: () => (
        <Caption title="3D relief">
          <p>Any view of the planner can be a slide.</p>
        </Caption>
      ),
    },
    {
      id: 'end',
      title: 'End',
      transition: 'fade',
      notes: 'Closing slide. Esc returns to the planner.',
      render: () => <Cover title="Questions" subtitle="End of the sample deck" meta="Esc returns to the planner" />,
    },
  ],
};
