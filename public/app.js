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

async function loadWorkspaces() {
  workspaces = await api('GET', '/workspaces');
  renderWorkspaces();
}

function renderWorkspaces() {
  const list = document.getElementById('workspace-list');
  if (workspaces.length === 0) {
    list.innerHTML = '<p style="color:#888;font-size:13px">ワークスペースがありません</p>';
    return;
  }
  list.innerHTML = workspaces.map((ws) => `
    <div class="ws-item ${ws.is_active ? 'active' : ''}" data-id="${ws.id}">
      <span class="ws-icon">${ws.is_active ? '●' : '○'}</span>
      <span class="ws-name">${esc(ws.name)}</span>
      <span class="ws-path">${esc(ws.path)}</span>
      ${ws.is_active
        ? '<span style="font-size:12px;color:#1a73e8">[選択中]</span>'
        : `<button class="btn-link" onclick="activateWs(${ws.id})">切替</button>`}
      <button class="btn-link danger" onclick="deleteWs(${ws.id})">削除</button>
    </div>
  `).join('');
}

async function activateWs(id) {
  await api('PUT', `/workspaces/${id}/activate`);
  await loadWorkspaces();
}

async function deleteWs(id) {
  if (!confirm('このワークスペースを削除しますか？（インデックスも削除されます）')) return;
  await api('DELETE', `/workspaces/${id}`);
  await loadWorkspaces();
}

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
    showModalError('パスと名前を入力してください');
    return;
  }
  try {
    await api('POST', '/workspaces', { name, path });
    closeDirModal();
    await loadWorkspaces();
  } catch (err) {
    showModalError('追加失敗: ' + err.message);
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
    // Auto-fill name from directory name only when navigating (not when user edited name manually)
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
    html += '<div style="padding:10px;color:#888;font-size:13px">サブディレクトリがありません</div>';
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
    renderProgress(s);
    if (s.state === 'idle') {
      clearInterval(pollTimer);
      pollTimer = null;
      updateIndexButtons(false);
      if (s.error) showIndexError(s.error);
    }
  } catch (_) { /* ignore transient */ }
}

function renderProgress(s) {
  const wrap = document.getElementById('index-progress');
  const bar  = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');

  if (s.state === 'indexing') {
    wrap.classList.remove('hidden');
    const pct = s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
    bar.style.width = pct + '%';
    text.textContent = s.total > 0
      ? `${s.processed} / ${s.total}  ${s.currentFile ? '— ' + s.currentFile : ''}`
      : (s.currentFile || '走査中...');
  } else {
    wrap.classList.add('hidden');
  }
}

function updateIndexButtons(indexing) {
  document.getElementById('btn-update').disabled  = indexing;
  document.getElementById('btn-rebuild').disabled = indexing;
  document.getElementById('btn-cancel').disabled  = !indexing;
}

function showIndexError(msg) {
  const el = document.getElementById('index-error');
  el.textContent = 'エラー: ' + msg;
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
    el.textContent = 'エラー: ' + err.message;
    el.classList.remove('hidden');
  } finally {
    document.getElementById('search-spinner').classList.add('hidden');
    document.getElementById('btn-search').disabled = false;
  }
});

function renderAnswer({ answer, citations }) {
  // Normalize 【N】→[N] so citation linking works regardless of bracket style
  const normalized = answer.replace(/【(\d+)】/g, '[$1]');

  // Insert cite anchors as placeholder tokens before Markdown rendering,
  // then restore them after, so marked doesn't escape the HTML.
  const PLACEHOLDER = '\x00CITE$1\x00';
  const withPlaceholders = normalized.replace(/\[(\d+)\]/g, PLACEHOLDER);

  // Render Markdown → HTML
  let html = typeof marked !== 'undefined'
    ? marked.parse(withPlaceholders)
    : withPlaceholders.replace(/\n/g, '<br>');

  // Replace placeholders with clickable links
  html = html.replace(/\x00CITE(\d+)\x00/g, (_, n) => {
    const c = citations.find((x) => x.n === Number(n));
    if (!c) return `[${n}]`;
    return `<a class="cite-link" href="#cite-${n}" title="${esc(c.path)}">[${n}]</a>`;
  });

  document.getElementById('answer-text').innerHTML = html;

  const citSection = document.getElementById('citations-section');
  const citList    = document.getElementById('citation-list');

  if (citations.length > 0) {
    // Use data-path attribute to avoid inline onclick quoting issues
    citList.innerHTML = citations.map((c) => `
      <div class="citation-item" id="cite-${c.n}">
        <div class="citation-header">
          <span class="citation-n">[${c.n}]</span>
          <span class="citation-path">${esc(c.path)}</span>
          <span class="citation-score">score: ${c.score}</span>
          <button class="btn-open btn-link" data-path="${esc(c.path)}">開く</button>
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

// Event delegation for open buttons (avoids inline onclick quoting issues)
document.getElementById('citation-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-path]');
  if (btn) openFile(btn.dataset.path);
});

async function openFile(path) {
  try {
    await api('GET', '/open?path=' + encodeURIComponent(path));
  } catch (err) {
    alert('ファイルを開けませんでした: ' + err.message);
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

// ---------- Init ----------

loadWorkspaces();
// Resume progress poll if server was already indexing
pollStatus();
