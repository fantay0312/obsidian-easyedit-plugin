import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type EasyEditPlugin from '../main';
import { fetchModelList } from './ai-service';

export class EasyEditSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: EasyEditPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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

    new Setting(containerEl)
      .setName('Default Model')
      .setDesc('Default model name')
      .addText(text => text
        .setPlaceholder('gpt-4o')
        .setValue(this.plugin.settings.defaultModel)
        .onChange(async (value) => {
          this.plugin.settings.defaultModel = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Custom Models')
      .setDesc('One model per line, or auto-fetch from API')
      .addButton(btn => btn
        .setButtonText('Fetch Models')
        .onClick(async () => {
          const { apiEndpoint, apiKey } = this.plugin.settings;
          if (!apiEndpoint || !apiKey) {
            new Notice('Please set API Endpoint and API Key first');
            return;
          }
          try {
            btn.setButtonText('Fetching...');
            btn.setDisabled(true);
            const models = await fetchModelList(apiEndpoint, apiKey);
            this.plugin.settings.customModels = models;
            if (!this.plugin.settings.defaultModel && models.length > 0) {
              this.plugin.settings.defaultModel = models[0];
            }
            await this.plugin.saveSettings();
            new Notice(`Fetched ${models.length} models`);
            this.display();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            new Notice(`Fetch failed: ${msg}`);
            btn.setButtonText('Fetch Models');
            btn.setDisabled(false);
          }
        }))
      .addTextArea(text => text
        .setPlaceholder('gpt-4o\nclaude-3-opus\n...')
        .setValue(this.plugin.settings.customModels.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.customModels = value.split('\n').map(s => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('AI Polish Prompt')
      .setDesc('System prompt for AI polishing')
      .addTextArea(text => text
        .setValue(this.plugin.settings.polishPrompt)
        .onChange(async (value) => {
          this.plugin.settings.polishPrompt = value;
          await this.plugin.saveSettings();
        }));

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
  }
}
