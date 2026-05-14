function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

export async function createCloudflareLLMProvider(env = {}) {
  if (!boolEnv(env.ENABLE_LLM, false)) return null;

  const provider = (env.LLM_PROVIDER || '').toLowerCase();
  const apiKey = env.LLM_API_KEY || null;
  const model = env.LLM_MODEL || null;
  if (!provider) return null;

  switch (provider) {
    case 'anthropic': {
      const { AnthropicProvider } = await import('../lib/llm/anthropic.mjs');
      return new AnthropicProvider({ apiKey, model });
    }
    case 'openai': {
      const { OpenAIProvider } = await import('../lib/llm/openai.mjs');
      return new OpenAIProvider({ apiKey, model });
    }
    case 'openrouter': {
      const { OpenRouterProvider } = await import('../lib/llm/openrouter.mjs');
      return new OpenRouterProvider({ apiKey, model });
    }
    case 'gemini': {
      const { GeminiProvider } = await import('../lib/llm/gemini.mjs');
      return new GeminiProvider({ apiKey, model });
    }
    case 'minimax': {
      const { MiniMaxProvider } = await import('../lib/llm/minimax.mjs');
      return new MiniMaxProvider({ apiKey, model });
    }
    case 'mistral': {
      const { MistralProvider } = await import('../lib/llm/mistral.mjs');
      return new MistralProvider({ apiKey, model });
    }
    case 'grok': {
      const { GrokProvider } = await import('../lib/llm/grok.mjs');
      return new GrokProvider({ apiKey, model });
    }
    default:
      console.warn(`[Cloudflare LLM] ${provider} 在 Worker 模式下不可用，已自动关闭。`);
      return null;
  }
}

