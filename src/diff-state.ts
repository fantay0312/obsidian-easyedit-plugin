import { StateField, Extension, Range } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { diffStateField } from './diff-core';
import { DiffActionBarWidget, LineActionWidget } from './diff-widgets';

// Re-export everything from diff-core for external consumers
export {
  startStreamingEffect, appendStreamChunkEffect, finishStreamingEffect,
  applyDiffEffect, acceptAllEffect, rejectAllEffect,
  acceptLineEffect, rejectLineEffect, clearDiffEffect,
  diffStateField,
  computeLineDiff, getMergedText, getAcceptedText, getFinalText,
  easyEditTransaction, isEasyEditTransaction,
  hasActionableDiff, hasPendingLineDecisions,
} from './diff-core';

// ===== Typing Cursor Widget =====
class TypingCursorWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'easyedit-typing-cursor';
    return span;
  }

  eq(): boolean { return true; }
}

// ===== Decorations =====
const diffDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const state = tr.state.field(diffStateField);
    const decorations: Array<Range<Decoration>> = [];
    const doc = tr.state.doc;

    // Streaming decorations
    if (state.streaming && state.fromPos < state.toPos) {
      const fromLine = doc.lineAt(state.fromPos);
      const toLine = doc.lineAt(Math.min(state.toPos, doc.length));
      for (let i = fromLine.number; i <= toLine.number; i++) {
        const line = doc.line(i);
        decorations.push(Decoration.line({ class: 'easyedit-streaming' }).range(line.from));
      }
      decorations.push(
        Decoration.widget({ widget: new TypingCursorWidget(), side: 1 })
          .range(Math.min(state.toPos, doc.length))
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
        if (status !== 'pending') { lineNum++; continue; }

        const line = doc.line(lineNum);
        if (dl.type === 'added') {
          decorations.push(Decoration.line({ class: 'easyedit-diff-added' }).range(line.from));
          decorations.push(
            Decoration.widget({ widget: new LineActionWidget(i, dl.type), side: 1 }).range(line.to)
          );
        } else if (dl.type === 'deleted') {
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
