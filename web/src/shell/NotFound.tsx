import { Link } from 'react-router';
import { shellStrings } from './strings';

// 404 del shell. También es la respuesta para `/mas/admin/*` cuando el módulo
// de admin no existe o el usuario no es admin.
export function NotFound() {
  return (
    <div className="stack">
      <p className="xs muted">{shellStrings.notFound.code}</p>
      <h1>{shellStrings.notFound.title}</h1>
      <p className="muted">{shellStrings.notFound.body}</p>
      <p>
        <Link className="btn btn-tonal" to="/">
          {shellStrings.notFound.home}
        </Link>
      </p>
    </div>
  );
}
