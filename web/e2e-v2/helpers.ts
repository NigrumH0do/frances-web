// Helpers de las specs e2e v2 (Task UI-22).
//
// Todo se ejecuta contra el build demo: el login usa las credenciales de la
// instantánea (UI-20), el recognizer falso es el mismo contrato de CHG-13 y
// `setChatDelay` programa el retardo del SSE simulado de UI-21.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'demo-demo-demo';

export const DEMO_TOPIC_ID = 'tp_0000000000000001';
export const DEMO_TOPIC_TITLE = 'Salutations';
export const DEMO_ITEM_ID = 'mt_demo1';
export const DEMO_QUIZ_ID = 'qz_5a9f7bc0353cd93b';
export const DEMO_CHAT_QUESTION = '¿Qué dice «Annonce : examen oral»?';
export const DEMO_NO_MATERIAL_QUESTION = '¿Cuál es la capital de Francia?';

// Fixture sintético de SPK-04 (R-22), leído del repo y nunca de la red.
export const BONJOUR_JSON: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../tests/fixtures/azure/bonjour.json', import.meta.url),
    ),
    'utf8',
  ),
) as unknown;

/**
 * Entra al demo y aterriza en `path`. Si la sesión ya existe, solo navega.
 * Cuando `RequireSession` manda a `/entrar?next=…`, el botón del demo devuelve
 * al destino pedido.
 */
export async function loginDemo(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  // La sesión se resuelve después del primer render (AuthProvider consulta
  // `/api/auth/me`); hay que esperar a que aparezca el h1, sea el de la
  // pantalla o el de `/entrar`, antes de buscar el botón del demo.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  const demoButton = page.getByRole('button', { name: 'Entrar al demo' });
  if ((await demoButton.count()) > 0) {
    await demoButton.click();
  }
  await expect(page).not.toHaveURL(/\/entrar(?:[?#]|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/**
 * Instala, vía `addInitScript`, el recognizer falso que `getTokenRecognizer`
 * acepta cuando el build se hizo con `VITE_E2E=1` (contrato de CHG-13) y
 * devuelve el JSON sintético de SPK-04. `createRecorder` siempre pide un
 * stream de micrófono aunque el recognizer sea falso, así que también se
 * reemplaza `getUserMedia`.
 */
export async function installFakeRecognizer(page: Page): Promise<void> {
  await page.addInitScript(
    ({ json, durationMs }) => {
      const getUserMedia = async (): Promise<MediaStream> =>
        ({ getTracks: () => [] }) as unknown as MediaStream;
      // WebKit no siempre deja reemplazar el método en la instancia; se
      // parchea el prototipo y, si hace falta, el getter de `navigator`.
      const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
      const proto = (
        window as unknown as {
          MediaDevices?: { prototype: object };
        }
      ).MediaDevices?.prototype;
      const patch = (target: object): void => {
        try {
          Object.defineProperty(target, 'getUserMedia', {
            configurable: true,
            value: getUserMedia,
          });
        } catch {
          // El navegador no permite reemplazarlo en este objeto.
        }
      };
      if (proto !== undefined) {
        patch(proto);
      }
      if (mediaDevices !== undefined) {
        patch(mediaDevices);
      } else {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia },
        });
      }
      Object.assign(window, {
        __francesFakeRecognizer: {
          assess: async () => ({ json, durationMs }),
        },
      });
    },
    { json: BONJOUR_JSON, durationMs: 1500 },
  );
}

/** Retardo del SSE simulado del demo (UI-21) antes de cada evento. */
export async function setChatDelay(page: Page, ms: number): Promise<void> {
  await page.addInitScript(
    ({ delay }) => {
      const current = (
        window as unknown as { __francesDemo?: Record<string, unknown> }
      ).__francesDemo;
      Object.assign(window, {
        __francesDemo: { ...(current ?? {}), chatDelayMs: delay },
      });
    },
    { delay: ms },
  );
}

/** Rutas que cubre la spec de accesibilidad, con los ids de la instantánea. */
export function screenPaths(threadId: string): string[] {
  return [
    '/entrar',
    '/',
    '/temas',
    `/temas/${DEMO_TOPIC_ID}`,
    `/publicaciones/${DEMO_ITEM_ID}`,
    '/repasar',
    '/repasar/pronunciacion',
    '/repasar/texto',
    `/quiz/${DEMO_QUIZ_ID}`,
    `/chat/${threadId}`,
    '/mas',
  ];
}

interface TargetSize {
  tag: string;
  className: string;
  text: string;
  width: number;
  height: number;
  selector: string;
}

/**
 * Comprueba que todo control visible mide al menos 44 × 44 px. La medida es
 * la del objetivo táctil efectivo: si un control nativo vive dentro de un
 * `<label>` (la casilla de «Hecho» o los radios), el navegador activa el
 * control al tocar el label; y si la clase añade una zona táctil con
 * `::before`/`::after` (los chips de filtro), se cuenta esa zona. Se excluyen
 * los enlaces dentro de un párrafo de texto, como fija el plan.
 */
export async function expectTapTargets(page: Page): Promise<void> {
  const problems = await page.evaluate((): TargetSize[] => {
    const SELECTOR =
      'button, a, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], input, select, textarea';
    const found: TargetSize[] = [];

    function px(value: string): number {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function isVisible(el: Element): boolean {
      if (el.closest('[inert]') !== null) return false;
      if (el.closest('[aria-hidden="true"]') !== null) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      if (px(style.opacity) === 0) return false;
      return true;
    }

    function rectOf(el: Element): DOMRect {
      return el.getBoundingClientRect();
    }

    function pseudoBox(
      el: Element,
      pseudo: '::before' | '::after',
    ): { width: number; height: number } | null {
      const style = getComputedStyle(el, pseudo);
      if (style.content === 'none' || style.content === 'normal') return null;
      if (style.position !== 'absolute' && style.position !== 'fixed') {
        return null;
      }
      const box = rectOf(el);
      const left = px(style.left);
      const right = px(style.right);
      const top = px(style.top);
      const bottom = px(style.bottom);
      return {
        width: box.width - left - right,
        height: box.height - top - bottom,
      };
    }

    for (const el of document.querySelectorAll(SELECTOR)) {
      if (!isVisible(el)) continue;
      if (el.tagName === 'A' && el.closest('p') !== null) continue;

      const rect = rectOf(el);
      if (rect.width === 0 && rect.height === 0) continue;

      let width = rect.width;
      let height = rect.height;

      const label = el.closest('label');
      if (
        label !== null &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'SELECT' ||
          el.tagName === 'TEXTAREA')
      ) {
        const labelRect = rectOf(label);
        width = Math.max(width, labelRect.width);
        height = Math.max(height, labelRect.height);
      }

      for (const pseudo of ['::before', '::after'] as const) {
        const box = pseudoBox(el, pseudo);
        if (box === null) continue;
        width = Math.max(width, box.width);
        height = Math.max(height, box.height);
      }

      if (width < 44 || height < 44) {
        const id = el.id === '' ? '' : `#${el.id}`;
        const className =
          typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).filter(Boolean)
            : [];
        const classSelector =
          className.length > 0 ? `.${className.join('.')}` : '';
        found.push({
          tag: el.tagName,
          className: className.join(' '),
          text: (el.textContent ?? '').trim().slice(0, 40),
          width: Math.round(width),
          height: Math.round(height),
          selector: `${el.tagName.toLowerCase()}${id}${classSelector}`,
        });
      }
    }

    return found;
  });

  expect(
    problems,
    `Objetivos táctiles menores de 44 × 44 px:\n${JSON.stringify(problems, null, 2)}`,
  ).toEqual([]);
}

/** axe con las etiquetas WCAG 2.0 A/AA y 2.1 AA; falla solo en serious/critical. */
export async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
  );
  const summary = serious.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.flatMap((node) => node.target),
  }));
  expect(
    summary,
    `Violaciones axe graves:\n${JSON.stringify(summary, null, 2)}`,
  ).toEqual([]);
}
