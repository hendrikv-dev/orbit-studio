type NumberFieldProps = {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  onChange: (value: number) => void;
};

export function NumberField({ label, value, unit, min, max, step = 0.01, error, onChange }: NumberFieldProps) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {unit ? <span className="field-unit">{unit}</span> : null}
      </span>
      <input
        className={error ? 'invalid' : undefined}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
