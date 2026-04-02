import { EditorView, WidgetType } from '@codemirror/view';
import {
  diffStateField, acceptAllEffect, rejectAllEffect,
  acceptLineEffect, rejectLineEffect, clearDiffEffect,
  easyEditTransaction, getAcceptedText, getFinalText, hasPendingLineDecisions,
} from './diff-core';
import { DiffLineType } from './types';

function bindWidgetButton(
  button: HTMLButtonElement,
  view: EditorView,
  onActivate: () => void,
): void {
  const activate = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    onActivate();
    view.focus();
  };

  button.type = 'button';
  button.addEventListener('mousedown', activate);
  button.addEventListener('touchend', activate);
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      activate(e);
    }
  });
}

function dispatchDiffReplacement(
  view: EditorView,
  effect: typeof acceptAllEffect | typeof rejectAllEffect | typeof clearDiffEffect,
  insert: string,
): void {
  const state = view.state.field(diffStateField);
  if (!state.active) return;

  view.dispatch({
    annotations: easyEditTransaction.of(true),
    effects: effect.of(undefined),
    changes: { from: state.fromPos, to: state.toPos, insert },
  });
}

export class DiffActionBarWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'easyedit-diff-action-bar';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'easyedit-btn-accept-all';
    acceptBtn.textContent = '✓ Accept All';
    bindWidgetButton(acceptBtn, view, () => {
      const state = view.state.field(diffStateField);
      const acceptedText = getAcceptedText(state.diffLines);
      dispatchDiffReplacement(view, acceptAllEffect, acceptedText);
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'easyedit-btn-reject-all';
    rejectBtn.textContent = '✗ Reject All';
    bindWidgetButton(rejectBtn, view, () => {
      const state = view.state.field(diffStateField);
      dispatchDiffReplacement(view, rejectAllEffect, state.originalText);
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
        if (!hasPendingLineDecisions(state.diffLines, state.lineStatuses)) {
          const finalText = getFinalText(state.diffLines, state.lineStatuses);
          view.dispatch({
            annotations: easyEditTransaction.of(true),
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
      bindWidgetButton(accept, view, () => {
        view.dispatch({ effects: acceptLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      const reject = document.createElement('button');
      reject.textContent = '✗';
      reject.title = 'Reject';
      bindWidgetButton(reject, view, () => {
        view.dispatch({ effects: rejectLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      span.appendChild(accept);
      span.appendChild(reject);
    } else if (this.lineType === 'deleted') {
      const restore = document.createElement('button');
      restore.textContent = '↩';
      restore.title = 'Keep';
      bindWidgetButton(restore, view, () => {
        view.dispatch({ effects: rejectLineEffect.of(this.lineIndex) });
        checkAutoResolve();
      });

      const confirm = document.createElement('button');
      confirm.textContent = '✗';
      confirm.title = 'Delete';
      bindWidgetButton(confirm, view, () => {
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
