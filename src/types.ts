// ===== Settings =====
export interface EasyEditSettings {
  apiEndpoint: string;
  apiKey: string;
  defaultModel: string;
  customModels: string[];
  polishPrompt: string;
  contextBefore: number;
  contextAfter: number;
  lastUsedModel: string;
}

export const DEFAULT_SETTINGS: EasyEditSettings = {
  apiEndpoint: '',
  apiKey: '',
  defaultModel: '',
  customModels: [],
  polishPrompt: '请润色以下文本，保持原意，提升表达流畅度和专业性',
  contextBefore: 3000,
  contextAfter: 1000,
  lastUsedModel: '',
};

// ===== AI API =====
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SSEChunk {
  choices: Array<{
    delta: { content?: string };
    finish_reason: string | null;
  }>;
}

// ===== Diff =====
export type DiffLineType = 'added' | 'deleted' | 'unchanged';

export interface DiffLine {
  type: DiffLineType;
  content: string;
}

export interface DiffResult {
  lines: DiffLine[];
  originalText: string;
  newText: string;
}

// ===== Toolbar =====
export interface ToolbarButtonDef {
  id: string;
  label: string;
  icon: string;
  category: 'format' | 'ai';
}

export const TOOLBAR_BUTTONS: ToolbarButtonDef[] = [
  { id: 'bold', label: '加粗', icon: 'B', category: 'format' },
  { id: 'italic', label: '斜体', icon: 'I', category: 'format' },
  { id: 'highlight', label: '高亮', icon: 'H', category: 'format' },
  { id: 'inline-code', label: '行内代码', icon: '<>', category: 'format' },
  { id: 'code-block', label: '代码块', icon: '{}', category: 'format' },
  { id: 'quote', label: '引用', icon: '""', category: 'format' },
  { id: 'heading', label: '标题循环', icon: 'H↻', category: 'format' },
  { id: 'table', label: '表格', icon: '⊞', category: 'format' },
  { id: 'internal-link', label: '内链', icon: '[[]]', category: 'format' },
  { id: 'inline-math', label: '行内公式', icon: '$', category: 'format' },
  { id: 'math-block', label: '公式块', icon: '$$', category: 'format' },
  { id: 'ai-edit', label: 'AI 编辑', icon: '✨', category: 'ai' },
  { id: 'ai-polish', label: 'AI 润色', icon: '✦', category: 'ai' },
];
