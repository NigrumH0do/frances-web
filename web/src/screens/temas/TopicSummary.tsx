import type { JSX } from 'react';
import { useApi } from '../../api/ApiContext';
import { HttpError } from '../../api/client';
import { useResource } from '../../api/useResource';
import { StateView } from '../../components';
import type {
  CardView,
  StudySheet,
  StudyTopic,
} from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { SheetView } from '../publicacion/SheetView';
import { temaStrings as s } from './strings';

interface SummaryData {
  cards: CardView[];
  sheets: StudySheet[];
}

// `GET /api/topics/{id}/cards` acepta limit 1…50. Para el resumen se recorre
// el cursor completo (con una cota de seguridad) y así todas las tarjetas del
// tema quedan disponibles para el audio de frases y vocabulario.
const CARD_PAGE_LIMIT = 50;
const MAX_CARD_PAGES = 10;

// Resumen del tema: la descripción generada y, por publicación, su ficha de
// estudio. Las frases y el vocabulario reproducen audio cuando `topicCards`
// trae la tarjeta correspondiente (UI-11/UI-14).
export function TopicSummary({ topic }: { topic: StudyTopic }): JSX.Element {
  const api = useApi();
  const state = useResource<SummaryData>(
    `topic-summary:${topic.id}`,
    async (signal) => {
      const [cards, sheets] = await Promise.all([
        (async () => {
          const all: CardView[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < MAX_CARD_PAGES; page += 1) {
            const result = await api.topicCards(
              topic.id,
              {
                limit: CARD_PAGE_LIMIT,
                cursor,
              },
              { signal },
            );
            all.push(...result.cards);
            if (result.next_cursor === null) break;
            cursor = result.next_cursor;
          }
          return all;
        })(),
        Promise.all(
          topic.item_ids.map(async (itemId) => {
            try {
              return await api.sheet(itemId, { signal });
            } catch (error) {
              // Una publicación sin ficha no invalida el resumen del tema.
              if (error instanceof HttpError && error.status === 404) {
                return null;
              }
              throw error;
            }
          }),
        ),
      ]);
      return {
        cards,
        sheets: sheets.filter((sheet): sheet is StudySheet => sheet !== null),
      };
    },
  );

  const description = topic.description_es.trim();

  return (
    <div className="stack-lg">
      {description !== '' ? <p>{topic.description_es}</p> : null}

      <StateView
        state={state}
        empty={(data) => data.sheets.length === 0 && description === ''}
        emptyText={s.summaryEmpty}
        onRetry={state.reload}
      >
        {(data) => (
          <div className="stack-lg">
            {data.sheets.map((sheet, index) => (
              <section className="stack" key={sheet.item_id}>
                <h2>{tr(s.publication, { n: index + 1 })}</h2>
                <SheetView sheet={sheet} cards={data.cards} />
              </section>
            ))}
            {data.sheets.length < topic.item_ids.length ? (
              <p className="small muted">{s.summaryPending}</p>
            ) : null}
          </div>
        )}
      </StateView>
    </div>
  );
}

export default TopicSummary;
