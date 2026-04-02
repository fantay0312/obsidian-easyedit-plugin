import { EditorView, WidgetType } from '@codemirror/view';
import {
  diffStateField, acceptAllEffect, rejectAllEffect,
  acceptLineEffect, rejectLineEffect, clearDiffEffect,
  easyEditTransaction, getAcceptedText, getFinalText, hasPendingLineDecisions,
} from './diff-core';
import { DiffLineType } from './types';

type DiffWidgetAction =
  | 'accept-all'
  | 'reject-all'
  | 'accept-line'
  | 'reject-line'
  | 'keep-line'
  | 'delete-line';

function createActionButton(
  label: string,
  title: string,
  action: DiffWidgetAction,
  lineIndex?: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.dataset.easyeditAction = action;
  if (lineIndex !== undefined) {
    button.dataset.easyeditLineIndex = String(lineIndex);
  }
  return button;
}

function resolveDiffIfDone(view: EditorView): void {
  setTimeout(() => {
    const state = view.state.field(diffStateField);
    if (!state.active) return;
    if (hasPendingLineDecisions(state.diffLines, state.lineStatuses)) return;

    const finalText = getFinalText(state.diffLines, state.lineStatuses);
    view.dispatch({
      annotations: easyEditTransaction.of(true),
      effects: clearDiffEffect.of(undefined),
      changes: { from: state.fromPos, to: state.toPos, insert: finalText },
    });
  }, 0);
}

function dispatchLineDecision(
  view: EditorView,
  effect: typeof acceptLineEffect | typeof rejectLineEffect,
  lineIndex: number,
): void {
  setTimeout(() => {
    view.dispatch({ effects: effect.of(lineIndex) });
    resolveDiffIfDone(view);
  }, 0);
}

function dispatchDiffReplacement(
  view: EditorView,
  effect: typeof acceptAllEffect | typeof rejectAllEffect | typeof clearDiffEffect,
  insert: string,
): void {
  // Defer dispatch to avoid CM6 event pipeline conflicts
  setTimeout(() => {
    const state = view.state.field(diffStateField);
    if (!state.active) return;

    view.dispatch({
      annotations: easyEditTransaction.of(true),
      effects: effect.of(undefined),
      changes: { from: state.fromPos, to: state.toPos, insert },
    });
  }, 0);
}

export function handleDiffWidgetAction(view: EditorView, target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  if (!element) return false;

  const button = element.closest('button[data-easyedit-action]');
  if (!(button instanceof HTMLButtonElement)) return false;

  const action = button.dataset.easyeditAction as DiffWidgetAction | undefined;
  const lineIndexValue = button.dataset.easyeditLineIndex;
  const lineIndex = lineIndexValue !== undefined ? Number(lineIndexValue) : undefined;

  switch (action) {
    case 'accept-all': {
      const state = view.state.field(diffStateField);
      dispatchDiffReplacement(view, acceptAllEffect, getAcceptedText(state.diffLines));
      break;
    }
    case 'reject-all': {
      const state = view.state.field(diffStateField);
      dispatchDiffReplacement(view, rejectAllEffect, state.originalText);
      break;
    }
    case 'accept-line':
      if (lineIndex !== undefined) dispatchLineDecision(view, acceptLineEffect, lineIndex);
      break;
    case 'reject-line':
    case 'keep-line':
      if (lineIndex !== undefined) dispatchLineDecision(view, rejectLineEffect, lineIndex);
      break;
    case 'delete-line':
      if (lineIndex !== undefined) dispatchLineDecision(view, acceptLineEffect, lineIndex);
      break;
    default:
      return false;
  }

  view.focus();
  return true;
}

export class DiffActionBarWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'easyedit-diff-action-bar';

    const acceptBtn = createActionButton('✓ Accept All', 'Accept All', 'accept-all');
    acceptBtn.className = 'easyedit-btn-accept-all';

    const rejectBtn = createActionButton('✗ Reject All', 'Reject All', 'reject-all');
    rejectBtn.className = 'easyedit-btn-reject-all';

    bar.appendChild(acceptBtn);
    bar.appendChild(rejectBtn);
    return bar;
  }

  eq(): boolean { return true; }
  ignoreEvent(): boolean { return false; }
}

export class LineActionWidget extends WidgetType {
  constructor(
    private lineIndex: number,
    private lineType: DiffLineType,
  ) { super(); }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'easyedit-line-action';

    if (this.lineType === 'added') {
      const accept = createActionButton('✓', 'Accept', 'accept-line', this.lineIndex);

      const reject = createActionButton('✗', 'Reject', 'reject-line', this.lineIndex);

      span.appendChild(accept);
      span.appendChild(reject);
    } else if (this.lineType === 'deleted') {
      const restore = createActionButton('↩', 'Keep', 'keep-line', this.lineIndex);

      const confirm = createActionButton('✗', 'Delete', 'delete-line', this.lineIndex);

      span.appendChild(restore);
      span.appendChild(confirm);
    }

    return span;
  }

  eq(other: LineActionWidget): boolean {
    return this.lineIndex === other.lineIndex && this.lineType === other.lineType;
  }

  ignoreEvent(): boolean { return false; }
}
