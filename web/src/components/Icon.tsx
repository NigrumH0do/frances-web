import { cx } from './cx';

export type IconName =
  | 'hoy'
  | 'temas'
  | 'repasar'
  | 'chat'
  | 'mas'
  | 'play'
  | 'pause'
  | 'mic'
  | 'check'
  | 'x'
  | 'chevron'
  | 'back'
  | 'search'
  | 'flip'
  | 'flag'
  | 'pause-circle'
  | 'send'
  | 'stop'
  | 'copy'
  | 'offline'
  | 'alert'
  | 'sun'
  | 'moon'
  | 'external';

interface IconShape {
  readonly d: readonly string[];
  readonly filled?: boolean;
}

// Trazos de las maquetas de docs/design/v2/components.html. Trazo y color los fija app.css.
const SHAPES: Record<IconName, IconShape> = {
  hoy: { d: ['M3 6h18v13H3z', 'M8 2v4', 'M16 2v4', 'M3 10h18'] },
  temas: {
    d: ['M12 3 2 8l10 5 10-5-10-5Z', 'm2 16 10 5 10-5', 'M2 12l10 5 10-5'],
  },
  repasar: {
    d: [
      'M3 12a9 9 0 0 1 15.5-6.3L21 8',
      'M21 3v5h-5',
      'M21 12a9 9 0 0 1-15.5 6.3L3 16',
      'M3 21v-5h5',
    ],
  },
  chat: { d: ['M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z'] },
  mas: { d: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'] },
  play: { d: ['M8 5v14l11-7Z'], filled: true },
  pause: { d: ['M8 5v14M16 5v14'] },
  mic: {
    d: [
      'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z',
      'M5 11a7 7 0 0 0 14 0',
      'M12 18v3',
    ],
  },
  check: { d: ['m5 12 5 5 9-10'] },
  x: { d: ['M6 6l12 12', 'M18 6 6 18'] },
  chevron: { d: ['m9 6 6 6-6 6'] },
  back: { d: ['m15 6-6 6 6 6'] },
  search: { d: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm20 20-4-4'] },
  flip: {
    d: [
      'M4 12a8 8 0 0 1 14-5.3L20 9',
      'M20 4v5h-5',
      'M20 12a8 8 0 0 1-14 5.3L4 15',
      'M4 20v-5h5',
    ],
  },
  flag: { d: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'] },
  'pause-circle': {
    d: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M9 9v6M15 9v6'],
  },
  send: { d: ['M3 11 21 3l-8 18-2-8-8-2Z'] },
  stop: { d: ['M6 6h12v12H6Z'], filled: true },
  copy: { d: ['M9 9h11v11H9z', 'M5 15V4h11'] },
  offline: {
    d: [
      'M2 8.5a15 15 0 0 1 5-2.8M22 8.5A15 15 0 0 0 11 5M5 12.5a10 10 0 0 1 4-2M19 12.5a10 10 0 0 0-2.5-1.7M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18',
    ],
  },
  alert: { d: ['M12 3 2 20h20L12 3Z', 'M12 10v4M12 17v.5'] },
  sun: {
    d: [
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
      'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    ],
  },
  moon: { d: ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z'] },
  external: { d: ['M14 4h6v6', 'M20 4 10 14', 'M18 14v6H4V6h6'] },
};

export function Icon({
  name,
  size = 'md',
}: {
  name: IconName;
  size?: 'sm' | 'md';
}) {
  const shape = SHAPES[name];
  return (
    <svg
      className={cx('icon', size === 'sm' && 'icon-sm')}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {shape.d.map((d) => (
        <path key={d} d={d} fill={shape.filled ? 'currentColor' : undefined} />
      ))}
    </svg>
  );
}
