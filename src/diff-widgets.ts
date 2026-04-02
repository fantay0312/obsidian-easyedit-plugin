import { EditorView, WidgetType } from '@codemirror/view';
import { Notice } from 'obsidian';
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
    bar.appendChild(acceptBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'easyedit-btn-reject-all';
    rejectBtn.textContent = '✗ Reject All';
    bar.appendChild(rejectBtn);

    // Use a single mousedown listener on the bar to avoid any event issues
    bar.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      const isAccept = target.closest('.easyedit-btn-accept-all');
      const isReject = target.closest('.easyedit-btn-reject-all');
      if (!isAccept && !isReject) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        const s = view.state.field(diffStateField);
        if (!s.active) {
          new Notice('[EasyEdit debug] state not active');
          return;
        }

        const docLen = view.state.doc.length;
        if (s.fromPos < 0 || s.toPos > docLen || s.fromPos > s.toPos) {
          new Notice(`[EasyEdit debug] invalid range: ${s.fromPos}-${s.toPos}, docLen=${docLen}`);
          return;
        }

        const insert = isAccept
          ? getAcceptedText(s.diffLines)
          : s.originalText;

        const effect = isAccept ? acceptAllEffect : rejectAllEffect;

        view.dispatch({
          annotations: easyEditTransaction.of(true),
          effects: effect.of(undefined),
          changes: { from: s.fromPos, to: s.toPos, insert },
        });

        // Verify the state was cleared
        const after = view.state.field(diffStateField);
        if (after.active) {
          new Notice('[EasyEdit debug] state still active after dispatch!');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`[EasyEdit error] ${msg}`);
      }
    });

    return bar;
  }

  eq(): boolean { return true; }

  ignoreEvent(): boolean { return true; }
}

function autoResolve(view: EditorView): void {
  setTimeout(() => {
    try {
      const s = view.state.field(diffStateField);
      if (!s.active) return;
      if (hasPendingLineDecisions(s.diffLines, s.lineStatuses)) return;
      view.dispatch({
        annotations: easyEditTransaction.of(true),
        effects: clearDiffEffect.of(undefined),
        changes: { from: s.fromPos, to: s.toPos, insert: getFinalText(s.diffLines, s.lineStatuses) },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`[EasyEdit autoResolve error] ${msg}`);
    }
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
      accept.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({ effects: acceptLineEffect.of(idx) });
        autoResolve(view);
      });

      const reject = document.createElement('button');
      reject.textContent = '✗';
      reject.title = 'Reject';
      reject.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({ effects: rejectLineEffect.of(idx) });
        autoResolve(view);
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
        view.dispatch({ effects: rejectLineEffect.of(idx) });
        autoResolve(view);
      });

      const del = document.createElement('button');
      del.textContent = '✗';
      del.title = 'Delete';
      del.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({ effects: acceptLineEffect.of(idx) });
        autoResolve(view);
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
