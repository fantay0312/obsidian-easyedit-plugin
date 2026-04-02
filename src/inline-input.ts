import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, Tooltip, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Notice } from 'obsidian';
import type EasyEditPlugin from '../main';
import { streamChat, buildEditMessages, buildGenerateMessages, buildPolishMessages } from './ai-service';
import {
  diffStateField, startStreamingEffect, appendStreamChunkEffect,
  applyDiffEffect, clearDiffEffect, diffAction,
  computeLineDiff, easyEditTransaction, getMergedText,
  hasActionableDiff, isEasyEditTransaction,
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
let activeAbortController: AbortController | null = null;
let activeEditorView: EditorView | null = null;

function dispatchEasyEdit(
  view: EditorView,
  spec: Parameters<EditorView['dispatch']>[0],
): void {
  view.dispatch({
    ...spec,
    annotations: easyEditTransaction.of(true),
  });
}

export function cancelActiveAIRequest(): void {
  if (!activeAbortController) return;
  activeAbortController.abort();
  activeAbortController = null;
}

function cancelActiveAIRequestFromView(view: EditorView): boolean {
  if (!activeAbortController) return false;
  if (activeEditorView && activeEditorView !== view) return false;

  cancelActiveAIRequest();
  new Notice('EasyEdit: request cancelled.');
  return true;
}

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

    cancelActiveAIRequest();
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
          create: (view: EditorView) => {
            const result = createInlineInputDOM(view, data);
            setTimeout(() => result.dom.parentElement?.classList.add('easyedit-glass-tooltip'), 0);
            return result;
          },
        };
      }
      if (e.is(hideInlineInputEffect)) return null;
      if (e.is(startStreamingEffect)) return null;
    }
    return tooltip;
  },
  provide: f => showTooltip.from(f),
});

const activeRequestEscapeHandler = EditorView.domEventHandlers({
  keydown(event, view) {
    if (event.key !== 'Escape') return false;
    if (!cancelActiveAIRequestFromView(view)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  },
});

const externalEditGuard = ViewPlugin.fromClass(class {
  update(update: ViewUpdate): void {
    if (!update.docChanged) return;

    const previousDiffState = update.startState.field(diffStateField);
    if (!previousDiffState.active && !previousDiffState.streaming) return;

    const hasExternalChange = update.transactions.some(transaction => {
      return transaction.docChanged && !isEasyEditTransaction(transaction);
    });
    if (!hasExternalChange) return;

    cancelActiveAIRequest();

    // Must defer dispatch — CM6 forbids dispatch inside ViewPlugin.update()
    setTimeout(() => {
      const currentDiffState = update.view.state.field(diffStateField);
      if (currentDiffState.active || currentDiffState.streaming) {
        update.view.dispatch({
          annotations: [easyEditTransaction.of(true), diffAction.of({ type: 'clear' })],
        });
      }
      new Notice('EasyEdit: stopped due to external edit.');
    }, 0);
  }
});

// ===== AI Flow =====
async function runAIRequest(
  view: EditorView,
  plugin: EasyEditPlugin,
  messages: ReturnType<typeof buildEditMessages>,
  originalText: string,
  from: number,
  to: number,
  _replaceSelection: boolean,
  abortController: AbortController,
): Promise<void> {
  activeAbortController = abortController;
  activeEditorView = view;

  // Start streaming -- NO document changes, original text stays visible
  // The streaming state triggers loading decorations on the selected range
  dispatchEasyEdit(view, {
    effects: startStreamingEffect.of({ from, to, originalText }),
  });

  try {
    // Keep a live preview in decorations while buffering the final text for diffing
    let fullText = '';
    for await (const chunk of streamChat(
      plugin.settings.apiEndpoint,
      plugin.settings.apiKey,
      plugin.settings.lastUsedModel || plugin.settings.defaultModel || 'gpt-4o',
      messages,
      abortController.signal,
    )) {
      const currentState = view.state.field(diffStateField);
      if (!currentState.streaming) return;

      fullText += chunk;
      dispatchEasyEdit(view, {
        effects: appendStreamChunkEffect.of(chunk),
      });
    }

    // Streaming finished -- check state is still valid
    const streamingState = view.state.field(diffStateField);
    if (!streamingState.streaming) return;

    // Compute diff between original and AI response
    const diff = computeLineDiff(originalText, fullText);
    if (!hasActionableDiff(diff)) {
      // No meaningful changes -- just clear the loading state
      view.dispatch({
        annotations: [easyEditTransaction.of(true), diffAction.of({ type: 'clear' })],
      });
      return;
    }

    // Replace original text with merged diff text in one dispatch
    const mergedText = getMergedText(diff);
    const currentState = view.state.field(diffStateField);

    dispatchEasyEdit(view, {
      effects: applyDiffEffect.of({
        lines: diff,
        originalText,
        newText: fullText,
      }),
      changes: {
        from: currentState.fromPos,
        to: currentState.toPos,
        insert: mergedText,
      },
    });
  } catch (err: unknown) {
    // On error, just clear the state -- original text is still in the document
    const currentState = view.state.field(diffStateField);
    if (currentState.active || currentState.streaming) {
      view.dispatch({
        annotations: [easyEditTransaction.of(true), diffAction.of({ type: 'clear' })],
      });
    }

    if (err instanceof Error && err.name !== 'AbortError') {
      new Notice(`AI Error: ${err.message}`);
    }
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null;
    }
    if (activeEditorView === view) {
      activeEditorView = null;
    }
  }
}

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

  plugin.settings.lastUsedModel = model;
  await runAIRequest(
    view,
    plugin,
    messages,
    selectedText,
    selFrom,
    selTo,
    mode === 'edit',
    abortController,
  );
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

  cancelActiveAIRequest();
  const abortController = new AbortController();
  plugin.settings.lastUsedModel = model;
  await runAIRequest(
    view,
    plugin,
    messages,
    selectedText,
    sel.from,
    sel.to,
    true,
    abortController,
  );
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
  return [inlineInputField, externalEditGuard, activeRequestEscapeHandler];
}
