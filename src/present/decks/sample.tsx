import { Caption, Columns, Cover, Figure, Frame, Points, Step } from '../kit';
import type { Deck } from '../types';

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
