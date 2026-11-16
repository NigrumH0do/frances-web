// Interruptor on/off. Usa role="switch" y aria-checked; el estilo lo fija components.css.
export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  );
}
