import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { bridge } from './bridge';
import { DECKS, deckById } from './decks';
import { clampPosition, commandForKey, commandForSwipe, fitStage, formatHash, goto, isFirst, isLast, last, mountWindow, next, parseHash, prev, progress, samePosition } from './engine';
import type { Command, Position } from './engine';
import { SlideCtx } from './kit';
import { usePresentation } from './state';
import type { Deck, Lang, SlideContext, SlideDef } from './types';
import './present.css';

/**
 * The presenter: a full-window overlay that plays a `Deck`.
 *
 * Performance model (see docs/PRESENTATION.md):
 * - Slides are laid out once at the deck's logical size and scaled by one CSS transform on the
 *   stage; a resize changes one style, never re-wraps text.
 * - Only the current slide and its two neighbours are mounted. Transitions animate opacity and
 *   transform only, so they run on the compositor even when the main thread is busy.
 * - Slides are memoised on (slide, step, active): the controls auto-hiding, the clock or the
 *   notes panel never re-render slide content.
 * - While a stage slide is up, the planner underneath is hidden with content-visibility and its
 *   WebGL loops stop (App reads `usePresentation`).
 */

const CHANNEL = 'halow-present';
/** Each language named in itself, for the toggle. */
const LANG_NAME: Record<Lang, string> = { ka: 'ქართული', en: 'English' };
const IDLE_MS = 2600;

function isInteractive(el: EventTarget | null): boolean {
  return el instanceof Element && !!el.closest('a, button, input, select, textarea, label, summary, [role="button"], [contenteditable="true"], .pz-controls, .pz-notes, .pz-overview, .pz-help');
}

const SlideView = memo(function SlideView({ slide, index, count, step, state, thumbnail, lang }: { slide: SlideDef; index: number; count: number; step: number; state: 'current' | 'before' | 'after'; thumbnail?: boolean; lang: Lang }) {
  const ctx: SlideContext = useMemo(() => ({ lang, step, index, count, active: state === 'current' && !thumbnail, thumbnail: !!thumbnail }), [lang, step, index, count, state, thumbnail]);
  const style: CSSProperties | undefined = slide.background ? { background: slide.background } : undefined;
  return (
    <section
      className={`pz-slide is-${state} tr-${slide.transition ?? 'slide'} kind-${slide.kind ?? 'stage'}`}
      style={style}
      aria-hidden={state !== 'current'}
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}: ${slide.title}`}
    >
      <SlideCtx.Provider value={ctx}>{slide.render(ctx)}</SlideCtx.Provider>
      <span className="pz-slide-num" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
        <span className="pz-slide-num-of"> / {String(count).padStart(2, '0')}</span>
      </span>
    </section>
  );
});

/** Elapsed time since the deck opened. Isolated so its once-a-second update re-renders only itself. */
function Clock() {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.floor((now - t0) / 1000);
  return <span className="pz-num">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

const KEYS: [string, string][] = [
  ['→  ↓  Space  PageDown  Enter', 'Next build or slide'],
  ['←  ↑  Shift+Space  PageUp', 'Previous'],
  ['Home  /  End', 'First / last slide'],
  ['Number, then Enter', 'Go to that slide'],
  ['O  or  G', 'Overview of all slides'],
  ['S', 'Speaker notes and clock'],
  ['F', 'Full screen'],
  ['B  or  .', 'Blank the screen'],
  ['L', 'Hand control to the live planner, or take it back'],
  ['?', 'This help'],
  ['Esc', 'Close a panel, then leave the presentation'],
];

export default function Presenter() {
  const deckId = usePresentation((s) => s.deckId);
  const start = usePresentation((s) => s.start);
  const close = usePresentation((s) => s.close);
  const setLive = usePresentation((s) => s.setLive);
  const deck: Deck = deckById(deckId) ?? DECKS[0];
  // Language: the chosen one if the deck has it, else the deck's first. Slides can be language-only.
  const chosenLang = usePresentation((s) => s.lang);
  const setLang = usePresentation((s) => s.setLang);
  const langs: Lang[] = deck.langs ?? ['en'];
  const lang: Lang = chosenLang && langs.includes(chosenLang) ? chosenLang : langs[0];
  const slides = useMemo(() => deck.slides.filter((s) => !s.langs || s.langs.includes(lang)), [deck, lang]);
  const W = deck.width ?? 1920;
  const H = deck.height ?? 1080;

  const [posState, setPosRaw] = useState<Position>(() => clampPosition(slides, start));
  // Clamped during render: a language switch can shrink the slide list before any effect runs.
  const pos = useMemo(() => {
    const c = clampPosition(slides, posState);
    return samePosition(c, posState) ? posState : c;
  }, [slides, posState]);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [overview, setOverview] = useState(false);
  const [notes, setNotes] = useState(false);
  const [blank, setBlank] = useState(false);
  const [help, setHelp] = useState(false);
  // On a live slide the planner owns the pointer until the presenter takes it back (L or the button).
  const [handOff, setHandOff] = useState(true);
  const [idle, setIdle] = useState(false);
  const typed = useRef('');
  const rootRef = useRef<HTMLDivElement>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });
  const channel = useRef<BroadcastChannel | null>(null);

  const current = slides[pos.slide];
  const live = current.kind === 'live';

  const setPos = useCallback(
    (p: Position, from: 'local' | 'remote' = 'local') => {
      const c = clampPosition(slides, p);
      if (samePosition(c, posRef.current)) return;
      setPosRaw(c);
      if (from === 'local') channel.current?.postMessage({ type: 'pos', deck: deck.id, ...c });
    },
    [slides, deck.id],
  );
  // Switching language can drop slides (the deck shows fewer in one language): stay in range.
  useEffect(() => {
    setPosRaw((p) => {
      const c = clampPosition(slides, p);
      return samePosition(c, p) ? p : c;
    });
  }, [slides]);

  // ---------- stage fit: one transform, recomputed only on resize ----------
  useLayoutEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFit(fitStage(e.contentRect.width, e.contentRect.height, W, H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // ---------- focus, so keys work at once and screen readers land in the deck ----------
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // ---------- live slides let the planner show through ----------
  useEffect(() => {
    setLive(live);
    // Next/Prev keep driving the deck on a live slide, as on any other; L hands the keys to the planner.
    if (live) setHandOff(false);
  }, [live, setLive]);
  useEffect(() => () => setLive(false), [setLive]);

  // ---------- deck preload: once per open ----------
  useEffect(() => {
    if (!deck.onOpen) return;
    void Promise.resolve()
      .then(() => deck.onOpen!(bridge))
      .catch((err) => console.error(`Deck "${deck.id}" onOpen failed`, err));
  }, [deck]);

  // ---------- autoplay: a slide with autoAdvanceMs steps on by itself if nobody navigates ----------
  useEffect(() => {
    const ms = current.autoAdvanceMs;
    if (!ms || pos.step >= (current.steps ?? 0) || overview || blank) return;
    const t = window.setTimeout(() => setPos({ slide: pos.slide, step: pos.step + 1 }), ms);
    return () => window.clearTimeout(t);
  }, [current, pos, overview, blank, setPos]);

  // ---------- slide lifecycle hooks: run on slide change, never on build steps ----------
  const entered = useRef<{ slide: number; step: number } | null>(null);
  useEffect(() => {
    const i = pos.slide;
    const s = slides[i];
    const ctx = { lang, step: pos.step, index: i, count: slides.length, active: true, thumbnail: false };
    const safe = (what: string, f: () => unknown) => {
      try {
        void Promise.resolve(f()).catch((err) => console.error(`Slide "${s.id}" ${what} failed`, err));
      } catch (err) {
        console.error(`Slide "${s.id}" ${what} failed`, err);
      }
    };
    const was = entered.current;
    entered.current = { slide: i, step: pos.step };
    if (was && was.slide === i) {
      if (was.step !== pos.step && s.onStep) safe('onStep', () => s.onStep!(bridge, pos.step, ctx));
      return;
    }
    if (was) {
      const old = slides[was.slide];
      if (old?.onLeave) safe('onLeave', () => old.onLeave!(bridge));
    }
    if (s.onEnter) safe('onEnter', () => s.onEnter!(bridge, ctx));
  }, [pos.slide, pos.step, slides]);
  // On close only (not when a language switch changes the slide list).
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  useEffect(
    () => () => {
      if (entered.current !== null) slidesRef.current[entered.current.slide]?.onLeave?.(bridge);
    },
    [],
  );

  // ---------- URL + title: replaceState, so the back button is not filled with slides ----------
  useEffect(() => {
    const h = formatHash(deck.id === DECKS[0].id ? null : deck.id, pos);
    if (location.hash !== h) history.replaceState(history.state, '', `${location.pathname}${location.search}${h}`);
    document.title = `${current.title} · ${deck.title}`;
  }, [pos, deck, current.title]);
  // Captured before any effect renames the tab.
  const [titleBefore] = useState(() => document.title);
  // Through a ref: setPos changes with the slide list (switching language), and re-running this
  // effect would run its cleanup, which is meant only for closing the deck (it clears the hash).
  const setPosRef = useRef(setPos);
  setPosRef.current = setPos;
  useEffect(() => {
    const before = titleBefore;
    const onHash = () => {
      const p = parseHash(location.hash);
      if (!p) close();
      else setPosRef.current(p.position);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.title = before;
      if (parseHash(location.hash)) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    };
  }, [close, titleBefore]);

  // ---------- cross-window sync: open the deck in two windows (laptop + projector) and they follow each other ----------
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; deck?: string; slide?: number; step?: number };
      if (m?.type === 'pos' && m.deck === deck.id && typeof m.slide === 'number' && typeof m.step === 'number') setPos({ slide: m.slide, step: m.step }, 'remote');
      if (m?.type === 'hello' && m.deck === deck.id) ch.postMessage({ type: 'pos', deck: deck.id, ...posRef.current });
    };
    ch.postMessage({ type: 'hello', deck: deck.id });
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [deck.id, setPos]);

  // ---------- commands ----------
  const fullscreen = useCallback(() => {
    // The whole document goes full screen, so live slides still show the planner.
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const run = useCallback(
    (c: Command) => {
      const p = posRef.current;
      switch (c) {
        case 'next':
          setBlank(false);
          return setPos(next(slides, p));
        case 'prev':
          setBlank(false);
          return setPos(prev(slides, p));
        case 'first':
          return setPos(goto(slides, 0));
        case 'last':
          return setPos(last(slides));
        case 'overview':
          return setOverview((o) => !o);
        case 'notes':
          return setNotes((n) => !n);
        case 'blank':
          return setBlank((b) => !b);
        case 'help':
          return setHelp((h) => !h);
        case 'fullscreen':
          return fullscreen();
        case 'live':
          return setHandOff((h) => !h);
        case 'exit':
          if (help) return setHelp(false);
          if (overview) return setOverview(false);
          if (blank) return setBlank(false);
          return close();
      }
    },
    [slides, setPos, fullscreen, help, overview, blank, close],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      const planner = live && handOff;
      // While the live planner has control, only clicker keys, Esc and L belong to the deck;
      // letters and arrows go to the planner (tool shortcuts, map panning).
      if (planner && !['PageDown', 'PageUp', 'Escape', 'l', 'L'].includes(e.key)) return;
      // Typed slide number, then Enter.
      if (/^[0-9]$/.test(e.key)) {
        typed.current = (typed.current + e.key).slice(-3);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Enter' && typed.current) {
        const n = Number(typed.current);
        typed.current = '';
        e.preventDefault();
        e.stopPropagation();
        setOverview(false);
        return setPos(goto(slides, n - 1));
      }
      typed.current = '';
      // Enter and Space on a focused control press the control, not "next".
      if ((e.key === 'Enter' || e.key === ' ') && isInteractive(t)) return;
      if (overview && /^Arrow/.test(e.key)) return; // the overview grid handles its own arrows
      const c = commandForKey(e.key, e.shiftKey);
      if (!c) return;
      if (planner && c === 'exit') {
        // Esc on a live slide first takes control back from the planner.
        e.preventDefault();
        e.stopPropagation();
        return setHandOff(false);
      }
      e.preventDefault();
      e.stopPropagation();
      run(c);
    };
    // Capture phase, so the planner's own shortcuts never see a key the deck used.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [run, live, handOff, overview, slides, setPos]);

  // ---------- controls auto-hide after the pointer rests ----------
  const idleTimer = useRef(0);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [wake]);

  // ---------- pointer: click right to advance, left quarter to go back, swipe on touch ----------
  const down = useRef<{ x: number; y: number; type: string } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, type: e.pointerType };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || isInteractive(e.target) || live) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const swipe = commandForSwipe(dx, dy);
    if (swipe) return run(swipe);
    if (Math.hypot(dx, dy) > 8 || (d.type === 'mouse' && e.button !== 0)) return;
    const r = rootRef.current!.getBoundingClientRect();
    run(e.clientX - r.left < r.width * 0.25 ? 'prev' : 'next');
  };

  // ---------- render ----------
  // Direction needs no state: a slide left behind sits "before" (off to the left), one ahead "after".
  const mounted = mountWindow(slides.length, pos.slide, 1);
  const pct = progress(slides, pos);
  const nextSlide = slides[pos.slide + 1];

  return (
    <div
      ref={rootRef}
      className={`pz-root${live ? ' is-live' : ''}${live && handOff ? ' hand-off' : ''}${idle ? ' is-idle' : ''}${blank ? ' is-blank' : ''}`}
      tabIndex={-1}
      role="region"
      aria-roledescription="slide deck"
      aria-label={deck.title}
      onPointerMove={wake}
      onPointerDown={(e) => {
        wake();
        onPointerDown(e);
      }}
      onPointerUp={onPointerUp}
      style={{ '--pz-bg': deck.background ?? '#0d0a08' } as CSSProperties}
    >
      <div className="pz-backdrop" aria-hidden="true" />
      <div ref={stageWrapRef} className="pz-stage-wrap">
        <div className="pz-stage" style={{ width: W, height: H, transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
          {mounted.map((i) => (
            <SlideView key={slides[i].id} lang={lang} slide={slides[i]} index={i} count={slides.length} step={i === pos.slide ? pos.step : i < pos.slide ? (slides[i].steps ?? 0) : 0} state={i === pos.slide ? 'current' : i < pos.slide ? 'before' : 'after'} />
          ))}
        </div>
      </div>

      <div className="pz-blank" aria-hidden={!blank} />

      <div className="pz-progress" aria-hidden="true">
        <i style={{ transform: `scaleX(${pct})` }} />
      </div>

      {langs.length > 1 && (
        // Faint language toggle at the top; shows the language it switches to.
        <div className="pz-lang" role="group" aria-label="Presentation language">
          {langs
            .filter((l) => l !== lang)
            .map((l) => (
              <button key={l} type="button" lang={l} onClick={() => setLang(l)} title={l === 'en' ? 'Show the presentation in English' : 'პრეზენტაცია ქართულად'}>
                {LANG_NAME[l]}
              </button>
            ))}
        </div>
      )}
      {deck.notice?.[lang] && <p className="pz-notice">{deck.notice[lang]}</p>}

      <nav className="pz-controls" aria-label="Presentation controls">
        <button type="button" className="pz-btn" onClick={() => run('prev')} disabled={isFirst(pos)} aria-label="Previous" title="Previous (←)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>
        <span className="pz-count pz-num" aria-live="polite">
          {pos.slide + 1} / {slides.length}
          {(current.steps ?? 0) > 0 && <span className="pz-steps"> · {pos.step}/{current.steps}</span>}
        </span>
        <button type="button" className="pz-btn" onClick={() => run('next')} disabled={isLast(slides, pos)} aria-label="Next" title="Next (→ or Space)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M6 3l5 5-5 5" />
          </svg>
        </button>
        <span className="pz-sep" aria-hidden="true" />
        {live && (
          <button type="button" className="pz-btn wide" aria-pressed={handOff} onClick={() => setHandOff((h) => !h)} title="Let the audience see you use the planner; arrows and letters then go to the map (L)">
            {handOff ? 'Planner has control' : 'Use the planner'}
          </button>
        )}
        <button type="button" className="pz-btn wide" aria-pressed={overview} onClick={() => run('overview')} title="All slides (O)">
          Overview
        </button>
        <button type="button" className="pz-btn wide" aria-pressed={notes} onClick={() => run('notes')} title="Speaker notes and clock (S)">
          Notes
        </button>
        <button type="button" className="pz-btn" onClick={fullscreen} aria-label="Full screen" title="Full screen (F)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          </svg>
        </button>
        <button type="button" className="pz-btn" onClick={() => run('help')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          ?
        </button>
        <button type="button" className="pz-btn wide" onClick={close} title="Back to the planner (Esc)">
          Exit
        </button>
      </nav>

      {notes && (
        <aside className="pz-notes" aria-label="Speaker notes">
          <div className="pz-notes-head">
            <span className="pz-kicker">
              Slide {pos.slide + 1} · {current.title}
            </span>
            <Clock />
          </div>
          <p className="pz-notes-text">{current.notes ?? 'No notes for this slide.'}</p>
          <p className="pz-notes-next">{nextSlide ? `Next: ${nextSlide.title}` : 'Last slide'}</p>
        </aside>
      )}

      {overview && (
        <Overview
          deck={deck}
          slides={slides}
          lang={lang}
          current={pos.slide}
          W={W}
          H={H}
          onPick={(i) => {
            setOverview(false);
            setPos(goto(slides, i));
            rootRef.current?.focus({ preventScroll: true });
          }}
        />
      )}

      {help && (
        <div className="pz-help" role="dialog" aria-label="Keyboard shortcuts" aria-modal="false">
          <h2 className="pz-kicker">Keyboard</h2>
          <dl>
            {KEYS.map(([k, v]) => (
              <div key={k}>
                <dt className="pz-num">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="pz-help-foot">Open this deck in a second window and both follow each other: one for the projector, one with notes for you. Clickers that send PageUp/PageDown work.</p>
          <button type="button" className="pz-btn wide" onClick={() => setHelp(false)}>
            Close
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {`Slide ${pos.slide + 1} of ${slides.length}: ${current.title}`}
      </p>
    </div>
  );
}

/** All slides as thumbnails. Each renders its slide at full logical size, scaled down; off-screen rows are skipped by content-visibility. */
function Overview({ deck, slides, lang, current, W, H, onPick }: { deck: Deck; slides: SlideDef[]; lang: Lang; current: number; W: number; H: number; onPick: (i: number) => void }) {
  const THUMB_W = 320;
  const scale = THUMB_W / W;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    refs.current[current]?.focus({ preventScroll: false });
  }, [current]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const cols = Math.max(1, Math.floor((e.currentTarget.parentElement?.clientWidth ?? 1) / (THUMB_W + 24)));
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : e.key === 'ArrowUp' ? i - cols : null;
    if (to === null) return;
    e.preventDefault();
    refs.current[Math.max(0, Math.min(slides.length - 1, to))]?.focus();
  };
  return (
    <div className="pz-overview" role="dialog" aria-label="All slides">
      <div className="pz-overview-grid" role="list">
        {slides.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="listitem"
            className={`pz-thumb${i === current ? ' is-current' : ''}`}
            onClick={() => onPick(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            aria-label={`Slide ${i + 1}: ${s.title}${s.kind === 'live' ? ' (live planner)' : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="pz-thumb-frame" style={{ width: THUMB_W, height: H * scale }}>
              <span className="pz-thumb-stage" style={{ width: W, height: H, transform: `scale(${scale})`, background: s.background ?? deck.background ?? '#0d0a08' }}>
                <SlideView slide={s} index={i} count={slides.length} step={s.steps ?? 0} state="current" thumbnail lang={lang} />
              </span>
              {s.kind === 'live' && <span className="pz-thumb-live">Live planner</span>}
            </span>
            <span className="pz-thumb-label">
              <span className="pz-num">{i + 1}</span> {s.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
