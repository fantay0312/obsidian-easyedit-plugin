import { EditorView } from '@codemirror/view';

function toggleInlineMarker(view: EditorView, marker: string): void {
  const sel = view.state.selection.main;
  if (sel.empty) return;

  const from = sel.from;
  const to = sel.to;
  const text = view.state.sliceDoc(from, to);
  const len = marker.length;

  if (text.startsWith(marker) && text.endsWith(marker) && text.length >= len * 2) {
    view.dispatch({
      changes: { from, to, insert: text.slice(len, -len) },
      selection: { anchor: from, head: to - len * 2 },
    });
    return;
  }

  const outerFrom = Math.max(0, from - len);
  const outerTo = Math.min(view.state.doc.length, to + len);
  const before = view.state.sliceDoc(outerFrom, from);
  const after = view.state.sliceDoc(to, outerTo);

  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: outerFrom, to: from, insert: '' },
        { from: to, to: outerTo, insert: '' },
      ],
      selection: { anchor: outerFrom, head: outerFrom + (to - from) },
    });
    return;
  }

  view.dispatch({
    changes: { from, to, insert: marker + text + marker },
    selection: { anchor: from, head: to + len * 2 },
  });
}

export function toggleBold(view: EditorView): void {
  toggleInlineMarker(view, '**');
}

export function toggleItalic(view: EditorView): void {
  toggleInlineMarker(view, '*');
}

export function toggleHighlight(view: EditorView): void {
  toggleInlineMarker(view, '==');
}

export function toggleInlineCode(view: EditorView): void {
  toggleInlineMarker(view, '`');
}

export function toggleInternalLink(view: EditorView): void {
  const sel = view.state.selection.main;
  if (sel.empty) return;

  const from = sel.from;
  const to = sel.to;
  const text = view.state.sliceDoc(from, to);

  if (text.startsWith('[[') && text.endsWith(']]') && text.length >= 4) {
    view.dispatch({
      changes: { from, to, insert: text.slice(2, -2) },
      selection: { anchor: from, head: to - 4 },
    });
    return;
  }

  const outerFrom = Math.max(0, from - 2);
  const outerTo = Math.min(view.state.doc.length, to + 2);
  const before = view.state.sliceDoc(outerFrom, from);
  const after = view.state.sliceDoc(to, outerTo);

  if (before === '[[' && after === ']]') {
    view.dispatch({
      changes: [
        { from: outerFrom, to: from, insert: '' },
        { from: to, to: outerTo, insert: '' },
      ],
      selection: { anchor: outerFrom, head: outerFrom + (to - from) },
    });
    return;
  }

  view.dispatch({
    changes: { from, to, insert: '[[' + text + ']]' },
    selection: { anchor: from, head: to + 4 },
  });
}

export function toggleInlineMath(view: EditorView): void {
  toggleInlineMarker(view, '$');
}

function toggleBlockMarker(view: EditorView, marker: string): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const startLine = doc.lineAt(sel.from);
  const endLine = doc.lineAt(sel.to);

  const lineAbove = startLine.number > 1 ? doc.line(startLine.number - 1) : null;
  const lineBelow = endLine.number < doc.lines ? doc.line(endLine.number + 1) : null;

  if (lineAbove?.text.trim() === marker && lineBelow?.text.trim() === marker) {
    view.dispatch({
      changes: [
        { from: lineAbove.from, to: startLine.from, insert: '' },
        { from: endLine.to, to: lineBelow.to + (lineBelow.number < doc.lines ? 1 : 0), insert: '' },
      ],
    });
    return;
  }

  view.dispatch({
    changes: [
      { from: startLine.from, to: startLine.from, insert: marker + '\n' },
      { from: endLine.to, to: endLine.to, insert: '\n' + marker },
    ],
  });
}

export function toggleCodeBlock(view: EditorView): void {
  toggleBlockMarker(view, '```');
}

export function toggleMathBlock(view: EditorView): void {
  toggleBlockMarker(view, '$$');
}

export function toggleQuote(view: EditorView): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const startLine = doc.lineAt(sel.from);
  const endLine = doc.lineAt(sel.to);

  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let allQuoted = true;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    if (!line.text.startsWith('> ')) {
      allQuoted = false;
      break;
    }
  }

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    if (allQuoted) {
      changes.push({ from: line.from, to: line.from + 2, insert: '' });
    } else {
      changes.push({ from: line.from, to: line.from, insert: '> ' });
    }
  }

  view.dispatch({ changes });
}

export function cycleHeading(view: EditorView): void {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const match = line.text.match(/^(#{1,3})\s/);

  if (!match) {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: '# ' },
    });
    return;
  }

  const level = match[1].length;
  const prefixEnd = line.from + match[0].length;

  if (level < 3) {
    view.dispatch({
      changes: { from: line.from, to: prefixEnd, insert: '#'.repeat(level + 1) + ' ' },
    });
  } else {
    view.dispatch({
      changes: { from: line.from, to: prefixEnd, insert: '' },
    });
  }
}

export function insertTable(view: EditorView): void {
  const sel = view.state.selection.main;

  if (!sel.empty) {
    const text = view.state.sliceDoc(sel.from, sel.to);
    const rows = text.split('\n').filter(Boolean);

    let separator = '\t';
    if (rows[0]?.includes('\t')) separator = '\t';
    else if (rows[0]?.includes('|')) separator = '|';
    else if (rows[0]?.includes(',')) separator = ',';

    const data = rows.map(row => row.split(separator).map(c => c.trim()));
    const cols = Math.max(...data.map(r => r.length));

    const lines: string[] = [];
    data.forEach((row, idx) => {
      const padded = Array.from({ length: cols }, (_, i) => row[i] ?? '');
      lines.push('| ' + padded.join(' | ') + ' |');
      if (idx === 0) {
        lines.push('| ' + padded.map(() => '--------').join(' | ') + ' |');
      }
    });

    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: lines.join('\n') } });
    return;
  }

  const template =
    '| Column 1 | Column 2 | Column 3 |\n' +
    '| -------- | -------- | -------- |\n' +
    '|          |          |          |';

  view.dispatch({
    changes: { from: sel.head, to: sel.head, insert: template },
  });
}

