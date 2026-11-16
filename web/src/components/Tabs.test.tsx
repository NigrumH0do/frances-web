import '@testing-library/jest-dom/vitest';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'a', label: 'Resumen', panel: 'A' },
  { id: 'b', label: 'Clases', panel: 'B' },
  { id: 'c', label: 'Notas', panel: 'C' },
];

describe('Tabs', () => {
  test('Tabs sigue el patrón WAI-ARIA con flechas', async () => {
    render(<Tabs label="Tema" tabs={[tabs[0], tabs[1]]} />);
    screen.getByRole('tab', { name: 'Resumen' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Clases' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B');
  });

  test('las flechas dan la vuelta y Inicio/Fin saltan al extremo', async () => {
    render(<Tabs label="Tema" tabs={tabs} />);
    screen.getByRole('tab', { name: 'Resumen' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Notas' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('C');
  });
});
