import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design/index.css';
import { applyTheme, initialTheme } from '../design/theme';
import { AppV2 } from './AppV2';

// Arranque de la web v2. Lo llama `main.tsx` tras CHG-14; hasta entonces la
// entrada sigue siendo la app v1.
export async function bootV2(el: HTMLElement): Promise<void> {
  applyTheme(initialTheme());
  createRoot(el).render(createElement(StrictMode, null, createElement(AppV2)));
}
