// NEO — local AI helper (main process)
//
// The guided setup behind "AI Setup → Free & private": looks at the
// computer, installs and starts Ollama when it's missing, pulls a model
// that fits the hardware, and suggests plain-language picks. Pure Node
// (fetch + child_process + os) so the app stays dependency-free.

'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DOWNLOAD_URLS = {
  win32: 'https://ollama.com/download/OllamaSetup.exe',
  darwin: 'https://ollama.com/download/Ollama-darwin.zip'
};

// Long jobs are abortable: pull, and the installer's download phase.
const aborts = { pull: null, setup: null };

function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || '') });
    });
  });
}

async function fetchJSON(url, opts = {}, timeoutMs = 2500) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* -------------------------------------------------------------- */
/*  Hardware                                                       */
/* -------------------------------------------------------------- */

async function nvidiaGpu() {
  const { ok, out } = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], 4000);
  if (!ok) return null;
  let best = null;
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(.+?),\s*(\d+)\s*MiB\s*$/i);
    if (!m) continue;
    const mb = +m[2];
    if (!best || mb > best.vramMB) best = { name: m[1].trim(), vramMB: mb };
  }
  return best;
}

// AdapterRAM is a 32-bit field and wraps at 4 GB — anything near the
// wrap means "4 GB or more", which is enough for tiering.
async function windowsGpu() {
  const nv = await nvidiaGpu();
  if (nv) return nv;
  const { ok, out } = await run('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'], 8000);
  if (!ok || !out.trim()) return null;
  let cards = null;
  try { cards = JSON.parse(out); } catch { return null; }
  if (!cards) return null;
  if (!Array.isArray(cards)) cards = [cards];
  let best = null;
  for (const c of cards) {
    if (!c || !c.Name) continue;
    let mb = Number(c.AdapterRAM) / (1024 * 1024);
    if (!isFinite(mb) || mb <= 0) continue;
    if (mb > 4090) mb = 4096; // wrapped or capped field — call it 4 GB+
    if (!best || mb > best.vramMB) best = { name: String(c.Name), vramMB: Math.round(mb) };
  }
  return best;
}

async function macChip() {
  const [mem, chip] = await Promise.all([
    run('sysctl', ['-n', 'hw.memsize'], 4000),
    run('sysctl', ['-n', 'machdep.cpu.brand_string'], 4000)
  ]);
  return {
    ramBytes: mem.ok ? Number(mem.out.trim()) : 0,
    name: chip.ok ? chip.out.trim() : ''
  };
}

async function detectHardware() {
  const platform = process.platform;
  const ramGB = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
  let gpu = null;
  let appleSilicon = false;
  if (platform === 'win32') {
    gpu = await windowsGpu();
  } else if (platform === 'darwin') {
    const chip = await macChip();
    appleSilicon = /Apple\s*(M\d|Silicon)/i.test(chip.name);
    if (appleSilicon) gpu = { name: chip.name, vramMB: null }; // unified memory
    else gpu = await nvidiaGpu(); // Intel Macs with an NVIDIA dGPU, occasionally
  } else {
    gpu = await nvidiaGpu();
  }
  return { platform, ramGB, gpu, appleSilicon };
}

/* -------------------------------------------------------------- */
/*  Model suggestions                                              */
/* -------------------------------------------------------------- */

// One table, easy to keep current. Sizes are the default (q4) pulls.
const MODELS = [
  { tag: 'llama3.2:3b', sizeGB: 2.0, blurb: 'Small and quick — fine for brainstorming and short suggestions.' },
  { tag: 'qwen3:4b', sizeGB: 2.5, blurb: 'Compact all-rounder, snappy with rewrites.' },
  { tag: 'gemma3:4b', sizeGB: 3.3, blurb: 'Google’s compact model — surprisingly good prose for its size.' },
  { tag: 'llama3.1:8b', sizeGB: 4.9, blurb: 'The safe pick — a balanced brain for rewrites and lore checks.' },
  { tag: 'qwen3:8b', sizeGB: 5.2, blurb: 'Sharp and articulate; follows rewrite instructions well.' },
  { tag: 'gemma4:12b', sizeGB: 7.6, blurb: 'The writer’s pick — the richest prose of the mid-size models.' },
  { tag: 'qwen3:14b', sizeGB: 9.3, blurb: 'A bigger brain for continuity checks and synopses.' },
  { tag: 'gpt-oss:20b', sizeGB: 13.0, blurb: 'OpenAI’s open model — nimble for its size.' },
  { tag: 'gemma4:26b', sizeGB: 19.0, blurb: 'The luxury option — near-cloud prose quality, fully private.' }
];

// GB of weights the machine can comfortably hold (weights + ~1.2 GB of
// runtime headroom must fit the budget).
function budgetGB(hw) {
  if (hw.appleSilicon) return Math.max(hw.ramGB * 0.6, 3.4);
  if (hw.gpu && hw.gpu.vramMB) return Math.max(hw.gpu.vramMB / 1024 - 1, 3.4);
  return Math.max(Math.min(hw.ramGB * 0.5, 6), 3.4); // CPU-only: RAM it is
}

function suggestModels(hw) {
  const budget = budgetGB(hw);
  const fits = (m) => m.sizeGB + 1.2 <= budget + 0.3;
  let models = MODELS.filter(fits);
  if (models.length < 2) models = MODELS.slice(0, 2); // weakest machines still get a choice
  models = models.slice(-3); // the three largest that fit
  const smaller = MODELS.filter((m) => m.sizeGB + 1.2 <= budget * 0.6 + 0.3 && !models.includes(m)).slice(0, 3);
  const cpuOnly = !hw.appleSilicon && !(hw.gpu && hw.gpu.vramMB);
  let tier = 'high';
  if (budget < 3.5) tier = 'minimal';
  else if (budget < 6) tier = 'low';
  else if (budget < 11) tier = 'mid';
  const verdicts = {
    minimal: 'Tight — expect small, fast models and a little patience.',
    low: 'Modest — quick, smaller models are the sweet spot.',
    mid: 'Good — mid-size models will run comfortably.',
    high: 'Plenty of room — bigger, smarter models will run well.'
  };
  let verdict = verdicts[tier];
  if (cpuOnly) verdict += ' No graphics card detected, so it will use the processor — smaller is better.';
  return { tier, verdict, budgetGB: Math.round(budget * 10) / 10, models, smaller, cpuOnly };
}

/* -------------------------------------------------------------- */
/*  Ollama status / start / install                                */
/* -------------------------------------------------------------- */

async function status() {
  try {
    const v = await fetchJSON(OLLAMA_BASE + '/api/version', {}, 2000);
    return { running: true, version: String(v.version || '') };
  } catch {
    return { running: false, version: '' };
  }
}

// /api/tags is Ollama's catalog of downloaded models (unlike /api/ps,
// which only reports models currently loaded into memory).
async function installedModels() {
  try {
    const body = await fetchJSON(OLLAMA_BASE + '/api/tags', {}, 3000);
    return (body.models || []).map((model) => ({
      tag: String(model.name || model.model || ''),
      sizeGB: model.size ? Math.round(model.size / (1024 ** 3) * 10) / 10 : null
    })).filter((model) => model.tag);
  } catch {
    return [];
  }
}

async function installed() {
  const p = process.platform;
  if (p === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe')
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    // "where" happily matches scripts (a stray ollama.js in the cwd, say) —
    // only a real .exe counts.
    const w = await run('where', ['ollama.exe'], 4000);
    if (w.ok) {
      const exe = w.out.split('\n').map((l) => l.trim()).filter((l) => /\.exe$/i.test(l))[0];
      if (exe) return exe;
    }
    return null;
  }
  if (p === 'darwin') {
    if (fs.existsSync('/Applications/Ollama.app')) return '/Applications/Ollama.app';
    const w = await run('which', ['ollama'], 4000);
    return w.ok && w.out.trim() ? w.out.trim() : null;
  }
  const w = await run('which', ['ollama'], 4000);
  return w.ok && w.out.trim() ? w.out.trim() : null;
}

function startDetached(cmd, args) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function startOllama(binPath) {
  const p = process.platform;
  if (p === 'darwin') {
    const opened = (await run('open', ['-a', 'Ollama'], 4000)).ok || (await run('open', ['-b', 'com.ollama.Ollama'], 4000)).ok;
    if (opened) return true;
    return startDetached(binPath && binPath !== '/Applications/Ollama.app' ? binPath : '/usr/local/bin/ollama', ['serve']);
  }
  if (p === 'win32') {
    const dir = binPath && path.dirname(binPath);
    const appExe = dir && path.join(dir, 'ollama app.exe');
    if (appExe && fs.existsSync(appExe)) return startDetached(appExe, []);
    return startDetached(binPath || 'ollama', ['serve']);
  }
  return startDetached(binPath || 'ollama', ['serve']);
}

async function waitReady(timeoutMs = 180000, onTick) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await status()).running) return true;
    if (onTick) onTick(Math.round((deadline - Date.now()) / 1000));
    await new Promise((r) => setTimeout(r, 1500));
  }
  return (await status()).running;
}

async function downloadTo(url, dest, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Download failed (HTTP ' + res.status + ')');
  const total = +(res.headers.get('content-length') || 0);
  let done = 0;
  const ws = fs.createWriteStream(dest);
  try {
    for await (const chunk of res.body) {
      ws.write(chunk);
      done += chunk.length;
      if (onProgress) onProgress({ done, total });
    }
  } finally {
    await new Promise((r) => ws.end(r));
  }
  return dest;
}

// Bring Ollama up: start it if installed, download + install if not.
// onEvent({type:'download'|'note'|'wait', ...}) keeps the wizard informed.
async function ensureReady(onEvent = () => {}) {
  const emit = (e) => { try { onEvent(e); } catch { /* UI gone — keep going */ } };
  if ((await status()).running) {
    emit({ type: 'ready', already: true });
    return { ok: true, alreadyRunning: true };
  }
  const bin = await installed();
  if (bin) {
    emit({ type: 'note', text: 'Starting Ollama…' });
    await startOllama(bin);
    if (await waitReady(60000)) { emit({ type: 'ready' }); return { ok: true, started: true }; }
    return { ok: false, error: 'Ollama is installed but did not start — try launching it yourself, then come back.' };
  }

  const p = process.platform;
  const url = DOWNLOAD_URLS[p];
  if (!url) {
    if (p === 'linux') {
      emit({ type: 'note', text: 'Installing Ollama with the official installer…' });
      const r = await new Promise((resolve) => {
        execFile('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], { timeout: 10 * 60 * 1000, windowsHide: true }, (err) => resolve(!err));
      });
      if (!r) return { ok: false, error: 'The Ollama installer failed — see ollama.com/download.' };
      if (await waitReady(120000, (s) => emit({ type: 'wait', text: `Waiting for Ollama… (${s}s)` }))) {
        emit({ type: 'ready' });
        return { ok: true, installed: true };
      }
      return { ok: false, error: 'Ollama was installed but is not responding — try running "ollama serve" in a terminal.' };
    }
    return { ok: false, error: 'Automatic install is not available on this platform — see ollama.com/download.' };
  }

  const dest = path.join(os.tmpdir(), p === 'win32' ? 'NEO-OllamaSetup.exe' : 'NEO-Ollama.zip');
  aborts.setup = new AbortController();
  try {
    await downloadTo(url, dest, (d) => emit({
      type: 'download',
      pct: d.total ? Math.round((d.done / d.total) * 100) : 0,
      mb: Math.round(d.done / (1024 * 1024)),
      mbTotal: d.total ? Math.round(d.total / (1024 * 1024)) : 0
    }), aborts.setup.signal);
  } catch (err) {
    aborts.setup = null;
    return { ok: false, error: 'Could not download Ollama — check your connection, or install it from ollama.com/download. (' + String(err.message || err) + ')' };
  }
  aborts.setup = null;

  if (p === 'win32') {
    emit({ type: 'note', text: 'Running the Ollama installer — this can take a minute…' });
    const silent = await new Promise((resolve) => {
      execFile(dest, ['/VERYSILENT', '/NORESTART'], { timeout: 5 * 60 * 1000, windowsHide: true }, (err) => resolve(!err));
    });
    if (!silent) {
      // Not silent — hand the normal installer to the user and wait it out.
      emit({ type: 'note', text: 'Click "Install" in the Ollama window that opened…' });
      const ui = await new Promise((resolve) => {
        execFile(dest, [], { timeout: 10 * 60 * 1000 }, (err) => resolve(!err));
      });
      if (!ui) return { ok: false, error: 'The Ollama installer did not finish — try again, or install manually from ollama.com/download.' };
    }
  } else {
    emit({ type: 'note', text: 'Unpacking Ollama into /Applications…' });
    const ok = (await run('ditto', ['-x', '-k', dest, '/Applications'], 5 * 60 * 1000)).ok;
    if (!ok) return { ok: false, error: 'Could not unpack Ollama — install it manually from ollama.com/download.' };
  }

  emit({ type: 'wait', text: 'Waking Ollama up…' });
  const bin2 = await installed();
  await startOllama(bin2);
  if (await waitReady(180000, (s) => emit({ type: 'wait', text: `Waiting for Ollama… (${s}s)` }))) {
    emit({ type: 'ready' });
    return { ok: true, installed: true };
  }
  return { ok: false, error: 'Ollama was installed but is not responding — try restarting the app.' };
}

/* -------------------------------------------------------------- */
/*  Model pull                                                     */
/* -------------------------------------------------------------- */

// /api/pull streams newline-delimited progress; success ends the stream.
// (Uint8Array.toString() ignores encodings — decode chunks explicitly, and
// don't drop a final line that arrives without a trailing newline.)
async function pull(name, onEvent = () => {}) {
  const emit = (e) => { try { onEvent(e); } catch { /* UI gone */ } };
  aborts.pull = new AbortController();
  const handleLine = (line) => {
    line = line.trim();
    if (!line) return null;
    let j = null;
    try { j = JSON.parse(line); } catch { return null; }
    if (j.error) return { ok: false, error: String(j.error) };
    if (j.status === 'success') { emit({ type: 'pull', pct: 100, status: 'success' }); return { ok: true }; }
    const pct = j.total ? Math.round((j.completed / j.total) * 100) : null;
    emit({
      type: 'pull',
      pct,
      gbDone: j.completed ? Math.round(j.completed / (1024 ** 3) * 10) / 10 : null,
      gbTotal: j.total ? Math.round(j.total / (1024 ** 3) * 10) / 10 : null,
      status: String(j.status || '')
    });
    return null;
  };
  try {
    const res = await fetch(OLLAMA_BASE + '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal: aborts.pull.signal
    });
    if (!res.ok) return { ok: false, error: 'Pull failed (HTTP ' + res.status + ')' };
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const r = handleLine(buf.slice(0, nl));
        if (r) return r;
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode(); // flush any split character
    if (buf.trim()) {
      const r = handleLine(buf);
      if (r) return r;
    }
    return { ok: false, error: 'The download ended before finishing — try again.' };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'Pull failed: ' + String(err.message || err) };
  } finally {
    aborts.pull = null;
  }
}

function cancel(kind) {
  const c = aborts[kind === 'pull' ? 'pull' : 'setup'];
  if (c) { try { c.abort(); } catch { /* already gone */ } }
  return true;
}

module.exports = { detectHardware, suggestModels, status, installedModels, ensureReady, pull, cancel, OLLAMA_BASE };
