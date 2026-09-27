/* NEO — focused writing assistant (renderer)
   Owns the one assistant profile, setup, and guarded text requests. */
'use strict';

window.NeoWritingAssistant = (() => {
  const DEFAULT_BASE = 'https://api.openai.com/v1';
  let host = null;

  const isLocal = (base) => {
    try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(String(base || '')).hostname); }
    catch { return false; }
  };
  // Accept the two forms a writer is likely to copy from ollama.com:
  // `qwen3:8b` and `https://ollama.com/library/qwen3:8b`.
  const ollamaTag = (value) => {
    let tag = String(value || '').trim();
    try {
      const url = new URL(tag);
      if (url.hostname === 'ollama.com' || url.hostname.endsWith('.ollama.com')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const libraryAt = parts.indexOf('library');
        tag = decodeURIComponent(parts[libraryAt >= 0 ? libraryAt + 1 : parts.at(-1)] || '');
      }
    } catch { /* a model tag is not a URL */ }
    return /^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i.test(tag) ? tag : '';
  };
  const profile = () => {
    const lib = host.library();
    return lib.writingAssistant || { provider: 'openai', name: 'OpenAI', baseUrl: DEFAULT_BASE, model: '' };
  };
  const save = async (next) => {
    host.library().writingAssistant = next;
    await window.neo.writeLibrary(host.library());
  };

  async function migrate() {
    const lib = host.library();
    if (lib.writingAssistant) return;
    const ai = lib.ai || {};
    const routes = ai.features || {};
    const route = routes.placeholders || routes.rewrite || {};
    const oldProvider = (ai.providers || {})[route.provider] || {};
    const coverProvider = (lib.coverArt && lib.coverArt.provider) || 'openai';
    const provider = route.provider || coverProvider;
    lib.writingAssistant = {
      provider,
      name: oldProvider.name || (provider === 'openai' ? 'OpenAI' : provider),
      baseUrl: oldProvider.baseUrl || DEFAULT_BASE,
      model: route.model || ''
    };
    // Old per-feature routing is obsolete. Keys deliberately stay in the
    // secure store and old generated prose stays in Notes.
    delete lib.ai;
    await window.neo.writeLibrary(lib);
  }

  async function ask(messages, maxTokens = 800) {
    const p = profile();
    if (!isLocal(p.baseUrl) && !(await window.neo.hasSecret(p.provider))) {
      host.toast('Set up Writing Assistant under File → Writing Assistant… first', 6000);
      return null;
    }
    const res = await window.neo.aiChat(host.bookId(), 'writing-assistant', {
      provider: p.provider, baseUrl: p.baseUrl, model: p.model || undefined, messages, maxTokens
    });
    if (!res || res.error) {
      host.toast('The writing assistant hiccuped: ' + ((res && res.error) || 'unknown'), 7000);
      return null;
    }
    return res;
  }

  async function setKey(provider, label) {
    const key = await host.askInput(`API key — ${label}`, 'paste key, or type “remove”', '');
    if (key == null) return false;
    if (key === 'remove') await window.neo.setSecret(provider, '');
    else if (key && /^\S{20,}$/.test(key.trim())) await window.neo.setSecret(provider, key.trim());
    else if (key) { host.toast('That does not look like an API key — not saved'); return false; }
    return true;
  }

  function openSettings() {
    const p = profile();
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal wa-settings" style="width:460px">
        <h2 style="font-size:17px">Writing Assistant</h2>
        <p class="soft">Optional help for revising selected prose. Nothing is sent until you ask.</p>
        ${window.neo.pocket ? '' : `<div class="wa-paths">
          <button class="wa-local"><strong>Use local AI</strong><span>Free and private on this computer.</span></button>
          <button class="wa-cloud"><strong>Use an API key</strong><span>Use OpenAI or another compatible provider.</span></button>
        </div>`}
        <div class="wa-cloud-fields">
          <label>Provider name<input class="wa-name" value="${host.escape(p.name)}" spellcheck="false" /></label>
          <label>API base URL<input class="wa-base" value="${host.escape(p.baseUrl)}" spellcheck="false" /></label>
          <label>Model <input class="wa-model" value="${host.escape(p.model || '')}" placeholder="provider default" spellcheck="false" /></label>
          <div class="wa-key-state soft"></div>
          <div><button class="wa-key btn-quiet">Manage API key…</button> <button class="wa-models btn-quiet">Find models</button></div>
        </div>
        <div style="text-align:right;margin-top:16px"><button class="m-cancel btn-quiet" style="margin-right:10px">Cancel</button><button class="m-ok btn-gold">Save</button></div>
      </div>`;
    document.body.appendChild(bd);
    const name = bd.querySelector('.wa-name');
    const base = bd.querySelector('.wa-base');
    const model = bd.querySelector('.wa-model');
    const keyState = bd.querySelector('.wa-key-state');
    const providerId = () => (name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'assistant');
    const refreshKey = async () => { keyState.textContent = isLocal(base.value) ? 'Local engine — no key needed' : ((await window.neo.hasSecret(providerId())) ? 'API key saved' : 'No API key saved'); };
    refreshKey();
    bd.querySelector('.wa-key').onclick = async () => { await setKey(providerId(), name.value.trim() || 'Writing Assistant'); refreshKey(); };
    bd.querySelector('.wa-models').onclick = async () => {
      keyState.textContent = 'Looking for models…';
      const result = await window.neo.aiModels(base.value.trim() || DEFAULT_BASE, providerId());
      if (result && result.models && result.models.length) {
        model.value = result.models[0];
        keyState.textContent = `Found ${result.models.length} models; selected ${model.value}`;
      } else keyState.textContent = 'No models found — enter one if your provider requires it.';
    };
    const close = () => bd.remove();
    bd.querySelector('.m-cancel').onclick = close;
    bd.querySelector('.m-ok').onclick = async () => {
      let u;
      try { u = new URL(base.value.trim() || DEFAULT_BASE); } catch { host.toast('Enter a valid http(s) API base URL'); return; }
      if (!/^https?:$/.test(u.protocol)) { host.toast('Use an http or https API base URL'); return; }
      await save({ provider: providerId(), name: name.value.trim() || 'Writing Assistant', baseUrl: u.href.replace(/\/$/, ''), model: model.value.trim() });
      close(); host.toast('Writing Assistant settings saved');
    };
    const local = bd.querySelector('.wa-local');
    if (local) local.onclick = () => { close(); openLocalSetup(); };
    const cloud = bd.querySelector('.wa-cloud');
    if (cloud) cloud.onclick = () => { name.focus(); name.select(); };
  }

  async function openLocalSetup() {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="width:460px"><h2 style="font-size:17px">Local Writing Assistant</h2><p class="wa-local-copy">Checking this computer…</p><div class="wa-download" hidden><div class="ai-progress"><span></span></div><div class="wa-download-status soft"></div></div><div class="wa-local-models"></div><div style="text-align:right;margin-top:16px"><button class="m-cancel btn-quiet">Cancel</button></div></div>`;
    document.body.appendChild(bd);
    let unsubscribe = null;
    let downloading = false;
    const close = async () => {
      if (downloading) await window.neo.ollamaCancel();
      if (unsubscribe) unsubscribe();
      bd.remove();
    };
    bd.querySelector('.m-cancel').onclick = close;
    const copy = bd.querySelector('.wa-local-copy'); const choices = bd.querySelector('.wa-local-models');
    const download = bd.querySelector('.wa-download');
    const progress = download.querySelector('.ai-progress span');
    const downloadStatus = download.querySelector('.wa-download-status');
    unsubscribe = window.neo.onOllamaEvent((event) => {
      if (!bd.isConnected || !event) return;
      if (event.type === 'pull') {
        download.hidden = false;
        if (typeof event.pct === 'number') progress.style.width = `${Math.max(0, Math.min(100, event.pct))}%`;
        const size = event.gbDone != null ? `${event.gbDone} GB${event.gbTotal != null ? ` of ${event.gbTotal} GB` : ''}` : '';
        downloadStatus.textContent = [event.status, size, typeof event.pct === 'number' ? `${event.pct}%` : ''].filter(Boolean).join(' · ');
      } else if (event.type === 'note' || event.type === 'wait') {
        download.hidden = false; progress.style.width = '2%'; downloadStatus.textContent = event.text || 'Preparing local AI…';
      }
    });
    const detail = await window.neo.ollamaDetect();
    if (!detail || detail.error) { copy.textContent = 'Local AI is unavailable: ' + ((detail && detail.error) || 'unknown error'); return; }
    if (!detail.running) {
      copy.textContent = 'NEO can install and start Ollama, then download one writing model.';
      const setup = document.createElement('button'); setup.className = 'btn-gold'; setup.textContent = 'Set up local AI';
      setup.onclick = async () => { setup.disabled = true; copy.textContent = 'Setting up local AI…'; const r = await window.neo.ollamaSetup(); if (!r || !r.ok) { copy.textContent = (r && r.error) || 'Setup did not finish.'; setup.disabled = false; return; } close(); openLocalSetup(); };
      choices.appendChild(setup); return;
    }
    const installed = detail.installedModels || [];
    const choose = async (item, alreadyInstalled) => {
      if (!alreadyInstalled) {
        copy.textContent = `Downloading ${item.tag}…`;
        download.hidden = false; progress.style.width = '0%'; downloadStatus.textContent = 'Starting download…';
        downloading = true;
        const r = await window.neo.ollamaPull(item.tag);
        downloading = false;
        if (!r || !r.ok) { copy.textContent = (r && r.error) || 'Download failed.'; return false; }
      }
      await save({ provider: 'ollama', name: 'Local AI', baseUrl: 'http://localhost:11434/v1', model: item.tag });
      close(); host.toast(alreadyInstalled ? 'Local Writing Assistant is ready' : 'Model downloaded — Local Writing Assistant is ready');
      return true;
    };
    if (installed.length) {
      copy.textContent = 'Choose an installed model, or download a recommended one.';
      for (const item of installed.slice(0, 6)) {
        const b = document.createElement('button'); b.className = 'fr-choice'; b.style.cssText = 'width:100%;margin-bottom:8px';
        b.innerHTML = `<strong>${host.escape(item.tag)}</strong><span>Already installed${item.sizeGB ? ' · ' + item.sizeGB + ' GB' : ''}</span>`;
        b.onclick = async () => { b.disabled = true; await choose(item, true); };
        choices.appendChild(b);
      }
    } else {
      copy.textContent = 'Choose one model. It runs only on this computer.';
    }
    const suggested = (detail.models || detail.smaller || []).filter((item) => !installed.some((saved) => saved.tag === item.tag)).slice(0, 3);
    for (const item of suggested) {
      const b = document.createElement('button'); b.className = 'fr-choice'; b.style.cssText = 'width:100%;margin-bottom:8px';
      b.innerHTML = `<strong>Download ${host.escape(item.tag)}</strong><span>${host.escape(item.blurb || '')} · ${item.sizeGB || '?'} GB</span>`;
      b.onclick = async () => { b.disabled = true; if (!(await choose(item, false))) b.disabled = false; };
      choices.appendChild(b);
    }
    const custom = document.createElement('div'); custom.className = 'wa-custom-model';
    custom.innerHTML = `<label>Download another Ollama model<input placeholder="qwen3:8b or paste an ollama.com/library URL" spellcheck="false"></label><button class="btn-quiet">Download</button>`;
    const customInput = custom.querySelector('input'); const customButton = custom.querySelector('button');
    customButton.onclick = async () => {
      const tag = ollamaTag(customInput.value);
      if (!tag) { copy.textContent = 'Paste an Ollama model name (for example qwen3:8b) or an ollama.com/library URL.'; return; }
      customButton.disabled = true;
      if (!(await choose({ tag }, installed.some((saved) => saved.tag === tag)))) customButton.disabled = false;
    };
    customInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); customButton.click(); } };
    choices.appendChild(custom);
  }

  return {
    init(api) { host = api; }, migrate, ask, openSettings, profile
  };
})();
