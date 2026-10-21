import { useState } from 'react';
import { KanbanSquare } from 'lucide-react';
import { BOARD_PRESETS, boardColumns, createBoard } from '../notebook/actions';
import type { BoardCards } from '../notebook/model';
import { Dialog, openDialog } from './overlay';

const splitNames = (s: string) =>
  s
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

/** A new board: what its cards are (things to track, or tasks with due dates) and its columns. */
export function openNewBoardDialog() {
  openDialog((close) => <NewBoardDialog close={close} />);
}

function NewBoardDialog({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  const [cards, setCards] = useState<BoardCards>('items');
  const [columns, setColumns] = useState(BOARD_PRESETS.items.join(', '));
  const [busy, setBusy] = useState(false);
  const preview = boardColumns(splitNames(columns));

  const pick = (next: BoardCards) => {
    // Keep columns the person typed; swap only the suggested ones.
    if (columns === BOARD_PRESETS[cards].join(', ')) setColumns(BOARD_PRESETS[next].join(', '));
    setCards(next);
  };
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createBoard(name, { cards, columns: splitNames(columns) });
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New board"
      icon={<KanbanSquare className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create board
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label htmlFor="nb-name">Name</label>
          <input
            id="nb-name"
            className="input"
            autoFocus
            value={name}
            placeholder={cards === 'items' ? 'e.g. Cloning status, Samples, Orders' : 'e.g. Lab chores, Grant writing'}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <fieldset className="gc-choice-group">
          <legend className="field-label">Cards on this board are</legend>
          <label className={`gc-choice ${cards === 'items' ? 'active' : ''}`}>
            <input type="radio" name="nb-cards" checked={cards === 'items'} onChange={() => pick('items')} />
            <span>
              <strong>Things to track</strong>
              <small>Constructs, samples, orders… moving through stages. No due dates: they stay off the calendar.</small>
            </span>
          </label>
          <label className={`gc-choice ${cards === 'tasks' ? 'active' : ''}`}>
            <input type="radio" name="nb-cards" checked={cards === 'tasks'} onChange={() => pick('tasks')} />
            <span>
              <strong>Tasks</strong>
              <small>To-dos with a due date and a priority. They show on the calendar and in Home’s open tasks.</small>
            </span>
          </label>
        </fieldset>
        <div className="field">
          <label htmlFor="nb-columns">Columns</label>
          <input id="nb-columns" className="input" value={columns} onChange={(e) => setColumns(e.target.value)} />
          <span className="field-hint">
            Separated by commas, e.g. Designed, PCR, Assembled, Sequenced. You can rename, recolor and reorder them later.
          </span>
          {preview.length > 0 && (
            <div className="gc-board-preview" aria-label="Columns of the new board">
              {preview.map((c) => (
                <span key={c.id} className={`pill tone-${c.color}`}>
                  <span className="dot" />
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
