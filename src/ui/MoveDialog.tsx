import { useState } from 'react';
import { Folder, FolderInput } from 'lucide-react';
import { Dialog } from './overlay';
import { useNotebook } from '../notebook/store';
import { LAYOUT } from '../notebook/model';

export function MoveDialog({ close, onPick, current }: { close: () => void; onPick: (folder: string) => void; current: string }) {
  const folders = useNotebook((s) => s.folders);
  const [sel, setSel] = useState(current);
  const all = [LAYOUT.projects, ...folders];
  return (
    <Dialog
      title="Move to…"
      icon={<FolderInput className="gc-dialog-icon" />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={sel === current}
            onClick={() => {
              onPick(sel);
              close();
            }}
          >
            Move here
          </button>
        </>
      }
    >
      <div className="gc-picker-list">
        {all.map((f) => {
          const depth = f.split('/').length - 1;
          return (
            <button
              key={f}
              className={`gc-picker-item ${sel === f ? 'active' : ''}`}
              style={{ paddingLeft: 10 + depth * 16 }}
              onClick={() => setSel(f)}
              onDoubleClick={() => (onPick(f), close())}
            >
              <Folder />
              <span className="gc-picker-main">
                <span className="gc-picker-title">
                  <span className="gc-picker-name">{depth === 0 ? 'Projects (top level)' : f.split('/').pop()}</span>
                </span>
              </span>
              {f === current && <span className="muted">current</span>}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
