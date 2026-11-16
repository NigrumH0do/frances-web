import { useEffect } from 'react';
import { useLocation } from 'react-router';

// En cada navegación: título del documento y foco en el encabezado de la
// pantalla. Si la pantalla aún no tiene `h1`, el foco va al `<main>`.
export function RouteFocus({ title }: { title: string }) {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = `${title} · Français`;

    const main = document.getElementById('main');
    const root = main ?? document.body;

    const focusHeading = () => {
      const heading = root.querySelector('h1');
      if (heading === null) return false;
      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1');
      }
      heading.focus({ preventScroll: true });
      return true;
    };

    if (focusHeading()) return;
    main?.focus({ preventScroll: true });
    if (main === null) return;

    // Las pantallas se cargan con `lazy`: el h1 puede aparecer después del
    // cambio de ruta. Se mueve el foco cuando llega, sin robarlo si el usuario
    // ya interactuó con la pantalla.
    const observer = new MutationObserver(() => {
      const active = document.activeElement;
      if (active !== main && active !== document.body && active !== null) {
        observer.disconnect();
        return;
      }
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, title]);

  return null;
}
