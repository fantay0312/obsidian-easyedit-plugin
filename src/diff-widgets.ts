import { EditorView, WidgetType } from '@codemirror/view';
import {
  diffStateField, acceptAllEffect, rejectAllEffect,
  acceptLineEffect, rejectLineEffect, clearDiffEffect,
  getAcceptedText, getFinalText,
} from './diff-state';
import { DiffLineType } from './types';

export class DiffActionBarWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'easyedit-diff-action-bar';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'easyedit-btn-accept-all';
    acceptBtn.textContent = '✓ Accept All';
    acceptBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const state = view.state.field(diffStateField);
      const acceptedText = getAcceptedText(state.diffLines);
      view.dispatch({
        effects: acceptAllEffect.of(undefined),
        changes: { from: state.fromPos, to: state.toPos, insert: acceptedText },
      });
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'easyedit-btn-reject-all';
    rejectBtn.textContent = '✗ Reject All';
    rejectBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const state = view.state.field(diffStateField);
      view.dispatch({
        effects: rejectAllEffect.of(undefined),
        changes: { from: state.fromPos, to: state.toPos, insert: state.originalText },
      });
    });

    bar.appendChild(acceptBtn);
    bar.appendChild(rejectBtn);
    return bar;
  }

  eq(): boolean { return true; }
  ignoreEvent(): boolean { return true; }
}

export class LineActionWidget extends WidgetType {
  constructor(
    private lineIndex: number,
    private lineType: DiffLineType,
  ) { super(); }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'easyedit-line-action';

    const checkAutoResolve = (): void => {
      setTimeout(() => {
        const state = view.state.field(diffStateField);
        if (!state.active) return;
        if (state.lineStatuses.every(s => s !== 'pending')) {
          const finalText = getFinalText(state.diffLines, state.lineStatuses);
          view.dispatch({
            effects: clearDiffEffect.of(undefined),
            changes: { from: state.fromPos, to: state.toPos, insert: finalText },
          });
        }
      }, 0);
    };

    if (this.lineType === 'added') {
      const accept = document.createElement('button');
      accept.textContent = '✓';
      accept.title = 'Accept';
      accept.addEventListener('mousedown', (e) => {
        e.preventDefault();
        view.dispatch({ effects: acceptLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      const reject = document.createElement('button');
      reject.textContent = '✗';
      reject.title = 'Reject';
      reject.addEventListener('mousedown', (e) => {
        e.preventDefault();
        view.dispatch({ effects: rejectLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      span.appendChild(accept);
      span.appendChild(reject);
    } else if (this.lineType === 'deleted') {
      const restore = document.createElement('button');
      restore.textContent = '↩';
      restore.title = 'Keep';
      restore.addEventListener('mousedown', (e) => {
        e.preventDefault();
        view.dispatch({ effects: rejectLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      const confirm = document.createElement('button');
      confirm.textContent = '✗';
      confirm.title = 'Delete';
      confirm.addEventListener('mousedown', (e) => {
        e.preventDefault();
        view.dispatch({ effects: acceptLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      span.appendChild(restore);
      span.appendChild(confirm);
    }

    return span;
  }

  eq(other: LineActionWidget): boolean {
    return this.lineIndex === other.lineIndex && this.lineType === other.lineType;
  }

  ignoreEvent(): boolean { return true; }
}
