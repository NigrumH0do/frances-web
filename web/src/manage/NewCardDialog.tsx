import { useApi } from '../api/ApiContext';
import { Dialog } from '../components';
import type { CardView } from '../contracts/generated';
import { blankToNull, CardEditor, type CardEditorValues } from './CardEditor';
import { manageStrings as s } from './strings';

/**
 * Diálogo para crear una tarjeta propia. Reusa `CardEditor` en modo `own` y
 * devuelve la tarjeta creada por la API.
 */
export function NewCardDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (card: CardView) => void;
}) {
  const api = useApi();

  async function create(values: CardEditorValues): Promise<void> {
    const card = await api.createCard({
      kind: values.kind,
      front_fr: values.front_fr,
      back_es: values.back_es,
      example_fr: blankToNull(values.example_fr),
      example_es: blankToNull(values.example_es),
      notes: blankToNull(values.notes),
    });
    onCreated?.(card);
    onClose();
  }

  return (
    <Dialog open={open} title={s.editor.titleOwn} onClose={onClose}>
      {open ? (
        <CardEditor mode="own" onSave={create} onCancel={onClose} />
      ) : null}
    </Dialog>
  );
}

export default NewCardDialog;
