import { ChatMessage, SSEChunk } from './types';

export async function* streamChat(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const url = `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
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
    if (response.status === 401) throw new Error('Invalid API key');
    if (response.status === 429) throw new Error('Rate limit exceeded');
    if (response.status >= 500) throw new Error('Server error');
    throw new Error(`API error: ${response.status}`);
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
