/* lkrag-lite frontend */

// ---------- API helpers ----------

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------- Workspace ----------

let workspaces = [];
let isUpdatingDropdown = false;

async function loadWorkspaces() {
  workspaces = await api('GET', '/workspaces');
  renderWorkspaceDropdown();
  await loadIndexStats();
}

function renderWorkspaceDropdown() {
  const select  = document.getElementById('ws-select');
  const delBtn  = document.getElementById('btn-delete-ws');
  const emptyEl = document.getElementById('ws-empty');

  isUpdatingDropdown = true;
  select.innerHTML = '';

  if (workspaces.length === 0) {
    emptyEl.classList.remove('hidden');
    select.classList.add('hidden');
    delBtn.disabled = true;
  } else {
    emptyEl.classList.add('hidden');
    select.classList.remove('hidden');
    delBtn.disabled = false;

    workspaces.forEach((ws) => {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = `${ws.name}  —  ${ws.path}`;
      if (ws.is_active) opt.selected = true;
      select.appendChild(opt);
    });
  }
  isUpdatingDropdown = false;
}

document.getElementById('ws-select').addEventListener('change', async (e) => {
  if (isUpdatingDropdown) return;
  const id = Number(e.target.value);
  await api('PUT', `/workspaces/${id}/activate`);
  await loadIndexStats();
});

document.getElementById('btn-delete-ws').addEventListener('click', async () => {
  const select = document.getElementById('ws-select');
  const id = Number(select.value);
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return;
  if (!confirm(`Delete workspace "${ws.name}"? Its index will also be removed.`)) return;

  const currentIndex = workspaces.findIndex((w) => w.id === id);

  try {
    await api('DELETE', `/workspaces/${id}`);
    workspaces = await api('GET', '/workspaces');

    if (workspaces.length > 0) {
      const nextIndex = Math.min(currentIndex, workspaces.length - 1);
      await api('PUT', `/workspaces/${workspaces[nextIndex].id}/activate`);
      workspaces = await api('GET', '/workspaces');
    }

    renderWorkspaceDropdown();
    await loadIndexStats();
  } catch (err) {
    alert('Failed to delete workspace: ' + err.message);
  }
});

// ---------- Directory picker modal ----------

document.getElementById('btn-add-ws').addEventListener('click', () => openDirModal());

document.getElementById('modal-cancel-btn').addEventListener('click', closeDirModal);
document.getElementById('dir-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDirModal();
});

document.getElementById('modal-go-btn').addEventListener('click', () => {
  const p = document.getElementById('modal-path-input').value.trim();
  if (p) navigateTo(p);
});

document.getElementById('modal-path-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const p = document.getElementById('modal-path-input').value.trim();
    if (p) navigateTo(p);
  }
});

document.getElementById('modal-add-btn').addEventListener('click', async () => {
  const path = document.getElementById('modal-path-input').value.trim();
  const name = document.getElementById('modal-name-input').value.trim();
  if (!path || !name) {
    showModalError('Please enter a path and name.');
    return;
  }
  try {
    const ws = await api('POST', '/workspaces', { name, path });
    await api('PUT', `/workspaces/${ws.id}/activate`);
    closeDirModal();
    await loadWorkspaces();
  } catch (err) {
    showModalError('Failed to add: ' + err.message);
  }
});

function openDirModal() {
  clearModalError();
  document.getElementById('modal-name-input').value = '';
  document.getElementById('dir-modal').classList.remove('hidden');
  navigateTo('');
}

function closeDirModal() {
  document.getElementById('dir-modal').classList.add('hidden');
}

async function navigateTo(dirPath) {
  clearModalError();
  try {
    const data = await api('GET', '/browse' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : ''));
    renderDirList(data);
    document.getElementById('modal-path-input').value = data.current;
    const nameParts = data.current.split('/');
    const dirName = nameParts[nameParts.length - 1] || nameParts[nameParts.length - 2] || '';
    document.getElementById('modal-name-input').value = dirName;
  } catch (err) {
    showModalError(err.message);
  }
}

function renderDirList({ parent, current, dirs }) {
  const list = document.getElementById('modal-dir-list');
  let html = '';
  if (parent) {
    html += `<div class="dir-entry parent" data-path="${esc(parent)}"><span class="dir-icon">📁</span>..</div>`;
  }
  if (dirs.length === 0 && !parent) {
    html += '<div style="padding:10px;color:#888;font-size:13px">No subdirectories</div>';
  }
  html += dirs.map((d) => {
    const full = current.replace(/\/$/, '') + '/' + d;
    return `<div class="dir-entry" data-path="${esc(full)}"><span class="dir-icon">📁</span>${esc(d)}</div>`;
  }).join('');
  list.innerHTML = html;

  list.querySelectorAll('.dir-entry').forEach((el) => {
    el.addEventListener('click', () => navigateTo(el.dataset.path));
  });
}

function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearModalError() {
  document.getElementById('modal-error').classList.add('hidden');
}

// ---------- Index stats ----------

function formatDate(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadIndexStats() {
  const el = document.getElementById('index-stats');
  try {
    const stats = await api('GET', '/index/stats');
    if (stats.indexedFiles === 0) {
      el.textContent = 'Not indexed yet';
    } else {
      const when = stats.lastUpdatedAt ? '  ·  Last updated: ' + formatDate(stats.lastUpdatedAt) : '';
      const count = stats.indexedFiles;
      el.textContent = `Indexed: ${count} file${count !== 1 ? 's' : ''}${when}`;
    }
  } catch (_) {
    el.textContent = '';
  }
}

// ---------- Index ----------

let pollTimer = null;

async function startIndexing(type) {
  clearIndexError();
  try {
    await api('POST', `/index/${type}`);
    startPolling();
    updateIndexButtons(true);
  } catch (err) {
    showIndexError(err.message);
  }
}

document.getElementById('btn-update').addEventListener('click', () => startIndexing('update'));
document.getElementById('btn-rebuild').addEventListener('click', () => startIndexing('rebuild'));
document.getElementById('btn-cancel').addEventListener('click', async () => {
  await api('POST', '/index/cancel');
});

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollStatus, 1500);
}

async function pollStatus() {
  try {
    const s = await api('GET', '/index/status');
    const el = document.getElementById('index-stats');
    if (s.state === 'indexing') {
      el.textContent = s.total > 0
        ? `Indexing...  ${s.processed} / ${s.total}${s.currentFile ? '  —  ' + s.currentFile : ''}`
        : 'Indexing...';
    } else {
      clearInterval(pollTimer);
      pollTimer = null;
      updateIndexButtons(false);
      if (s.error) showIndexError(s.error);
      await loadIndexStats();
    }
  } catch (_) { /* ignore transient */ }
}

function updateIndexButtons(indexing) {
  document.getElementById('btn-update').disabled  = indexing;
  document.getElementById('btn-rebuild').disabled = indexing;
  document.getElementById('btn-cancel').disabled  = !indexing;
}

function showIndexError(msg) {
  const el = document.getElementById('index-error');
  el.textContent = 'Error: ' + msg;
  el.classList.remove('hidden');
}

function clearIndexError() {
  document.getElementById('index-error').classList.add('hidden');
}

// ---------- Search ----------

document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('search-query').value.trim();
  if (!query) return;

  document.getElementById('search-error').classList.add('hidden');
  document.getElementById('answer-section').classList.add('hidden');
  document.getElementById('search-spinner').classList.remove('hidden');
  document.getElementById('btn-search').disabled = true;

  try {
    const result = await api('POST', '/search', { query });
    renderAnswer(result);
  } catch (err) {
    const el = document.getElementById('search-error');
    el.textContent = 'Error: ' + err.message;
    el.classList.remove('hidden');
  } finally {
    document.getElementById('search-spinner').classList.add('hidden');
    document.getElementById('btn-search').disabled = false;
  }
});

function renderAnswer({ answer, citations }) {
  const normalized = answer.replace(/【(\d+)】/g, '[$1]');

  const PLACEHOLDER = '\x00CITE$1\x00';
  const withPlaceholders = normalized.replace(/\[(\d+)\]/g, PLACEHOLDER);

  let html = typeof marked !== 'undefined'
    ? marked.parse(withPlaceholders)
    : withPlaceholders.replace(/\n/g, '<br>');

  html = html.replace(/\x00CITE(\d+)\x00/g, (_, n) => {
    const c = citations.find((x) => x.n === Number(n));
    if (!c) return `[${n}]`;
    return `<a class="cite-link" href="#cite-${n}" title="${esc(c.path)}">[${n}]</a>`;
  });

  document.getElementById('answer-text').innerHTML = html;

  const citSection = document.getElementById('citations-section');
  const citList    = document.getElementById('citation-list');

  if (citations.length > 0) {
    citList.innerHTML = citations.map((c) => `
      <div class="citation-item" id="cite-${c.n}">
        <div class="citation-header">
          <span class="citation-n">[${c.n}]</span>
          <span class="citation-path">${esc(c.path)}</span>
          <span class="citation-score">score: ${c.score}</span>
          <button class="btn-open btn-link" data-path="${esc(c.path)}">Open</button>
        </div>
        <div class="citation-snippet">"${esc(c.snippet)}"</div>
      </div>
    `).join('');
    citSection.classList.remove('hidden');
  } else {
    citSection.classList.add('hidden');
  }

  document.getElementById('answer-section').classList.remove('hidden');
}

document.getElementById('citation-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-path]');
  if (btn) openFile(btn.dataset.path);
});

async function openFile(path) {
  try {
    await api('GET', '/open?path=' + encodeURIComponent(path));
  } catch (err) {
    alert('Could not open file: ' + err.message);
  }
}

// ---------- Util ----------

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Settings ----------

async function loadSettings() {
  try {
    const cfg = await api('GET', '/config');
    document.getElementById('cfg-top-k').value               = cfg.topK;
    document.getElementById('cfg-min-sim').value             = cfg.minSimilarity;
    document.getElementById('cfg-output-instructions').value = cfg.outputInstructions;
  } catch (_) { /* ignore */ }
}

function showSettingsStatus(msg, isError = false) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = isError ? 'error' : 'muted';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const topK               = Number(document.getElementById('cfg-top-k').value);
  const minSimilarity      = Number(document.getElementById('cfg-min-sim').value);
  const outputInstructions = document.getElementById('cfg-output-instructions').value;
  try {
    await api('PUT', '/config', { topK, minSimilarity, outputInstructions });
    showSettingsStatus('Applied.');
  } catch (err) {
    showSettingsStatus('Error: ' + err.message, true);
  }
});

document.getElementById('btn-reload-env').addEventListener('click', async () => {
  try {
    const cfg = await api('POST', '/config/reload');
    document.getElementById('cfg-top-k').value               = cfg.topK;
    document.getElementById('cfg-min-sim').value             = cfg.minSimilarity;
    document.getElementById('cfg-output-instructions').value = cfg.outputInstructions;
    showSettingsStatus('Reloaded from .env.');
  } catch (err) {
    showSettingsStatus('Error: ' + err.message, true);
  }
});

// ---------- Shutdown ----------

document.getElementById('btn-shutdown').addEventListener('click', async () => {
  if (!confirm('Shut down the server?')) return;
  try {
    await api('POST', '/shutdown');
  } catch (_) { /* server may close before response completes */ }
  document.getElementById('app').innerHTML =
    '<p style="margin:40px auto;text-align:center;color:#555;font-size:15px">' +
    'Server stopped. You can close this tab.</p>';
});

// ---------- Init ----------

loadWorkspaces();
loadSettings();
pollStatus();
