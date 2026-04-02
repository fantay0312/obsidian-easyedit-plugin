import { Annotation, StateEffect, StateField, Transaction } from '@codemirror/state';
import { DiffLine, DiffResult } from './types';

export type DiffLineStatus = 'pending' | 'accepted' | 'rejected';

export const easyEditTransaction = Annotation.define<boolean>();
export const clearDiffAction = Annotation.define<boolean>();
export const acceptLineAction = Annotation.define<number>();
export const rejectLineAction = Annotation.define<number>();

// ===== Effects =====
export const startStreamingEffect = StateEffect.define<{
  from: number;
  to: number;
  originalText: string;
}>();
export const finishStreamingEffect = StateEffect.define<void>();
export const applyDiffEffect = StateEffect.define<DiffResult>();
export const acceptLineEffect = StateEffect.define<number>();
export const rejectLineEffect = StateEffect.define<number>();
export const clearDiffEffect = StateEffect.define<void>();

// ===== State Data =====
export interface DiffStateData {
  active: boolean;
  streaming: boolean;
  originalText: string;
  newText: string;
  diffLines: DiffLine[];
  fromPos: number;
  toPos: number;
  lineStatuses: DiffLineStatus[];
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
    // Annotation-based actions — reliable from widget event handlers
    // (StateEffect.is() can fail due to identity mismatch in bundles)
    if (tr.annotation(clearDiffAction)) {
      return { ...EMPTY_STATE };
    }

    let s = { ...state };

    const acceptIdx = tr.annotation(acceptLineAction);
    if (acceptIdx !== undefined && s.active) {
      const statuses = [...s.lineStatuses];
      statuses[acceptIdx] = 'accepted';
      s = { ...s, lineStatuses: statuses };
    }
    const rejectIdx = tr.annotation(rejectLineAction);
    if (rejectIdx !== undefined && s.active) {
      const statuses = [...s.lineStatuses];
      statuses[rejectIdx] = 'rejected';
      s = { ...s, lineStatuses: statuses };
    }

    for (const e of tr.effects) {
      if (e.is(startStreamingEffect)) {
        s = {
          ...EMPTY_STATE,
          streaming: true,
          originalText: e.value.originalText,
          fromPos: e.value.from,
          toPos: e.value.to,
        };
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
          lineStatuses: getInitialLineStatuses(e.value.lines),
        };
      } else if (e.is(clearDiffEffect)) {
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

// ===== LCS Diff Algorithm =====
function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

export function computeLineDiff(original: string, modified: string): DiffLine[] {
  const oldLines = splitLines(original);
  const newLines = splitLines(modified);
  const m = oldLines.length;
  const n = newLines.length;

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

export function getInitialLineStatuses(diffLines: DiffLine[]): DiffLineStatus[] {
  return diffLines.map(line => line.type === 'unchanged' ? 'accepted' : 'pending');
}

export function hasPendingLineDecisions(
  diffLines: DiffLine[],
  lineStatuses: DiffLineStatus[],
): boolean {
  return diffLines.some((line, index) => {
    return line.type !== 'unchanged' && lineStatuses[index] === 'pending';
  });
}

export function hasActionableDiff(diffLines: DiffLine[]): boolean {
  return diffLines.some(line => line.type !== 'unchanged');
}

export function getFinalText(
  diffLines: DiffLine[],
  lineStatuses: DiffLineStatus[],
): string {
  return diffLines
    .filter((l, i) => {
      const status = lineStatuses[i];
      if (l.type === 'added') return status === 'accepted';
      if (l.type === 'deleted') return status === 'rejected';
      return true;
    })
    .map(l => l.content)
    .join('\n');
}

export function isEasyEditTransaction(transaction: Transaction): boolean {
  return transaction.annotation(easyEditTransaction) === true;
}
