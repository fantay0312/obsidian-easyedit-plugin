import { Plugin } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { EasyEditSettings, DEFAULT_SETTINGS } from './src/types';
import { EasyEditSettingTab } from './src/settings';
import { selectionToolbar } from './src/selection-toolbar';
import { inlineInputExtension, triggerInlineInput, startAIPolish } from './src/inline-input';
import { diffExtension, diffStateField } from './src/diff-state';

export default class EasyEditPlugin extends Plugin {
  settings: EasyEditSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new EasyEditSettingTab(this.app, this));

    this.addCommand({
      id: 'inline-ai-edit',
      name: 'Inline AI Edit',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'k' }],
      editorCallback: (editor) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editorView = (editor as any).cm as EditorView | undefined;
        if (editorView) triggerInlineInput(editorView, this);
      },
    });

    this.registerEditorExtension([
      ...selectionToolbar(
        this,
        (view) => triggerInlineInput(view, this),
        (view) => startAIPolish(view, this),
        (view) => view.state.field(diffStateField).active || view.state.field(diffStateField).streaming,
      ),
      ...inlineInputExtension(this),
      ...diffExtension(),
    ]);
  }

  onunload(): void {}

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
