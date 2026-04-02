import { StateField, StateEffect, Extension } from '@codemirror/state';
import { EditorView, showTooltip, Tooltip } from '@codemirror/view';
import { Notice } from 'obsidian';
import type EasyEditPlugin from '../main';
import { streamChat, buildEditMessages, buildGenerateMessages, buildPolishMessages } from './ai-service';
import {
  diffStateField, startStreamingEffect, appendStreamChunkEffect,
  finishStreamingEffect, applyDiffEffect, clearDiffEffect,
  computeLineDiff, getMergedText,
} from './diff-state';

// ===== Effects =====
export const showInlineInputEffect = StateEffect.define<{
  pos: number;
  mode: 'edit' | 'generate';
  selectedText: string;
  selFrom: number;
  selTo: number;
  contextBefore: string;
  contextAfter: string;
}>();
export const hideInlineInputEffect = StateEffect.define<void>();

// ===== Shared context =====
let pluginRef: EasyEditPlugin | null = null;

function createInlineInputDOM(
  view: EditorView,
  data: {
    mode: 'edit' | 'generate';
    selectedText: string;
    selFrom: number;
    selTo: number;
    contextBefore: string;
    contextAfter: string;
  }
): { dom: HTMLElement } {
  const plugin = pluginRef!;
  const container = document.createElement('div');
  container.className = 'easyedit-inline-input';

  // Header
  const header = document.createElement('div');
  header.className = 'easyedit-input-header';

  const title = document.createElement('span');
  title.textContent = data.mode === 'edit' ? 'AI Edit' : 'AI Generate';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'easyedit-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    view.dispatch({ effects: hideInlineInputEffect.of(undefined) });
    view.focus();
  });
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'easyedit-input-text';
  textarea.placeholder = data.mode === 'edit'
    ? 'Describe your edit...'
    : 'Describe what to generate...';
  container.appendChild(textarea);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'easyedit-input-footer';

  const select = document.createElement('select');
  select.className = 'easyedit-model-select';

  const models = [
    plugin.settings.defaultModel,
    ...plugin.settings.customModels,
  ].filter(Boolean);

  if (models.length === 0) models.push('gpt-4o');

  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === plugin.settings.lastUsedModel) opt.selected = true;
    select.appendChild(opt);
  }
  footer.appendChild(select);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'easyedit-send-btn';
  sendBtn.textContent = 'Send';
  footer.appendChild(sendBtn);
  container.appendChild(footer);

  // Send handler
  const doSend = (): void => {
    const instruction = textarea.value.trim();
    if (!instruction) return;

    const model = select.value;
    plugin.settings.lastUsedModel = model;
    plugin.saveSettings();

    view.dispatch({ effects: hideInlineInputEffect.of(undefined) });
    view.focus();

    const abortController = new AbortController();
    startAIFlow(
      view, plugin, data.mode, instruction, model,
      data.selectedText, data.selFrom, data.selTo,
      data.contextBefore, data.contextAfter,
      abortController,
    );
  };

  sendBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    doSend();
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      view.dispatch({ effects: hideInlineInputEffect.of(undefined) });
      view.focus();
    }
  });

  // Autofocus
  setTimeout(() => textarea.focus(), 0);

  return { dom: container };
}

// ===== StateField =====
const inlineInputField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, tr) {
    for (const e of tr.effects) {
      if (e.is(showInlineInputEffect)) {
        const data = e.value;
        return {
          pos: data.pos,
          above: false,
          create: (view: EditorView) => createInlineInputDOM(view, data),
        };
      }
      if (e.is(hideInlineInputEffect)) return null;
      if (e.is(startStreamingEffect)) return null;
    }
    return tooltip;
  },
  provide: f => showTooltip.from(f),
});

// ===== AI Flow =====
async function startAIFlow(
  view: EditorView,
  plugin: EasyEditPlugin,
  mode: 'edit' | 'generate',
  instruction: string,
  model: string,
  selectedText: string,
  selFrom: number,
  selTo: number,
  contextBefore: string,
  contextAfter: string,
  abortController: AbortController,
): Promise<void> {
  const messages = mode === 'edit'
    ? buildEditMessages(instruction, selectedText, contextBefore, contextAfter)
    : buildGenerateMessages(instruction, contextBefore, contextAfter);

  const from = selFrom;
  const to = mode === 'edit' ? selTo : selTo;

  view.dispatch({
    effects: startStreamingEffect.of({ from, to, originalText: selectedText }),
    changes: mode === 'edit' ? { from, to, insert: '' } : undefined,
  });

  try {
    let fullText = '';
    for await (const chunk of streamChat(
      plugin.settings.apiEndpoint,
      plugin.settings.apiKey,
      model,
      messages,
      abortController.signal,
    )) {
      fullText += chunk;
      const currentState = view.state.field(diffStateField);
      view.dispatch({
        effects: appendStreamChunkEffect.of(chunk),
        changes: { from: currentState.toPos, insert: chunk },
      });
    }

    view.dispatch({ effects: finishStreamingEffect.of(undefined) });

    const diff = computeLineDiff(selectedText, fullText);
    const mergedText = getMergedText(diff);
    const currentState = view.state.field(diffStateField);

    view.dispatch({
      effects: applyDiffEffect.of({
        lines: diff,
        originalText: selectedText,
        newText: fullText,
      }),
      changes: {
        from: currentState.fromPos,
        to: currentState.toPos,
        insert: mergedText,
      },
    });
  } catch (err: unknown) {
    const currentState = view.state.field(diffStateField);
    view.dispatch({
      effects: clearDiffEffect.of(undefined),
      changes: {
        from: currentState.fromPos,
        to: currentState.toPos,
        insert: selectedText,
      },
    });

    if (err instanceof Error && err.name !== 'AbortError') {
      new Notice(`AI Error: ${err.message}`);
    }
  }
}

// ===== AI Polish (for toolbar button) =====
export async function startAIPolish(
  view: EditorView,
  plugin: EasyEditPlugin,
): Promise<void> {
  const sel = view.state.selection.main;
  if (sel.empty) return;

  const selectedText = view.state.sliceDoc(sel.from, sel.to);
  const messages = buildPolishMessages(selectedText, plugin.settings.polishPrompt);

  const models = [
    plugin.settings.lastUsedModel,
    plugin.settings.defaultModel,
    ...plugin.settings.customModels,
  ].filter(Boolean);
  const model = models[0] || 'gpt-4o';

  const abortController = new AbortController();

  view.dispatch({
    effects: startStreamingEffect.of({
      from: sel.from,
      to: sel.to,
      originalText: selectedText,
    }),
    changes: { from: sel.from, to: sel.to, insert: '' },
  });

  try {
    let fullText = '';
    for await (const chunk of streamChat(
      plugin.settings.apiEndpoint,
      plugin.settings.apiKey,
      model,
      messages,
      abortController.signal,
    )) {
      fullText += chunk;
      const currentState = view.state.field(diffStateField);
      view.dispatch({
        effects: appendStreamChunkEffect.of(chunk),
        changes: { from: currentState.toPos, insert: chunk },
      });
    }

    view.dispatch({ effects: finishStreamingEffect.of(undefined) });

    const diff = computeLineDiff(selectedText, fullText);
    const mergedText = getMergedText(diff);
    const currentState = view.state.field(diffStateField);

    view.dispatch({
      effects: applyDiffEffect.of({
        lines: diff,
        originalText: selectedText,
        newText: fullText,
      }),
      changes: {
        from: currentState.fromPos,
        to: currentState.toPos,
        insert: mergedText,
      },
    });
  } catch (err: unknown) {
    const currentState = view.state.field(diffStateField);
    view.dispatch({
      effects: clearDiffEffect.of(undefined),
      changes: {
        from: currentState.fromPos,
        to: currentState.toPos,
        insert: selectedText,
      },
    });

    if (err instanceof Error && err.name !== 'AbortError') {
      new Notice(`AI Error: ${err.message}`);
    }
  }
}

// ===== Trigger command =====
export function triggerInlineInput(view: EditorView, plugin: EasyEditPlugin): void {
  const sel = view.state.selection.main;
  const mode = sel.empty ? 'generate' : 'edit';
  const selectedText = view.state.sliceDoc(sel.from, sel.to);
  const docLen = view.state.doc.length;

  const contextBefore = view.state.sliceDoc(
    Math.max(0, sel.from - plugin.settings.contextBefore),
    sel.from,
  );
  const contextAfter = view.state.sliceDoc(
    sel.to,
    Math.min(docLen, sel.to + plugin.settings.contextAfter),
  );

  view.dispatch({
    effects: showInlineInputEffect.of({
      pos: sel.empty ? sel.head : Math.min(sel.anchor, sel.head),
      mode,
      selectedText,
      selFrom: sel.from,
      selTo: sel.to,
      contextBefore,
      contextAfter,
    }),
  });
}

// ===== Extension factory =====
export function inlineInputExtension(plugin: EasyEditPlugin): Extension[] {
  pluginRef = plugin;
  return [inlineInputField];
}
