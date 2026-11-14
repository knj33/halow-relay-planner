import { useEffect, useId, useState } from 'react';

export interface NumberFieldProps {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  /** Scale between stored and displayed value, e.g. 0.001 to show metres as kilometres. */
  scale?: number;
  compact?: boolean;
  /** An empty field is allowed (no error shown) when nothing has been chosen yet. */
  allowEmpty?: boolean;
  onChange: (v: number) => void;
}

const show = (v: number, digits = 4) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '');

/** Numeric input that reports NaN for unparseable text, so callers can block calculations instead of guessing. */
export function NumberField({ label, unit, value, min, max, step, disabled, hint, scale = 1, compact, allowEmpty, onChange }: NumberFieldProps) {
  const id = useId();
  const digits = compact ? 2 : 4;
  const shown = value * scale;
  const [text, setText] = useState(show(shown, digits));
  useEffect(() => {
    if (Number.isFinite(shown) && Math.abs(Number(text) - shown) > 0.5 * 10 ** -digits) setText(show(shown, digits));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const lo = min * scale;
  const hi = max * scale;
  const error = disabled || (allowEmpty && !Number.isFinite(shown) && text.trim() === '') ? null : !Number.isFinite(shown) ? 'Enter a number' : shown < lo || shown > hi ? `Must be ${lo} to ${hi}${unit ? ' ' + unit : ''}` : null;

  return (
    <div className={`field${compact ? ' compact' : ''}${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={lo}
          max={hi}
          step={step ?? 'any'}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim() === '' ? NaN : Number(e.target.value);
            onChange(v / scale);
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {(error || hint) && (
        <p id={`${id}-msg`} className={error ? 'field-error' : 'field-hint'} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
