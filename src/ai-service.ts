import { ChatMessage, SSEChunk } from './types';

interface ModelListResponse {
  data: Array<{ id: string }>;
}

/**
 * Build the chat completions URL smartly:
 * - If endpoint already contains "/chat/completions", use as-is
 * - Otherwise append "/v1/chat/completions"
 * This supports: OpenAI, Google Gemini OpenAI-compat, OpenRouter, etc.
 */
function buildChatUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  if (base.includes('/chat/completions')) return base;
  return `${base}/v1/chat/completions`;
}

function buildModelsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  if (base.includes('/models')) return base;
  if (base.includes('/openai')) return `${base}/v1/models`;
  return `${base}/v1/models`;
}

export async function fetchModelList(
  endpoint: string,
  apiKey: string,
): Promise<string[]> {
  const url = buildModelsUrl(endpoint);
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('Invalid API key');
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data: ModelListResponse = await response.json();
  return data.data.map(m => m.id).sort();
}

export async function* streamChat(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const url = buildChatUrl(endpoint);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('Invalid API key');
    if (response.status === 429) throw new Error('Rate limit exceeded');
    if (response.status >= 500) throw new Error(`Server error: ${response.status}`);
    throw new Error(`API ${response.status}: ${body.slice(0, 200)}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const chunk: SSEChunk = JSON.parse(trimmed.slice(6));
          const content = chunk.choices[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function buildEditMessages(
  instruction: string,
  selectedText: string,
  contextBefore: string,
  contextAfter: string
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'You are a writing assistant. Edit the selected text according to the instruction. Output ONLY the edited text, no explanations.',
    },
    {
      role: 'user',
      content: `Context before:\n${contextBefore}\n\nSelected text:\n${selectedText}\n\nContext after:\n${contextAfter}\n\nInstruction: ${instruction}`,
    },
  ];
}

export function buildGenerateMessages(
  instruction: string,
  contextBefore: string,
  contextAfter: string
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: 'You are a writing assistant. Generate text according to the instruction. Output ONLY the generated text, no explanations.',
    },
    {
      role: 'user',
      content: `Context before:\n${contextBefore}\n\nContext after:\n${contextAfter}\n\nInstruction: ${instruction}`,
    },
  ];
}

export function buildPolishMessages(
  text: string,
  polishPrompt: string
): ChatMessage[] {
  return [
    { role: 'system', content: polishPrompt },
    { role: 'user', content: text },
  ];
}
