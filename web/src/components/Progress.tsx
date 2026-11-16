// Barra de avance accesible. El ancho es el único estilo en línea permitido.
export function Progress({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="progress"
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
