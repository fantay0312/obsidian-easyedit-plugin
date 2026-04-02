import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type EasyEditPlugin from '../main';
import { fetchModelList } from './ai-service';

// ===== Model Selection Modal =====
class ModelSelectionModal extends Modal {
  private allModels: string[];
  private selected: Set<string>;
  private onConfirm: (selected: string[]) => void;
  private listEl: HTMLElement | null = null;
  private searchQuery = '';
  private countEl: HTMLElement | null = null;

  constructor(
    app: App,
    allModels: string[],
    currentModels: string[],
    onConfirm: (selected: string[]) => void,
  ) {
    super(app);
    this.allModels = allModels;
    this.selected = new Set(currentModels);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('easyedit-model-modal');
    this.modalEl.addClass('easyedit-glass-modal');

    // Header
    const header = contentEl.createDiv('easyedit-modal-header');
    const titleRow = header.createDiv('easyedit-modal-title-row');
    titleRow.createEl('h3', { text: 'Select Models' });
    this.countEl = titleRow.createSpan({ cls: 'easyedit-modal-count' });
    this.updateCount();

    const searchInput = header.createEl('input', {
      type: 'text',
      placeholder: 'Search models...',
      cls: 'easyedit-modal-search',
    });
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderList();
    });

    // List
    this.listEl = contentEl.createDiv('easyedit-modal-list');
    this.renderList();

    // Footer
    const footer = contentEl.createDiv('easyedit-modal-footer');

    const confirmBtn = footer.createEl('button', {
      text: 'Confirm',
      cls: 'mod-cta',
    });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm(Array.from(this.selected).sort());
      this.close();
    });

    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const spacer = footer.createDiv('easyedit-modal-spacer');
    spacer.style.flex = '1';

    const selectAllBtn = footer.createEl('button', { text: 'Select All' });
    selectAllBtn.addEventListener('click', () => {
      const filtered = this.getFilteredModels();
      for (const m of filtered) this.selected.add(m);
      this.updateCount();
      this.renderList();
    });

    const deselectAllBtn = footer.createEl('button', { text: 'Deselect All' });
    deselectAllBtn.addEventListener('click', () => {
      const filtered = this.getFilteredModels();
      for (const m of filtered) this.selected.delete(m);
      this.updateCount();
      this.renderList();
    });
  }

  private getFilteredModels(): string[] {
    if (!this.searchQuery) return this.allModels;
    return this.allModels.filter(m => m.toLowerCase().includes(this.searchQuery));
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const filtered = this.getFilteredModels();
    for (const model of filtered) {
      const row = this.listEl.createDiv('easyedit-modal-row');
      const label = row.createEl('label', { cls: 'easyedit-modal-label' });

      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.selected.has(model);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selected.add(model);
        } else {
          this.selected.delete(model);
        }
        this.updateCount();
      });

      label.createSpan({ text: model, cls: 'easyedit-modal-model-name' });

      if (this.selected.has(model)) {
        row.createSpan({ text: 'selected', cls: 'easyedit-modal-badge' });
      }
    }

    if (filtered.length === 0) {
      this.listEl.createDiv({
        text: 'No models found',
        cls: 'easyedit-modal-empty',
      });
    }
  }

  private updateCount(): void {
    if (this.countEl) {
      this.countEl.textContent = `${this.selected.size} selected`;
    }
  }

  onClose(): void {
    this.modalEl.removeClass('easyedit-glass-modal');
    this.contentEl.empty();
  }
}

// ===== Settings Tab =====
export class EasyEditSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EasyEditPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('easyedit-settings');

    // --- API Endpoint ---
    new Setting(containerEl)
      .setName('API Endpoint')
      .setDesc('OpenAI-compatible API endpoint')
      .addText(text => text
        .setPlaceholder('https://api.openai.com')
        .setValue(this.plugin.settings.apiEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.apiEndpoint = value.trim();
          await this.plugin.saveSettings();
        }));

    // --- API Key ---
    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your API key')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder('sk-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    // --- Default Model (dropdown) ---
    new Setting(containerEl)
      .setName('Default Model')
      .setDesc('Select from fetched models')
      .addDropdown(dropdown => {
        const models = this.plugin.settings.customModels;
        if (models.length === 0) {
          dropdown.addOption('', '(fetch models first)');
        } else {
          for (const m of models) {
            dropdown.addOption(m, m);
          }
        }
        dropdown.setValue(this.plugin.settings.defaultModel);
        dropdown.onChange(async (value) => {
          this.plugin.settings.defaultModel = value;
          await this.plugin.saveSettings();
        });
      });

    // --- Fetch & Select Models ---
    const modelsSetting = new Setting(containerEl)
      .setName('Models')
      .setDesc(this.getModelsDesc());

    modelsSetting.addButton(btn => btn
      .setButtonText('Fetch & Select')
      .onClick(async () => {
        const { apiEndpoint, apiKey } = this.plugin.settings;
        if (!apiEndpoint || !apiKey) {
          new Notice('Set API Endpoint and API Key first');
          return;
        }
        try {
          btn.setButtonText('Fetching...');
          btn.setDisabled(true);
          const allModels = await fetchModelList(apiEndpoint, apiKey);
          new ModelSelectionModal(
            this.app,
            allModels,
            this.plugin.settings.customModels,
            async (selected) => {
              this.plugin.settings.customModels = selected;
              if (!selected.includes(this.plugin.settings.defaultModel) && selected.length > 0) {
                this.plugin.settings.defaultModel = selected[0];
              }
              await this.plugin.saveSettings();
              this.display();
            },
          ).open();
          btn.setButtonText('Fetch & Select');
          btn.setDisabled(false);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          new Notice(`Fetch failed: ${msg}`);
          btn.setButtonText('Fetch & Select');
          btn.setDisabled(false);
        }
      }));

    // --- AI Polish Prompt ---
    new Setting(containerEl)
      .setName('AI Polish Prompt')
      .setDesc('System prompt for AI polishing')
      .addTextArea(text => text
        .setValue(this.plugin.settings.polishPrompt)
        .onChange(async (value) => {
          this.plugin.settings.polishPrompt = value;
          await this.plugin.saveSettings();
        }));

    // --- Context Before ---
    new Setting(containerEl)
      .setName('Context Before')
      .setDesc('Characters before cursor for context')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.plugin.settings.contextBefore))
          .onChange(async (value) => {
            this.plugin.settings.contextBefore = parseInt(value) || 3000;
            await this.plugin.saveSettings();
          });
      });

    // --- Context After ---
    new Setting(containerEl)
      .setName('Context After')
      .setDesc('Characters after cursor for context')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.plugin.settings.contextAfter))
          .onChange(async (value) => {
            this.plugin.settings.contextAfter = parseInt(value) || 1000;
            await this.plugin.saveSettings();
          });
      });

    // --- Hotkey hint ---
    new Setting(containerEl)
      .setName('Inline AI Edit Hotkey')
      .setDesc('Default: Mod+Shift+K. Change in Settings → Hotkeys → search "EasyEdit"');
  }

  private getModelsDesc(): string {
    const count = this.plugin.settings.customModels.length;
    if (count === 0) return 'No models selected. Click "Fetch & Select" to load.';
    const preview = this.plugin.settings.customModels.slice(0, 3).join(', ');
    const more = count > 3 ? ` and ${count - 3} more` : '';
    return `${count} models selected: ${preview}${more}`;
  }
}
