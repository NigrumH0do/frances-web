import type { JSX } from 'react';
import { useApi } from '../../api/ApiContext';
import { useResource } from '../../api/useResource';
import { Icon, ListItem, StateView } from '../../components';
import type { ItemDetail } from '../../contracts/generated';
import { formatShort } from '../../i18n/dates';
import { common, tr } from '../../l10n/es';
import { useOffline } from '../../offline/OfflineContext';
import { temaStrings as s } from './strings';

function itemTitle(detail: ItemDetail): JSX.Element {
  const { item } = detail;
  const title = item.title ?? s.untitled;
  if (item.text_lang === 'fr') {
    return (
      <span className="fr" lang="fr">
        {title}
      </span>
    );
  }
  return <span>{title}</span>;
}

function itemMeta(detail: ItemDetail): string {
  const { item } = detail;
  const attachments =
    item.n_attachments === 1
      ? s.attachmentsOne
      : tr(s.attachments, { n: item.n_attachments });
  return tr(s.itemMeta, {
    kind: s.kinds[item.kind],
    attachments,
    date: formatShort(item.created_at),
  });
}

// «Clases» del tema: pide el detalle de cada publicación de a 4 en paralelo,
// para no saturar el servidor con temas que agrupan muchas clases.
export function TopicItems({ itemIds }: { itemIds: string[] }): JSX.Element {
  const api = useApi();
  const { online } = useOffline();
  const key = itemIds.join('|');
  const state = useResource<ItemDetail[]>(
    itemIds.length === 0 ? null : `topic-items:${key}`,
    async (signal) => {
      const details = new Array<ItemDetail>(itemIds.length);
      let next = 0;
      async function worker(): Promise<void> {
        for (;;) {
          const index = next;
          next += 1;
          if (index >= itemIds.length) return;
          const itemId = itemIds[index];
          if (itemId === undefined) return;
          details[index] = await api.item(itemId, { signal });
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, itemIds.length) }, () => worker()),
      );
      return details;
    },
  );

  if (itemIds.length === 0) {
    return (
      <div className="state">
        <p>{s.classesEmpty}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      {!online && state.status === 'ready' && !state.stale ? (
        <div className="callout" role="status">
          <Icon name="offline" size="sm" />
          <p className="small grow">{common.offlineStale}</p>
        </div>
      ) : null}

      <StateView
        state={state}
        empty={(details) => details.length === 0}
        emptyText={s.classesEmpty}
        onRetry={state.reload}
      >
        {(details) => (
          <ul className="list" aria-label={s.classes}>
            {details.map((detail) => (
              <li key={detail.item.id}>
                <ListItem
                  to={`/publicaciones/${detail.item.id}`}
                  title={itemTitle(detail)}
                  meta={itemMeta(detail)}
                />
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </div>
  );
}

export default TopicItems;
