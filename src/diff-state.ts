import { StateField, StateEffect, Extension, Range } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { DiffLine, DiffResult } from './types';
import { DiffActionBarWidget, LineActionWidget } from './diff-widgets';

// ===== Effects =====
export const startStreamingEffect = StateEffect.define<{
  from: number;
  to: number;
  originalText: string;
}>();
export const appendStreamChunkEffect = StateEffect.define<string>();
export const finishStreamingEffect = StateEffect.define<void>();
export const applyDiffEffect = StateEffect.define<DiffResult>();
export const acceptAllEffect = StateEffect.define<void>();
export const rejectAllEffect = StateEffect.define<void>();
export const acceptLineEffect = StateEffect.define<number>();
export const rejectLineEffect = StateEffect.define<number>();
export const clearDiffEffect = StateEffect.define<void>();

// ===== State Data =====
interface DiffStateData {
  active: boolean;
  streaming: boolean;
  originalText: string;
  newText: string;
  diffLines: DiffLine[];
  fromPos: number;
  toPos: number;
  lineStatuses: Array<'pending' | 'accepted' | 'rejected'>;
}

const EMPTY_STATE: DiffStateData = {
  active: false,
  streaming: false,
  originalText: '',
  newText: '',
  diffLines: [],
  fromPos: 0,
  toPos: 0,
  lineStatuses: [],
};

// ===== StateField =====
export const diffStateField = StateField.define<DiffStateData>({
  create: () => ({ ...EMPTY_STATE }),
  update(state, tr) {
    let s = { ...state };

    for (const e of tr.effects) {
      if (e.is(startStreamingEffect)) {
        s = {
          ...EMPTY_STATE,
          streaming: true,
          originalText: e.value.originalText,
          fromPos: e.value.from,
          toPos: e.value.from,
        };
      } else if (e.is(appendStreamChunkEffect)) {
        s = { ...s, newText: s.newText + e.value };
      } else if (e.is(finishStreamingEffect)) {
        s = { ...s, streaming: false };
      } else if (e.is(applyDiffEffect)) {
        s = {
          ...s,
          active: true,
          streaming: false,
          diffLines: e.value.lines,
          originalText: e.value.originalText,
          newText: e.value.newText,
          lineStatuses: e.value.lines.map(() => 'pending' as const),
        };
      } else if (e.is(acceptAllEffect) || e.is(rejectAllEffect) || e.is(clearDiffEffect)) {
        s = { ...EMPTY_STATE };
      } else if (e.is(acceptLineEffect)) {
        const statuses = [...s.lineStatuses];
        statuses[e.value] = 'accepted';
        s = { ...s, lineStatuses: statuses };
      } else if (e.is(rejectLineEffect)) {
        const statuses = [...s.lineStatuses];
        statuses[e.value] = 'rejected';
        s = { ...s, lineStatuses: statuses };
      }
    }

    // Map positions through document changes
    if (tr.docChanged && (s.active || s.streaming)) {
      s = {
        ...s,
        fromPos: tr.changes.mapPos(s.fromPos, -1),
        toPos: tr.changes.mapPos(s.toPos, 1),
      };
    }

    return s;
  },
});

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
      // Action bar widget above the diff area
      decorations.push(
        Decoration.widget({
          widget: new DiffActionBarWidget(),
          block: true,
          side: -1,
        }).range(state.fromPos)
      );

      let lineNum = doc.lineAt(state.fromPos).number;
      for (let i = 0; i < state.diffLines.length && lineNum <= doc.lines; i++) {
        const dl = state.diffLines[i];
        const status = state.lineStatuses[i];
        if (status !== 'pending') { lineNum++; continue; }

        const line = doc.line(lineNum);
        if (dl.type === 'added') {
          decorations.push(Decoration.line({ class: 'easyedit-diff-added' }).range(line.from));
          decorations.push(
            Decoration.widget({
              widget: new LineActionWidget(i, dl.type),
              side: 1,
            }).range(line.to)
          );
        } else if (dl.type === 'deleted') {
          decorations.push(Decoration.line({ class: 'easyedit-diff-deleted' }).range(line.from));
          decorations.push(
            Decoration.widget({
              widget: new LineActionWidget(i, dl.type),
              side: 1,
            }).range(line.to)
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

// ===== LCS Diff Algorithm =====
export function computeLineDiff(original: string, modified: string): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'unchanged', content: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', content: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'deleted', content: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

export function getMergedText(diffLines: DiffLine[]): string {
  return diffLines.map(l => l.content).join('\n');
}

export function getAcceptedText(diffLines: DiffLine[]): string {
  return diffLines.filter(l => l.type !== 'deleted').map(l => l.content).join('\n');
}

export function getFinalText(
  diffLines: DiffLine[],
  lineStatuses: Array<'pending' | 'accepted' | 'rejected'>
): string {
  return diffLines
    .filter((l, i) => {
      const status = lineStatuses[i];
      if (l.type === 'added') return status === 'accepted';
      if (l.type === 'deleted') return status === 'rejected'; // rejected deletion = keep
      return true; // unchanged always kept
    })
    .map(l => l.content)
    .join('\n');
}

// ===== Extension factory =====
export function diffExtension(): Extension[] {
  return [diffStateField, diffDecorations];
}
