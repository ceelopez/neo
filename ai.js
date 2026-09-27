// NEO — text AI (main process)
//
// Covers use art.js (brief + image). Everything else — placeholders,
// continuity, synopsis, rewrites — goes through chat() here.
//
// Any OpenAI-compatible endpoint works: OpenAI, xAI, OpenRouter, Together,
// or a local Ollama at http://localhost:11434/v1. A provider is just a
// base URL + key name + default model names. Model names drift, so chat()
// falls back down a candidate list and can query /models for what is live.

'use strict';

function isModelError(status, body) {
  const code = body && body.error && (body.error.code || body.error.type || body.error.status || '');
  const msg = (body && body.error && (body.error.message)) || '';
  return status === 404 || /model/i.test(String(code)) || /model|not (found|supported|exist|available)|no longer|deprecated|retired/i.test(msg);
}

async function post(url, headers, payload, timeoutMs = 120000) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`The model did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check that it is running, then try again.`);
    }
    throw err;
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (body && body.error && (body.error.message || body.error.msg)) || (body && body.message);
    const err = new Error(msg || ('The provider returned ' + res.status));
    err.status = res.status;
    err.modelProblem = isModelError(res.status, body);
    throw err;
  }
  return body;
}

async function withModels(preferred, defaults, fn) {
  const list = [...new Set([preferred, ...defaults].filter(Boolean))];
  let lastErr = null;
  for (const model of list) {
    try {
      return { model, result: await fn(model) };
    } catch (err) {
      lastErr = err;
      if (!err.modelProblem) throw err;
    }
  }
  throw lastErr || new Error('No model available');
}

// Cache of /models per base URL so the renderer can offer live names.
const catalogCache = new Map(); // base -> { at, text: [] }
// Local engines name models freely (gemma3:12b, phi4…), so the chat-name
// filter only applies to cloud catalogs.
function isLocalBase(u) {
  try {
    const host = new URL(String(u || '')).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
async function listTextModels(base, apiKey) {
  const hit = catalogCache.get(base);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.text;
  const res = await fetch(base.replace(/\/+$/, '') + '/models', {
    headers: { Authorization: 'Bearer ' + apiKey }
  });
  if (!res.ok) throw new Error('Could not list models (' + res.status + ')');
  const ids = ((await res.json()).data || []).map((m) => String(m.id || ''));
  // Prefer small chat models; keep anything that looks like a chat model.
  const ver = (n) => { const v = n.match(/(\d+)(?:\.(\d+))?/); return v ? (+v[1]) * 100 + (+(v[2] || 0)) : 0; };
  const local = isLocalBase(base);
  const text = ids
    .filter((n) => local || /gpt|claude|llama|mixtral|mistral|qwen|deepseek|grok|gemini|gemma|phi|mini|haiku|flash|turbo|4o|4\.1|5/i.test(n))
    .filter((n) => !/image|whisper|tts|embed|moderation|dall-e/i.test(n))
    .sort((a, b) => ver(b) - ver(a) || a.length - b.length)
    .slice(0, 40);
  catalogCache.set(base, { at: Date.now(), text });
  return text;
}

const FALLBACK_TEXT = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'];

// Keep the excerpt small: surrounding context for placeholders/rewrites,
// head+tail for whole-book jobs (same trick as art.js).
function excerpt(text, maxWords = 6000) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  const head = Math.round(maxWords * 0.75);
  return words.slice(0, head).join(' ') + '\n\n[…]\n\n' + words.slice(-(maxWords - head)).join(' ');
}

function normalizeBase(u) {
  return String(u || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
}

// Content can be a string or a multipart array; reasoning models may also
// stash thinking in `reasoning_content` (never treated as the answer).
function messageText(msg) {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === 'string' ? p : (p && (p.text || p.content)) || ''))
      .join('').trim();
  }
  return '';
}

async function chat({ baseUrl, apiKey, model, messages, maxTokens, ollama = false }) {
  const base = normalizeBase(baseUrl);
  if (ollama) return ollamaChat({ base, apiKey, model, messages, maxTokens });
  // Local catalogs won't have the gpt-* fallbacks — don't waste round-trips.
  const fallbacks = isLocalBase(base) ? [] : FALLBACK_TEXT;
  let live = [];
  try {
    const cat = await listTextModels(base, apiKey);
    for (const n of cat) if (!fallbacks.includes(n)) live.push(n);
  } catch { /* static list will do */ }
  const candidates = [...new Set([model, ...fallbacks, ...live].filter(Boolean))];
  return withModels(model, candidates, async (m) => {
    // Reasoning models (Qwen, R1-distills, gpt-oss, o-series…) can burn the
    // whole budget thinking and come back with empty content — and engines
    // don't always flag it with finish_reason 'length' (Ollama often says
    // 'stop'). Escalate the budget on any empty reply, not just truncation.
    const budgets = [...new Set([maxTokens || 800, 4000, 8000].filter((b) => b <= 16000))];
    for (const budget of budgets) {
      const payload = {
        model: m,
        messages,
        max_tokens: budget
      };
      // o-series / gpt-5 reasoning models want a low effort setting
      if (/^gpt-5|^o\d/.test(m)) payload.reasoning_effort = 'low';
      const body = await post(base + '/chat/completions', { Authorization: 'Bearer ' + apiKey }, payload);
      const choice = body.choices && body.choices[0];
      const text = messageText(choice && choice.message);
      if (text) return text;
    }
    throw new Error('The model kept thinking until it ran out of room — try a non-reasoning model or a larger context in your engine');
  });
}

// Native Ollama keeps reasoning in its dedicated thinking field and returns
// the finished prose in content. Keep this path Ollama-only: other localhost
// OpenAI-compatible engines use the generic compatibility route above.
async function ollamaChat({ base, apiKey, model, messages, maxTokens }) {
  if (!model) throw new Error('Choose a local model under File → Writing Assistant…');
  const root = base.replace(/\/v1$/i, '');
  // Reasoning tokens count toward Ollama's generation limit. 800 tokens is
  // enough for a line edit only when the model does not think first; reserve
  // a modest combined budget so it can finish with actual revised prose.
  const predict = Math.max(maxTokens || 800, 2400);
  const body = await post(root + '/api/chat', { Authorization: 'Bearer ' + apiKey }, {
    model,
    messages,
    stream: false,
    think: true,
    options: { num_predict: predict }
  }, 120000);
  const text = messageText(body && body.message);
  if (!text) throw new Error('The local model used its response budget for thinking before it reached the revision. Try again, or choose a faster model.');
  return { model, result: text };
}

module.exports = { chat, listTextModels, excerpt, normalizeBase, FALLBACK_TEXT };
