import { StateField, StateEffect, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, showTooltip, Tooltip } from '@codemirror/view';
import { TOOLBAR_BUTTONS } from './types';
import {
  toggleBold, toggleItalic, toggleHighlight, toggleInlineCode,
  toggleCodeBlock, toggleQuote, cycleHeading, insertTable,
  toggleInternalLink, toggleInlineMath, toggleMathBlock,
} from './formatting';
import type EasyEditPlugin from '../main';

export const showToolbarEffect = StateEffect.define<{ pos: number }>();
export const hideToolbarEffect = StateEffect.define<void>();

type ToolbarContext = {
  plugin: EasyEditPlugin;
  onAIEdit: (view: EditorView) => void;
  onAIPolish: (view: EditorView) => void;
  isDiffActive: (view: EditorView) => boolean;
};

let toolbarCtx: ToolbarContext | null = null;

const FORMAT_HANDLERS: Record<string, (view: EditorView) => void> = {
  'bold': toggleBold,
  'italic': toggleItalic,
  'highlight': toggleHighlight,
  'inline-code': toggleInlineCode,
  'code-block': toggleCodeBlock,
  'quote': toggleQuote,
  'heading': cycleHeading,
  'table': insertTable,
  'internal-link': toggleInternalLink,
  'inline-math': toggleInlineMath,
  'math-block': toggleMathBlock,
};

function createToolbarDOM(view: EditorView): { dom: HTMLElement } {
  const container = document.createElement('div');
  container.className = 'easyedit-toolbar';

  for (const btn of TOOLBAR_BUTTONS) {
    if (btn.category === 'ai' && TOOLBAR_BUTTONS.indexOf(btn) ===
        TOOLBAR_BUTTONS.findIndex(b => b.category === 'ai')) {
      const sep = document.createElement('div');
      sep.className = 'easyedit-toolbar-sep';
      container.appendChild(sep);
    }

    const button = document.createElement('button');
    button.className = 'easyedit-toolbar-btn';
    button.textContent = btn.icon;
    button.title = btn.label;

    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (btn.category === 'format') {
        const handler = FORMAT_HANDLERS[btn.id];
        if (handler) handler(view);
      } else if (btn.id === 'ai-edit' && toolbarCtx) {
        view.dispatch({ effects: hideToolbarEffect.of(undefined) });
        toolbarCtx.onAIEdit(view);
      } else if (btn.id === 'ai-polish' && toolbarCtx) {
        view.dispatch({ effects: hideToolbarEffect.of(undefined) });
        toolbarCtx.onAIPolish(view);
      }
    });

    container.appendChild(button);
  }

  return { dom: container };
}

const toolbarField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, tr) {
    for (const e of tr.effects) {
      if (e.is(hideToolbarEffect)) return null;
      if (e.is(showToolbarEffect)) {
        return {
          pos: e.value.pos,
          above: false,
          strictSide: false,
          arrow: false,
          create: (view: EditorView) => {
            const result = createToolbarDOM(view);
            setTimeout(() => result.dom.parentElement?.classList.add('easyedit-glass-tooltip'), 0);
            return result;
          },
        };
      }
    }

    if (tr.selection && tr.state.selection.main.empty) return null;
    if (tr.docChanged && tooltip) return null;

    return tooltip;
  },
  provide: f => showTooltip.from(f),
});

const toolbarDebounce = ViewPlugin.fromClass(class {
  private timeout: ReturnType<typeof setTimeout> | null = null;

  update(update: ViewUpdate): void {
    if (!update.selectionSet) return;
    if (this.timeout) clearTimeout(this.timeout);

    const sel = update.state.selection.main;
    if (sel.empty) return; // StateField handles hiding via tr.selection check

    this.timeout = setTimeout(() => {
      const currentSel = update.view.state.selection.main;
      if (currentSel.empty) return;
      if (toolbarCtx?.isDiffActive(update.view)) return;
      update.view.dispatch({
        effects: showToolbarEffect.of({ pos: Math.min(currentSel.anchor, currentSel.head) }),
      });
    }, 100);
  }

  destroy(): void {
    if (this.timeout) clearTimeout(this.timeout);
  }
});

export function selectionToolbar(
  plugin: EasyEditPlugin,
  onAIEdit: (view: EditorView) => void,
  onAIPolish: (view: EditorView) => void,
  isDiffActive: (view: EditorView) => boolean,
): Extension[] {
  toolbarCtx = { plugin, onAIEdit, onAIPolish, isDiffActive };
  return [toolbarField, toolbarDebounce];
}
