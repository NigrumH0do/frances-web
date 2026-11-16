import { shellStrings } from './strings';

// Se muestra cuando una pantalla todavía no existe (las tareas UI-12…UI-19
// llegan después). El `h1` conserva el título de la ruta para `RouteFocus`.
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="stack">
      <h1>{title}</h1>
      <p className="muted">{shellStrings.placeholder}</p>
    </div>
  );
}
