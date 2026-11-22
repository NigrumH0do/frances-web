import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SceneBoundary } from './LazyScenes';

function BrokenScene(): never {
  throw new Error('fallo de WebGL en runtime');
}

test('SceneBoundary contiene el fallo de una escena y muestra el fallback', () => {
  // React informa de los errores capturados por su cuenta; el test comprueba
  // que la UI no se desmonta y que la red de seguridad del boundary actúa.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  render(
    <SceneBoundary fallback={<p>fallback editorial</p>}>
      <BrokenScene />
    </SceneBoundary>,
  );

  expect(screen.getByText('fallback editorial')).toBeVisible();
  expect(consoleError).toHaveBeenCalled();
  consoleError.mockRestore();
});
