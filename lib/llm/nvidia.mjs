// NVIDIA NIM API Provider — OpenAI Compatible
import { LLMProvider } from './provider.mjs';

export class NvidiaProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'nvidia';
    this.apiKey = config.apiKey;
    this.model = config.model || 'minimaxai/minimax-m2.7';
    this.baseUrl = config.baseUrl || 'https://integrate.api.nvidia.com/v1';
  }

  get isConfigured() { return !!this.apiKey; }

  async complete(systemPrompt, userMessage, opts = {}) {
    let res;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: opts.maxTokens || 1200,
          temperature: opts.temperature || 1.0,
          top_p: opts.topP || 0.95,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
        signal: AbortSignal.timeout(opts.timeout || 60000),
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new Error('NVIDIA API 请求超时');
      }
      throw e;
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('NVIDIA API Key 无效或无权限');
      }
      if (res.status === 429) {
        throw new Error('NVIDIA API 当前限流');
      }
      const err = await res.text().catch(() => '');
      throw new Error(`NVIDIA API ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
    };
  }
}
