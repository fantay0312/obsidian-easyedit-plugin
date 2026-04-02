import { StateField, Extension, Range } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { diffStateField, isLineVisible } from './diff-core';
import { DiffActionBarWidget, LineActionWidget } from './diff-widgets';

// Re-export everything from diff-core for external consumers
export {
  startStreamingEffect, appendStreamChunkEffect, finishStreamingEffect,
  applyDiffEffect,
  acceptLineEffect, rejectLineEffect, clearDiffEffect,
  diffAction,
  diffStateField,
  computeLineDiff, getMergedText, getAcceptedText, getFinalText, getVisibleText,
  easyEditTransaction, isEasyEditTransaction,
  hasActionableDiff, hasPendingLineDecisions, isLineVisible,
} from './diff-core';

// ===== Streaming Preview Widget =====
class StreamingPreviewWidget extends WidgetType {
  constructor(private previewText: string) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'easyedit-stream-preview';

    if (this.previewText) {
      const body = document.createElement('pre');
      body.className = 'easyedit-stream-preview-text';
      body.textContent = this.previewText;
      container.appendChild(body);
    }

    const status = document.createElement('div');
    status.className = 'easyedit-loading-spinner';
    status.textContent = ' 思考中...';
    container.appendChild(status);

    return container;
  }

  eq(other: StreamingPreviewWidget): boolean {
    return this.previewText === other.previewText;
  }
}

// ===== Decorations =====
const diffDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const state = tr.state.field(diffStateField);
    const decorations: Array<Range<Decoration>> = [];
    const doc = tr.state.doc;

    // Loading decorations -- original text stays visible with subtle highlight
    if (state.streaming && state.fromPos <= state.toPos) {
      const clampedFrom = Math.min(state.fromPos, doc.length);
      const clampedTo = Math.min(state.toPos, doc.length);
      const fromLine = doc.lineAt(clampedFrom);
      const toLine = doc.lineAt(clampedTo);
      for (let i = fromLine.number; i <= toLine.number; i++) {
        const line = doc.line(i);
        decorations.push(Decoration.line({ class: 'easyedit-loading' }).range(line.from));
      }
      decorations.push(
        Decoration.widget({
          widget: new StreamingPreviewWidget(state.newText),
          block: true,
          side: 1,
        })
          .range(clampedTo)
      );
    }

    // Diff decorations with action widgets
    if (state.active && state.diffLines.length > 0) {
      const hasPendingChanges = state.diffLines.some((line, index) => {
        return line.type !== 'unchanged' && state.lineStatuses[index] === 'pending';
      });

      if (hasPendingChanges) {
        decorations.push(
          Decoration.widget({
            widget: new DiffActionBarWidget(),
            block: true,
            side: -1,
          }).range(state.fromPos)
        );
      }

      let lineNum = doc.lineAt(state.fromPos).number;
      for (let i = 0; i < state.diffLines.length && lineNum <= doc.lines; i++) {
        const dl = state.diffLines[i];
        const status = state.lineStatuses[i];
        if (!isLineVisible(dl, status)) continue;

        const line = doc.line(lineNum);
        if (status === 'pending' && dl.type === 'added') {
          decorations.push(Decoration.line({ class: 'easyedit-diff-added' }).range(line.from));
          decorations.push(
            Decoration.widget({ widget: new LineActionWidget(i, dl.type), side: 1 }).range(line.to)
          );
        } else if (status === 'pending' && dl.type === 'deleted') {
          decorations.push(Decoration.line({ class: 'easyedit-diff-deleted' }).range(line.from));
          decorations.push(
            Decoration.widget({ widget: new LineActionWidget(i, dl.type), side: 1 }).range(line.to)
          );
        }
        lineNum++;
      }
    }

    decorations.sort((a, b) => a.from - b.from);
    return Decoration.set(decorations);
  },
  provide: f => EditorView.decorations.from(f),
});

// ===== Extension factory =====
export function diffExtension(): Extension[] {
  return [diffStateField, diffDecorations];
}
