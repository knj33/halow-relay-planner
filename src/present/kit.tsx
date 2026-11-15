import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { SlideContext } from './types';

/**
 * Authoring kit: small layout primitives for slides, styled in the planner's Mars survey language
 * (`.pz-*` rules in styles.css). Slides can use plain JSX too; these just keep decks consistent.
 */

export const SlideCtx = createContext<SlideContext>({ lang: 'en', step: 0, index: 0, count: 1, active: true, thumbnail: false });
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
export function Cover({ title, subtitle, meta, phrase = false }: { title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; phrase?: boolean }) {
  return (
    <div className="pz-cover">
      {/* `phrase`: a few words rather than a wordmark, so normal letter spacing on one line. */}
      <h1 className={`pz-cover-title${phrase ? ' is-phrase' : ''}`}>{title}</h1>
      <span className="pz-rule" aria-hidden="true" />
      {subtitle && <p className="pz-cover-sub">{subtitle}</p>}
      {meta && <p className="pz-cover-meta">{meta}</p>}
    </div>
  );
}

/** Bullet list where item i (0-based) appears at build step `from + i`. Pass `from={0}` for no builds; `numbered` shows 1. 2. 3. instead of dashes. */
export function Points({ items, from = 1, numbered = false }: { items: ReactNode[]; from?: number; numbered?: boolean }) {
  return (
    <ul className={`pz-points${numbered ? ' numbered' : ''}`}>
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

export interface CompareSide {
  /** The headline number or word for this side. */
  figure: ReactNode;
  text: ReactNode;
}
export interface CompareRow {
  label: ReactNode;
  left: CompareSide;
  right: CompareSide;
}

/**
 * Side-by-side comparison table. Row i appears at build step i + 1 (pass `from={0}` for no builds).
 * The right-hand column is the highlighted one (green tint), the left is neutral.
 */
export function Compare({ leftTitle, rightTitle, rows, sources, from = 1, dense = false }: { leftTitle: ReactNode; rightTitle: ReactNode; rows: CompareRow[]; sources?: ReactNode[]; from?: number; dense?: boolean }) {
  // `dense`: smaller type and tighter cells, for languages that run longer than English.
  return (
    <div className={`pz-compare${dense ? ' dense' : ''}`}>
      <div className="pz-compare-grid" role="table">
        <div className="pz-compare-head" role="row">
          <span role="columnheader" />
          <span role="columnheader" className="pz-compare-col">
            {leftTitle}
          </span>
          <span role="columnheader" className="pz-compare-col is-pick">
            {rightTitle}
          </span>
        </div>
        {rows.map((r, i) => {
          const body = (
            <>
              <span role="rowheader" className="pz-compare-label">
                {r.label}
              </span>
              <div role="cell" className="pz-compare-cell">
                <p className="pz-compare-fig">{r.left.figure}</p>
                <p className="pz-compare-text">{r.left.text}</p>
              </div>
              <div role="cell" className="pz-compare-cell is-pick">
                <p className="pz-compare-fig">{r.right.figure}</p>
                <p className="pz-compare-text">{r.right.text}</p>
              </div>
            </>
          );
          return from > 0 ? (
            <Step key={i} at={from + i} className="pz-compare-row">
              {body}
            </Step>
          ) : (
            <div key={i} className="pz-compare-row" role="row">
              {body}
            </div>
          );
        })}
      </div>
      {sources && sources.length > 0 && (
        <ol className="pz-sources">
          {sources.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
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
