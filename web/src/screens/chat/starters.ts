import { tr } from '../../l10n/es';
import { chatStrings } from './strings';

export interface StarterContext {
  topicTitle?: string;
  upcomingTitle?: string;
  cardNote?: boolean;
}

function titled(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Contexto opcional que llega en `location.state`. Si no viene, no se inventa.
 */
export function readStarterContext(state: unknown): StarterContext | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const record = state as Record<string, unknown>;
  const ctx: StarterContext = {};
  const topicTitle = titled(record.topicTitle);
  const upcomingTitle = titled(record.upcomingTitle);
  if (topicTitle !== undefined) ctx.topicTitle = topicTitle;
  if (upcomingTitle !== undefined) ctx.upcomingTitle = upcomingTitle;
  if (record.cardNote === true) ctx.cardNote = true;
  if (
    ctx.topicTitle === undefined &&
    ctx.upcomingTitle === undefined &&
    ctx.cardNote !== true
  ) {
    return undefined;
  }
  return ctx;
}

/**
 * Chips de arranque. Sin contexto, los tres textos fijos. Con tema, entrega
 * o nota de tarjeta, el chip contextual va delante.
 */
export function starterPrompts(ctx?: StarterContext): readonly string[] {
  const extra: string[] = [];
  if (ctx?.cardNote === true) extra.push(chatStrings.starterCardNote);
  const topicTitle = titled(ctx?.topicTitle);
  if (topicTitle !== undefined) {
    extra.push(tr(chatStrings.starterTopic, { title: topicTitle }));
  }
  const upcomingTitle = titled(ctx?.upcomingTitle);
  if (upcomingTitle !== undefined) {
    extra.push(tr(chatStrings.starterUpcoming, { title: upcomingTitle }));
  }
  return [...extra, ...chatStrings.starters];
}
