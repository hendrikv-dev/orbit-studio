type ToggleRowProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
