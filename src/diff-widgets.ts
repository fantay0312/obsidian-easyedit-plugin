import { EditorView, WidgetType } from '@codemirror/view';
import {
  diffStateField, acceptAllEffect, rejectAllEffect,
  acceptLineEffect, rejectLineEffect, clearDiffEffect,
  easyEditTransaction, getAcceptedText, getFinalText, hasPendingLineDecisions,
} from './diff-core';
import { DiffLineType } from './types';

export class DiffActionBarWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'easyedit-diff-action-bar';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'easyedit-btn-accept-all';
    acceptBtn.textContent = '✓ Accept All';
    acceptBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => {
        const s = view.state.field(diffStateField);
        if (!s.active) return;
        view.dispatch({
          annotations: easyEditTransaction.of(true),
          effects: acceptAllEffect.of(undefined),
          changes: { from: s.fromPos, to: s.toPos, insert: getAcceptedText(s.diffLines) },
        });
      }, 0);
    };

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'easyedit-btn-reject-all';
    rejectBtn.textContent = '✗ Reject All';
    rejectBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => {
        const s = view.state.field(diffStateField);
        if (!s.active) return;
        view.dispatch({
          annotations: easyEditTransaction.of(true),
          effects: rejectAllEffect.of(undefined),
          changes: { from: s.fromPos, to: s.toPos, insert: s.originalText },
        });
      }, 0);
    };

    bar.appendChild(acceptBtn);
    bar.appendChild(rejectBtn);
    return bar;
  }

  eq(): boolean { return true; }
  ignoreEvent(): boolean { return true; }
}

function autoResolve(view: EditorView): void {
  setTimeout(() => {
    const s = view.state.field(diffStateField);
    if (!s.active) return;
    if (hasPendingLineDecisions(s.diffLines, s.lineStatuses)) return;
    view.dispatch({
      annotations: easyEditTransaction.of(true),
      effects: clearDiffEffect.of(undefined),
      changes: { from: s.fromPos, to: s.toPos, insert: getFinalText(s.diffLines, s.lineStatuses) },
    });
  }, 0);
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
      accept.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          view.dispatch({ effects: acceptLineEffect.of(idx) });
          autoResolve(view);
        }, 0);
      };

      const reject = document.createElement('button');
      reject.textContent = '✗';
      reject.title = 'Reject';
      reject.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          view.dispatch({ effects: rejectLineEffect.of(idx) });
          autoResolve(view);
        }, 0);
      };

      span.appendChild(accept);
      span.appendChild(reject);
    } else if (this.lineType === 'deleted') {
      const restore = document.createElement('button');
      restore.textContent = '↩';
      restore.title = 'Keep';
      restore.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          view.dispatch({ effects: rejectLineEffect.of(idx) });
          autoResolve(view);
        }, 0);
      };

      const del = document.createElement('button');
      del.textContent = '✗';
      del.title = 'Delete';
      del.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          view.dispatch({ effects: acceptLineEffect.of(idx) });
          autoResolve(view);
        }, 0);
      };

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
