import { App, PluginSettingTab, Setting } from 'obsidian';
import type EasyEditPlugin from '../main';

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
      .setDesc('One model per line')
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
