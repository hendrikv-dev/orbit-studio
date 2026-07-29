import { useRef } from "react";

interface NumberFieldProps {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  invalidMessage?: string | null;
  onChange: (value: number) => void;
  onInteractionChange?: (active: boolean) => void;
}

export function NumberField({
  label,
  value,
  unit,
  step,
  min,
  max,
  invalidMessage,
  onChange,
  onInteractionChange,
}: NumberFieldProps) {
  const focusedRef = useRef(false);

  return (
    <label
      className={`field ${invalidMessage ? "field-invalid" : ""}`}
      onPointerEnter={() => onInteractionChange?.(true)}
      onPointerLeave={() => {
        if (!focusedRef.current) onInteractionChange?.(false);
      }}
    >
      <span className="field-label">
        {label}
        {unit && <span>{unit}</span>}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        onFocus={() => {
          focusedRef.current = true;
          onInteractionChange?.(true);
        }}
        onBlur={() => {
          focusedRef.current = false;
          onInteractionChange?.(false);
        }}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
      {invalidMessage && <span className="field-error">{invalidMessage}</span>}
    </label>
  );
}
