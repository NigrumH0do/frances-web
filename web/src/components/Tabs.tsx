import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface TabDef {
  id: string;
  label: string;
  panel: ReactNode;
}

// Pestañas WAI-ARIA: flechas (con vuelta), Inicio y Fin. Solo se monta el panel activo.
export function Tabs({
  label,
  tabs,
  initial,
}: {
  label: string;
  tabs: TabDef[];
  initial?: string;
}) {
  const base = useId();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initial ?? tabs[0]?.id,
  );
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (tabs.length === 0) return null;
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selectedId),
  );
  const active = tabs[activeIndex] as TabDef;

  function moveTo(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    setSelectedId(tab.id);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = tabs.length - 1;
    switch (event.key) {
      case 'ArrowRight':
        moveTo(activeIndex === last ? 0 : activeIndex + 1);
        break;
      case 'ArrowLeft':
        moveTo(activeIndex === 0 ? last : activeIndex - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(last);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div>
      <div role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={handleKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${active.id}`}
        tabIndex={0}
      >
        {active.panel}
      </div>
    </div>
  );
}
