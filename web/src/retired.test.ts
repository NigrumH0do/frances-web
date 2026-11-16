// Task CHG-16: la web v1 se retiró. Este test impide que vuelva a entrar
// código de FRB1, de la passphrase o del contexto de contenido v1.
//
// Se excluyen `src/contracts/` (tipos generados: `Format = 'FRB1'` sigue en el
// contrato de Python hasta que CHG-21 retire el bundle) y este mismo archivo
// (contiene el patrón que busca).
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = process.cwd();
const SKIP = new Set(['src/retired.test.ts']);
const files = globSync('src/**/*.{ts,tsx}', { cwd: WEB }).filter(
  (file) => !SKIP.has(file) && !file.startsWith('src/contracts/'),
);

test('no queda código v1 de FRB1 ni passphrase', () => {
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(readFileSync(join(WEB, file), 'utf8'), file).not.toMatch(
      /useContent|FRB1|passphrase|RequireUnlocked/,
    );
  }
});
