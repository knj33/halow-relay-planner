import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { SlideContext } from './types';

/**
 * Authoring kit: small layout primitives for slides, styled in the planner's Mars survey language
 * (`.pz-*` rules in styles.css). Slides can use plain JSX too; these just keep decks consistent.
 */

export const SlideCtx = createContext<SlideContext>({ step: 0, index: 0, count: 1, active: true, thumbnail: false });
export const useSlide = () => useContext(SlideCtx);

/**
 * A fragment: hidden until the slide reaches build step `at` (1-based), then fades/rises in.
 * It keeps its layout space while hidden, so revealing never shifts anything else.
 * `until` hides it again from that step on (for "replace this with that" builds).
 */
export function Step({ at, until, children, as = 'div', className = '', style }: { at: number; until?: number; children: ReactNode; as?: 'div' | 'span' | 'li'; className?: string; style?: CSSProperties }) {
  const { step } = useSlide();
  const shown = step >= at && (until === undefined || step < until);
  const Tag = as;
  return (
    <Tag className={`pz-step${shown ? ' is-shown' : ''}${className ? ` ${className}` : ''}`} style={style} aria-hidden={!shown}>
      {children}
    </Tag>
  );
}

/** The standard slide frame: optional kicker line, title, body. */
export function Frame({ kicker, title, children, align = 'start' }: { kicker?: string; title?: ReactNode; children?: ReactNode; align?: 'start' | 'center' }) {
  return (
    <div className={`pz-frame align-${align}`}>
      {kicker && <p className="pz-kicker">{kicker}</p>}
      {title && <h2 className="pz-title">{title}</h2>}
      {children && <div className="pz-body">{children}</div>}
    </div>
  );
}

/** Opening/closing slide: large wordmark-style title. */
export function Cover({ title, subtitle, meta }: { title: ReactNode; subtitle?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="pz-cover">
      <h1 className="pz-cover-title">{title}</h1>
      <span className="pz-rule" aria-hidden="true" />
      {subtitle && <p className="pz-cover-sub">{subtitle}</p>}
      {meta && <p className="pz-cover-meta">{meta}</p>}
    </div>
  );
}

/** Bullet list where item i (0-based) appears at build step `from + i`. Pass `from={0}` for no builds. */
export function Points({ items, from = 1 }: { items: ReactNode[]; from?: number }) {
  return (
    <ul className="pz-points">
      {items.map((it, i) =>
        from > 0 ? (
          <Step key={i} as="li" at={from + i}>
            {it}
          </Step>
        ) : (
          <li key={i}>{it}</li>
        ),
      )}
    </ul>
  );
}

export function Columns({ children, ratio = '1fr 1fr' }: { children: ReactNode; ratio?: string }) {
  return (
    <div className="pz-columns" style={{ gridTemplateColumns: ratio }}>
      {children}
    </div>
  );
}

/** A big figure with a small label, for one number that matters. */
export function Figure({ value, unit, label }: { value: ReactNode; unit?: string; label: ReactNode }) {
  return (
    <div className="pz-figure">
      <p className="pz-figure-value">
        {value}
        {unit && <span className="pz-figure-unit">{unit}</span>}
      </p>
      <p className="pz-figure-label">{label}</p>
    </div>
  );
}

/** Caption card content for a live slide: one line of title, one or two of explanation. */
export function Caption({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="pz-caption">
      <h2 className="pz-caption-title">{title}</h2>
      {children && <div className="pz-caption-body">{children}</div>}
    </div>
  );
}
