import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import {
  AppBar,
  Button,
  Chip,
  Dialog,
  Field,
  FilterChip,
  IconButton,
  ListItem,
  Progress,
  Segmented,
  Switch,
} from './index';

describe('componentes base', () => {
  test('Button busy marca aria-busy sin deshabilitarse y muestra el spinner', () => {
    const { container } = render(
      <Button variant="primary" busy>
        Guardar
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Guardar' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeEnabled();
    expect(container.querySelector('.spinner')).not.toBeNull();
  });

  test('IconButton expone su nombre accesible y Switch expone role switch', async () => {
    const onChange = vi.fn();
    render(
      <>
        <IconButton label="Escuchar" icon="play" variant="secondary" />
        <Switch label="Repaso automático" checked={false} onChange={onChange} />
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'Escuchar' }),
    ).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Repaso automático' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('Chip aplica el tono y FilterChip alterna aria-pressed', async () => {
    const onPressedChange = vi.fn();
    render(
      <>
        <Chip tone="success">Nuevo</Chip>
        <FilterChip pressed={false} onPressedChange={onPressedChange}>
          A2
        </FilterChip>
      </>,
    );
    expect(screen.getByText('Nuevo')).toHaveClass('chip', 'chip-success');
    await userEvent.click(screen.getByRole('button', { name: 'A2' }));
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  test('ListItem sin acción no es un botón ni un enlace', () => {
    render(<ListItem title="Tarea hecha" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Tarea hecha')).toBeInTheDocument();
  });

  test('ListItem con to es un enlace y con onClick es un botón', async () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <ListItem to="/temas/7" title="Leçon 7" meta="PDF" />
        <ListItem title="Abrir" onClick={onClick} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Leçon 7/ })).toHaveAttribute(
      'href',
      '/temas/7',
    );
    await userEvent.click(screen.getByRole('button', { name: /Abrir/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test('Field asocia etiqueta, pista y error con el control', () => {
    render(
      <Field label="Francés" hint="Escribe sin tildes" error="Obligatorio">
        <input className="input" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Francés' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Escribe sin tildes Obligatorio');
  });

  test('Progress publica valores de progressbar', () => {
    render(<Progress value={3} max={10} label="Avance" />);
    const bar = screen.getByRole('progressbar', { name: 'Avance' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  test('Segmented es un radiogroup con una sola opción marcada', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Tema"
        options={[
          { value: 'sistema', label: 'Sistema' },
          { value: 'claro', label: 'Claro' },
        ]}
        value="sistema"
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole('radiogroup', { name: 'Tema' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(onChange).toHaveBeenCalledWith('claro');
  });

  test('Dialog abre con título accesible y Escape pide cerrar', async () => {
    const onClose = vi.fn();
    render(
      <Dialog
        open
        title="Borrar tema"
        onClose={onClose}
        actions={<button type="button">Cancelar</button>}
      >
        <p>Esta acción no se puede deshacer.</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Borrar tema' });
    expect(dialog).toBeInTheDocument();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('AppBar pone el título en h1 y el botón volver con nombre accesible', () => {
    render(
      <MemoryRouter>
        <AppBar title="Hoy" back={{ to: '/' }} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hoy' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

describe('UI-03 accesibilidad de componentes', () => {
  test('Segmented marca aria-checked solo en la opción elegida', () => {
    render(
      <Segmented
        label="Tema"
        options={[
          { value: 'sistema', label: 'Sistema' },
          { value: 'claro', label: 'Claro' },
          { value: 'oscuro', label: 'Oscuro' },
        ]}
        value="claro"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Claro' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Sistema' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Oscuro' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('Field combina el aria-describedby del hijo con hint y error', () => {
    render(
      <>
        <p id="ayuda-externa">Ayuda externa</p>
        <Field label="Francés" hint="Escribe sin tildes" error="Obligatorio">
          <input className="input" aria-describedby="ayuda-externa" />
        </Field>
      </>,
    );
    expect(
      screen.getByRole('textbox', { name: 'Francés' }),
    ).toHaveAccessibleDescription(
      'Ayuda externa Escribe sin tildes Obligatorio',
    );
  });

  test('Field conserva aria-invalid=true del hijo aunque no haya error', () => {
    render(
      <Field label="Nombre">
        <input className="input" aria-invalid={true} />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('Field publica el error con role alert', () => {
    render(
      <Field label="Francés" error="Obligatorio">
        <input className="input" />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Obligatorio');
  });

  test('AppBar deja el subtítulo fuera del nombre accesible del encabezado', () => {
    render(
      <MemoryRouter>
        <AppBar title="Hoy" subtitle="Lunes, 2 de noviembre" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hoy' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Lunes, 2 de noviembre')).toBeInTheDocument();
    expect(screen.getByText('Lunes, 2 de noviembre').closest('h1')).toBeNull();
  });
});
