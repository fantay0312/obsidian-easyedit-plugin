import { EditorView, WidgetType } from '@codemirror/view';
import {
  diffStateField, diffAction,
  easyEditTransaction, getAcceptedText, getFinalText, getVisibleText, hasPendingLineDecisions,
} from './diff-core';
import { DiffLineType } from './types';

/**
 * Single dispatch: replace text and clear state via annotation in one transaction.
 * Using clearDiffAction annotation instead of StateEffect for reliable state clearing
 * from widget event handlers (effects can fail due to identity mismatch in bundles).
 */
function acceptAll(view: EditorView): void {
  const s = view.state.field(diffStateField);
  if (!s.active) return;

  view.dispatch({
    annotations: [easyEditTransaction.of(true), diffAction.of({ type: 'clear' })],
    changes: { from: s.fromPos, to: s.toPos, insert: getAcceptedText(s.diffLines) },
  });
}

function rejectAll(view: EditorView): void {
  const s = view.state.field(diffStateField);
  if (!s.active) return;

  view.dispatch({
    annotations: [easyEditTransaction.of(true), diffAction.of({ type: 'clear' })],
    changes: { from: s.fromPos, to: s.toPos, insert: s.originalText },
  });
}

export class DiffActionBarWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'easyedit-diff-action-bar';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'easyedit-btn-accept-all';
    acceptBtn.textContent = '✓ Accept All';
    bar.appendChild(acceptBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'easyedit-btn-reject-all';
    rejectBtn.textContent = '✗ Reject All';
    bar.appendChild(rejectBtn);

    bar.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      e.preventDefault();
      e.stopPropagation();

      if (target.closest('.easyedit-btn-accept-all')) {
        acceptAll(view);
      } else if (target.closest('.easyedit-btn-reject-all')) {
        rejectAll(view);
      }
    });

    return bar;
  }

  eq(): boolean { return true; }
  ignoreEvent(): boolean { return true; }
}

function applyLineDecision(
  view: EditorView,
  lineIndex: number,
  decision: 'acceptLine' | 'rejectLine',
): void {
  const s = view.state.field(diffStateField);
  if (!s.active) return;

  const nextStatuses = [...s.lineStatuses];
  nextStatuses[lineIndex] = decision === 'acceptLine' ? 'accepted' : 'rejected';

  if (!hasPendingLineDecisions(s.diffLines, nextStatuses)) {
    view.dispatch({
      annotations: [easyEditTransaction.of(true), diffAction.of({ type: 'clear' })],
      changes: {
        from: s.fromPos,
        to: s.toPos,
        insert: getFinalText(s.diffLines, nextStatuses),
      },
    });
    return;
  }

  view.dispatch({
    annotations: [easyEditTransaction.of(true), diffAction.of({ type: decision, index: lineIndex })],
    changes: {
      from: s.fromPos,
      to: s.toPos,
      insert: getVisibleText(s.diffLines, nextStatuses),
    },
  });
}

export class LineActionWidget extends WidgetType {
  constructor(
    private lineIndex: number,
    private lineType: DiffLineType,
  ) { super(); }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'easyedit-line-action';
    const idx = this.lineIndex;

    if (this.lineType === 'added') {
      const accept = document.createElement('button');
      accept.textContent = '✓';
      accept.title = 'Accept';
      accept.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyLineDecision(view, idx, 'acceptLine');
      });

      const reject = document.createElement('button');
      reject.textContent = '✗';
      reject.title = 'Reject';
      reject.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyLineDecision(view, idx, 'rejectLine');
      });

      span.appendChild(accept);
      span.appendChild(reject);
    } else if (this.lineType === 'deleted') {
      const restore = document.createElement('button');
      restore.textContent = '↩';
      restore.title = 'Keep';
      restore.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyLineDecision(view, idx, 'rejectLine');
      });

      const del = document.createElement('button');
      del.textContent = '✗';
      del.title = 'Delete';
      del.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyLineDecision(view, idx, 'acceptLine');
      });

      span.appendChild(restore);
      span.appendChild(del);
    }

    return span;
  }

  eq(other: LineActionWidget): boolean {
    return this.lineIndex === other.lineIndex && this.lineType === other.lineType;
  }

  ignoreEvent(): boolean { return true; }
}
