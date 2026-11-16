import type { JSX } from 'react';
import { Chip } from '../../components';
import type { CardView, StudySheet } from '../../contracts/generated';
import { tr } from '../../l10n/es';
import { CardAudio } from '../../media/CardAudio';
import { sheetStrings as s } from './strings';

function normalized(text: string): string {
  return text.normalize('NFC').trim().toLocaleLowerCase('fr');
}

function cardFront(card: CardView): string {
  return card.mine?.front_fr ?? card.front_fr;
}

function cardBack(card: CardView): string {
  return card.mine?.back_es ?? card.back_es;
}

function hasAudio(card: CardView, field: 'front' | 'example'): boolean {
  return (
    card.audio.some((clip) => clip.field === field) ||
    card.audio_pending.some((pending) => pending.field === field)
  );
}

function SheetAudio({
  card,
  field,
}: {
  card: CardView;
  field: 'front' | 'example';
}): JSX.Element | null {
  if (!hasAudio(card, field)) return null;
  return <CardAudio card={card} field={field} />;
}

// Ficha de estudio de una publicación. La reusa el resumen del tema (UI-13):
// las frases clave y el vocabulario reproducen su audio cuando `cards` trae
// la tarjeta correspondiente; sin tarjeta no se inventa ningún audio.
export function SheetView({
  sheet,
  cards = [],
}: {
  sheet: StudySheet;
  cards?: CardView[];
}): JSX.Element {
  const byId = new Map<string, CardView>();
  const byFront = new Map<string, CardView>();
  for (const card of cards) {
    byId.set(card.id, card);
    byFront.set(normalized(cardFront(card)), card);
  }

  const vocab = sheet.vocab_card_ids
    .map((id) => byId.get(id))
    .filter((card): card is CardView => card !== undefined);
  const objectives = sheet.objectives_es ?? [];

  return (
    <div className="card stack">
      {typeof sheet.prompt_version === 'string' ? (
        <div className="row wrap">
          <Chip tone="level">
            {tr(s.ai, { version: sheet.prompt_version })}
          </Chip>
        </div>
      ) : null}

      <section className="stack">
        <h3>{s.summary}</h3>
        <p>{sheet.summary_es}</p>
      </section>

      {objectives.length > 0 ? (
        <section className="stack">
          <h3>{s.objectives}</h3>
          <ul>
            {objectives.map((objective, index) => (
              <li key={`${index}-${objective}`}>{objective}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {sheet.key_phrases.length > 0 ? (
        <section className="stack">
          <h3>{s.keyPhrases}</h3>
          <ul className="list">
            {sheet.key_phrases.map((phrase, index) => {
              const card = byFront.get(normalized(phrase.fr));
              return (
                <li key={`${index}-${phrase.fr}`}>
                  <div className="sheet-phrase">
                    <p className="sheet-phrase-fr fr" lang="fr">
                      {phrase.fr}
                    </p>
                    <p className="meta">{phrase.es}</p>
                    {card !== undefined ? (
                      <SheetAudio card={card} field="front" />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {sheet.grammar.length > 0 ? (
        <section className="stack">
          <h3>{s.grammar}</h3>
          {sheet.grammar.map((point, index) => (
            <div className="stack" key={`${index}-${point.title}`}>
              <h4>{point.title}</h4>
              <p className="small">{point.explanation_es}</p>
              {point.examples.map((example, exampleIndex) => (
                <p className="small" key={`${exampleIndex}-${example.fr}`}>
                  <span className="fr" lang="fr">
                    {example.fr}
                  </span>{' '}
                  — {example.es}
                </p>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {(sheet.common_mistakes ?? []).length > 0 ? (
        <section className="stack">
          <h3>{s.mistakes}</h3>
          {(sheet.common_mistakes ?? []).map((mistake, index) => (
            <div
              className="feedback ko small"
              key={`${index}-${mistake.wrong_fr}`}
            >
              <strong className="ko" aria-hidden="true">
                ✗
              </strong>{' '}
              <span className="fr" lang="fr">
                {mistake.wrong_fr}
              </span>{' '}
              →{' '}
              <strong className="ok" aria-hidden="true">
                ✓
              </strong>{' '}
              <span className="fr" lang="fr">
                {mistake.right_fr}
              </span>
              <br />
              <span className="muted">{mistake.why_es}</span>
            </div>
          ))}
        </section>
      ) : null}

      {vocab.length > 0 ? (
        <section className="stack">
          <h3>{s.vocab}</h3>
          <ul className="list">
            {vocab.map((card) => (
              <li key={card.id}>
                <div className="sheet-phrase">
                  <p className="sheet-phrase-fr fr" lang="fr">
                    {cardFront(card)}
                  </p>
                  <p className="meta">{cardBack(card)}</p>
                  <SheetAudio card={card} field="front" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
