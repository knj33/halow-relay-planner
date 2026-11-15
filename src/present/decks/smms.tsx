import { Caption, Compare, Cover, Frame, Points } from '../kit';
import type { Deck, Lang } from '../types';
import { MeshArtCut, MeshArtHealthy } from './MapArt';
import { MeshHeal } from './MeshHeal';
import { hardwareSlide } from './hardware';

/** The demo's last build step, so stepping back from the 3D view does not fail a second relay. */
let demoStep = 0;
/** Hill height for the 3D showcase: the slider's top end is 12×; 10× reads best on this site. */
const RELIEF_EXAGGERATION = 10;

/** Pick the text for the deck's language (Georgian first, English second). */
const t = <T,>(lang: Lang, ka: T, en: T): T => (lang === 'en' ? en : ka);

/**
 * SMMS: Spacial Mars Mesh Systems. The team's talk (the default deck), in Georgian with an
 * English version (faint toggle at the top; English shows slides 1–7, without the thank-you).
 *
 * 1 title · 2 problem · 3 mesh example (animated) · 4 relay orbiter vs mesh, for Mars, with
 * sources · 5 hardware · 6 SSA Mesh Oriented OS · 7 live demo (preloaded when the deck opens;
 * builds play by themselves after 20 s: a relay fails, then the 3D relief) · 8 thanks (Georgian).
 */
export const smmsDeck: Deck = {
  id: 'smms',
  title: 'SMMS · Spacial Mars Mesh Systems',
  langs: ['ka', 'en'],
  notice: { en: 'Includes AI-generated content' },
  // Preload the live demo while the title slide is up, so the demo opens with no loading screen.
  // A short delay keeps the opening transition smooth: building the survey layers is CPU work.
  onOpen: (app) => new Promise<void>((resolve) => window.setTimeout(() => resolve(app.ensureDemo()), 1200)),
  slides: [
    {
      id: 'title',
      title: 'Title',
      transition: 'fade',
      notes: 'SMMS: Spacial Mars Mesh Systems. Team: Svanetisubani Space Agency (SSA). The live demo is loading in the background while this slide is up.',
      render: () => (
        <>
          <Cover title="SMMS" subtitle="Spacial Mars Mesh Systems" meta="Team: Svanetisubani Space Agency (SSA)" />
          <MeshArtHealthy />
        </>
      ),
    },
    {
      id: 'problem',
      title: 'პრობლემა / The problem',
      steps: 3,
      notes: 'Three builds. 1) Getting from A to B safely. 2) Optimally. 3) Having a communication channel the whole way.',
      render: ({ lang }) => (
        <>
          <Frame title={t(lang, 'პრობლემა', 'The problem')}>
            <Points
              numbered
              items={t(lang, ['A - დან B მდე მისვლა უსაფრთხოდ', 'ოპტიმალურად', 'საკომუნიკაციო არხის არ ქონა'], ['Getting from A to B safely', 'Optimally', 'Not having a communication channel'])}
            />
          </Frame>
          <MeshArtCut />
        </>
      ),
    },
    {
      id: 'mesh-example',
      title: 'Mesh System Example',
      steps: 2,
      transition: 'fade',
      notes:
        'Animated, two builds. Start: signal pulses flow A to B hop by hop. Next: an access point on the route goes dark, the route past it turns red and B reports no signal. Next: a standby relay wakes, fills the gap, the new route draws in green and the pulses reach B again.',
      render: () => (
        <Frame title="Mesh System Example">
          <MeshHeal />
        </Frame>
      ),
    },
    {
      id: 'satellite-vs-mesh',
      title: 'თანამგზავრი თუ მეშ ქსელი? / Satellite or mesh?',
      steps: 3,
      transition: 'rise',
      notes:
        "Three builds, one row each, all about Mars. 1) Speed: today's Mars relay orbiters pass surface data on to Earth, and the signal takes about 4 to 24 minutes each way depending on where the planets are (ESA). On the surface, light crosses 100 km in 0.33 ms; each hop adds its own radio processing. 2) Terrain: an orbiter only helps while it is above the local skyline, and each relay orbiter passes a site only 2 to 4 times a day (NASA Mars Relay Network page, June 2026); crater walls and ridges shorten every pass. A mesh puts relays on rims and ridges and goes around. 3) Failure: the relay orbiters are science spacecraft that relay as a secondary job (Davis et al., NASA/JPL, 2021) and the fleet is 'fragile and aging' (National Academies, 2018). Odyssey has been at Mars since 2001; MAVEN was lost in June 2026. A mesh has multiple possible routes.",
      render: ({ lang }) => (
        <Frame title={t(lang, 'თანამგზავრი თუ მეშ ქსელი?', 'Satellite or mesh network?')}>
          <Compare
            dense
            leftTitle={t(lang, 'Relay თანამგზავრი', 'Relay orbiter')}
            rightTitle={t(lang, 'HaLow ზედაპირული მეში', 'HaLow surface mesh')}
            rows={[
              {
                label: t(lang, 'სიჩქარე', 'Speed'),
                left: {
                  figure: t(lang, '4–24 წთ', '4–24 min'),
                  text: (
                    <>
                      {t(lang, 'ეხლანდელი ტექნოლოგიით დედამიწის გავლით უწევს გასვლა', 'With today’s technology the signal has to go through Earth')}
                      <sup>1, 2</sup>
                    </>
                  ),
                },
                right: {
                  figure: t(lang, '0.33 მწმ', '0.33 ms'),
                  text: t(lang, 'კავშირი ზედაპირზე რჩება: სინათლე 100 კმ-ს 0.33 მილიწამში გადის, პლუს კვანძების დამუშავების დრო.', 'Traffic stays on the surface: light crosses 100 km in 0.33 ms, plus each hop’s processing.'),
                },
              },
              {
                label: t(lang, 'კავშირის დრო', 'Contact time'),
                left: {
                  figure: t(lang, 'დღეში 2–4 ფანჯარა', '2–4 windows a day'),
                  text: t(
                    lang,
                    <>
                      ერთი სატელიტი დღეში მაქსიმუმ 4-ჯერ გადაუვლის იგივე ადგილს<sup>2</sup>.
                    </>,
                    <>
                      One satellite passes over the same spot at most 4 times a day<sup>2</sup>.
                    </>,
                  ),
                },
                right: {
                  figure: t(lang, 'მუდმივი', 'Always on'),
                  text: t(lang, 'Node-ები კრატერის კიდეებსა და ქედებზე დგას: კავშირი მუდმივია და დაფარვა რელიეფს მიჰყვება.', 'Nodes stand on crater rims and ridges: the link is always there and coverage follows the terrain.'),
                },
              },
              {
                label: t(lang, 'მდგრადობა', 'Resilience'),
                left: {
                  figure: t(lang, 'მხოლოდ 1 სატელიტი', 'Only 1 satellite'),
                  text: t(lang, 'თუ ეს სატელიტი დაეცა, მაშინვე ვკარგავ ასტრონავტთან კონტაქტს.', 'If that satellite goes down, we lose contact with the astronaut at once.'),
                },
                right: {
                  figure: t(lang, 'ბევრი მარშრუტი', 'Many routes'),
                  text: t(lang, 'რამდენიმე შესაძლო მარშრუტი: თუ ერთი node-ი დაეცა, სიგნალი მეზობელი node-ებით გადის.', 'Multiple possible routes: if one node goes down, the signal goes through its neighbours.'),
                },
              },
            ]}
            sources={t(
              lang,
              [
                <>ESA Mars Express-ის ბლოგი, „Time delay between Mars and Earth“, 2012 წლის 5 აგვისტო: ცალმხრივი დაყოვნება დაახლოებით 4-დან 24 წუთამდე.</>,
                <>NASA Science, „Mars Relay Network“ (2026 წლის 5 ივნისი): Odyssey მარსთან 2001 წლიდან; თითო თანამგზავრი დღეში 2–4 გავლა; MAVEN დასრულდა 2026 წლის 3 ივნისს.</>,
                <>R. M. Davis, M. A. Viotti, C. D. Edwards, C. H. Lee, R. E. Gladden, „A Dedicated Relay Network to Enable the Future of Mars Exploration“, NASA/JPL, 2021 (NTRS 20220004816).</>,
                <>აშშ-ის ეროვნული აკადემიები, პლანეტარული მეცნიერების ათწლიანი კვლევის შუალედური მიმოხილვა, 2018: „სისტემა მყიფე და დაბერებულია“.</>,
              ],
              [
                <>ESA Mars Express blog, “Time delay between Mars and Earth”, 5 Aug 2012: one-way delay from about 4 to about 24 minutes.</>,
                <>NASA Science, “Mars Relay Network” (5 Jun 2026): Odyssey at Mars since 2001; 2–4 passes over a site per orbiter per day; MAVEN ended 3 Jun 2026.</>,
                <>R. M. Davis, M. A. Viotti, C. D. Edwards, C. H. Lee, R. E. Gladden, “A Dedicated Relay Network to Enable the Future of Mars Exploration”, NASA/JPL, 2021 (NTRS 20220004816).</>,
                <>National Academies, mid-term review of the planetary science decadal survey, 2018: “The system is fragile and aging.”</>,
              ],
            )}
          />
        </Frame>
      ),
    },
    hardwareSlide,
    {
      id: 'os',
      title: 'SSA Mesh Oriented OS',
      transition: 'fade',
      notes:
        'Our operating system, SSA Space 0.1, the Surface Station Appliance, shown booted in a QEMU/KVM virtual machine on Earth (an analog demo, not flight-qualified). Three OS banks (A, B, C); it runs from initramfs and the banks stay read-only. Iridium gives it a way to connect over satellite. In this run no radio or modem is attached, so those lines show searching/offline.',
      render: ({ lang }) => (
        <Frame title="SSA Mesh Oriented OS">
          <div className="pz-os">
            <figure className="pz-os-shot">
              <img src={`${import.meta.env.BASE_URL}present/ssa-os.png`} alt="SSA Space 0.1, Surface Station Appliance, booted in a QEMU/KVM virtual machine: status of OS banks, HaLow, Meshtastic mesh, Iridium, AI bank and message queue, with its command list." />
              <figcaption>SSA Space 0.1 · Surface Station Appliance, booted in QEMU/KVM</figcaption>
            </figure>
            <ul className="pz-os-points">
              <li>
                <b>A · B · C</b>
                <span>{t(lang, '3 ცალი OS Bank', '3 OS banks')}</span>
              </li>
              <li>
                <b>Read-only</b>
                <span>{t(lang, 'მუშაობს initramfs-დან, bank-ები read-only რჩება', 'Runs from initramfs; the banks stay read-only')}</span>
              </li>
              <li>
                <b>Iridium</b>
                <span>{t(lang, 'სატელიტზე დაკავშირების შესაძლებლობა', 'Can connect over satellite')}</span>
              </li>
            </ul>
          </div>
        </Frame>
      ),
    },
    {
      id: 'demo',
      title: 'Live demo',
      kind: 'live',
      // Each build plays only when the presenter presses Next: the failure, then the 3D view.
      steps: 2,
      notes:
        'Live, preloaded when the deck opened. The real planner on the 200 km Arcadia Planitia plan: 63 relays, two independent routes. Next: a relay on the route goes dark; the radio route and the crew path re-plan, the dead part turns red and the new route glows green. Next: the 3D relief with the hills raised 10×, flying once around the area (about 16 s); the red and green routes show there too. Next again moves on. L hands the arrow keys to the planner.',
      onEnter: async (app) => {
        demoStep = 0;
        await app.ensureDemo();
        app.restoreAll();
      },
      onStep: (app, step) => {
        const from = demoStep;
        demoStep = step;
        if (step === 0) {
          app.setView('survey');
          app.restoreAll();
        } else if (step === 1) {
          app.setView('survey');
          // Only fail a relay coming forward; stepping back from the 3D view keeps the same failure.
          if (from === 0) app.randomFailure();
        } else {
          app.showRelief(RELIEF_EXAGGERATION);
        }
      },
      render: ({ step, lang }) => {
        const title = step === 2 ? t(lang, '3D რელიეფი', '3D relief') : step ? t(lang, 'Access point-ი დაეცა', 'An access point went down') : 'Arcadia Planitia';
        const body =
          step === 2
            ? t(lang, 'იგივე ქსელი რელიეფზე, სიმაღლე 10×.', 'The same network on the terrain, hills raised 10×.')
            : step
              ? t(lang, 'მეში თვითაღდგენადია', 'The mesh heals itself')
              : t(lang, '200 კმ, 63 node-ი, ორი დამოუკიდებელი მარშრუტი.', '200 km, 63 nodes, two independent routes.');
        return (
          <Caption title={title}>
            <p>{body}</p>
          </Caption>
        );
      },
    },
    {
      id: 'thanks',
      title: 'მადლობა',
      // Georgian only: the English version ends on the demo.
      langs: ['ka'],
      transition: 'fade',
      notes: 'Thank you. Esc returns to the planner.',
      render: () => (
        <div className="pz-thanks">
          <img className="pz-thanks-art" src={`${import.meta.env.BASE_URL}present/kerbal.png`} alt="" />
          <Cover phrase title="მადლობა <3" />
          {/* On a white tile so the code keeps its quiet zone on the dark slide; pixel-sharp when scaled. */}
          <img className="pz-thanks-qr" src={`${import.meta.env.BASE_URL}present/qr.png`} alt="QR code" />
        </div>
      ),
    },
  ],
};
