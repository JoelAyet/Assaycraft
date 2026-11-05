import { RotateCcw, Stethoscope } from 'lucide-react';
import { Dialog, openDialog, type MenuItemSpec } from './overlay';
import { addTroubleshooting, repeatEntry } from '../notebook/actions';
import { navigate, toast } from '../notebook/store';
import type { DocMeta } from '../notebook/model';

/** Do a failed experiment again: a planned copy of it, opened. */
export async function repeatExperiment(d: DocMeta) {
  try {
    const path = await repeatEntry(d.path);
    navigate({ name: 'doc', path });
    toast('Planned again: a copy of it, which says what it repeats. Change what needs changing.', 'success');
  } catch (err) {
    toast(`Could not plan it again: ${(err as Error).message}`, 'error');
  }
}

/** Work out why it failed: a Troubleshooting section at the end of the entry, opened there. */
export async function troubleshootExperiment(d: DocMeta) {
  try {
    await addTroubleshooting(d.path);
    navigate({ name: 'doc', path: d.path });
    // Once the page is open, its new section is in view.
    setTimeout(() => {
      const h = Array.from(document.querySelectorAll('.gc-main .ProseMirror h2')).find((el) => el.textContent?.trim() === 'Troubleshooting');
      h?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 400);
  } catch (err) {
    toast(`Could not add the troubleshooting section: ${(err as Error).message}`, 'error');
  }
}

/** The two ways on from a failed experiment, for menus. */
export function failedMenu(d: DocMeta): MenuItemSpec[] {
  if (d.kind !== 'entry' || d.status !== 'failed') return [];
  return [
    { label: 'Troubleshoot', icon: <Stethoscope />, onSelect: () => void troubleshootExperiment(d) },
    { label: 'Plan a repeat', icon: <RotateCcw />, onSelect: () => void repeatExperiment(d) },
  ];
}

/** Asked when an experiment is moved to Failed: what next? */
export function openFailedDialog(d: DocMeta) {
  openDialog((close) => {
    const pick = (fn: (d: DocMeta) => Promise<void>) => () => {
      close();
      void fn(d);
    };
    return (
      <Dialog
        title={`${d.id ? `${d.id} ` : ''}failed. What next?`}
        onClose={close}
        footer={
          <button className="btn" onClick={close}>
            Not now
          </button>
        }
      >
        <p className="muted gc-failed-lede">“{d.title}” is marked Failed. Both stay on its card, for later.</p>
        <div className="gc-failed-options">
          <button className="gc-template-option" autoFocus onClick={pick(troubleshootExperiment)}>
            <Stethoscope />
            <span>
              <strong>Troubleshoot</strong>
              <small>Add a section to the entry: what happened, what could have caused it, what to change next time.</small>
            </span>
          </button>
          <button className="gc-template-option" onClick={pick(repeatExperiment)}>
            <RotateCcw />
            <span>
              <strong>Plan a repeat</strong>
              <small>A copy of this experiment, planned for today, that links back to this one.</small>
            </span>
          </button>
        </div>
      </Dialog>
    );
  });
}
