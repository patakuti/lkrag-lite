/* lkrag-lite frontend */

// ---------- API helpers ----------

async function api(method, path, body) {
  // Non-simple header: forces a CORS preflight for any cross-origin caller,
  // which this server never answers with Access-Control-Allow-* — so a
  // malicious page cannot reach the admin API even via a plain fetch (CSRF).
  const opts = { method, headers: { 'X-Lkragl-Client': '1' } };
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
  updateChatTitle();
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

function updateChatTitle() {
  const active = workspaces.find((ws) => ws.is_active);
  const el = document.getElementById('chat-title');
  if (currentSessionDeleted) {
    el.textContent = 'Workspace deleted — RAG unavailable (chat history only)';
    el.classList.add('warn');
  } else {
    el.textContent = active ? active.name : 'Select a workspace to start chatting';
    el.classList.remove('warn');
  }
}

document.getElementById('ws-select').addEventListener('change', async (e) => {
  if (isUpdatingDropdown) return;
  const id = Number(e.target.value);
  await api('PUT', `/workspaces/${id}/activate`);
  workspaces = await api('GET', '/workspaces');
  updateChatTitle();
  clearChat();
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
    updateChatTitle();
    clearChat();
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
    const nameParts = data.current.split(/[\\/]/);
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

// ---------- Chat History ----------

let currentSessionId = null;
let currentSessionDeleted = false; // true when resumed session's workspace is deleted
let chatSessions = [];

async function loadChatHistory() {
  try {
    chatSessions = await api('GET', '/chats');
    renderChatHistory();
  } catch (_) { /* ignore */ }
}

function renderChatHistory() {
  const list = document.getElementById('chat-history-list');
  if (chatSessions.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = chatSessions.map((s) => {
    const isActive = s.id === currentSessionId;
    const wsLabel = s.workspace_name
      ? `<span class="history-item-ws">${esc(s.workspace_name)}</span>`
      : `<span class="history-item-ws deleted">deleted</span>`;
    const date = formatHistoryDate(s.updated_at);
    return `
      <div class="history-item${isActive ? ' active' : ''}" data-id="${esc(s.id)}">
        <span class="history-item-title" title="${esc(s.title)}">${esc(s.title)}</span>
        ${wsLabel}
        <span class="history-item-date">${date}</span>
        <button class="btn-delete-chat" data-id="${esc(s.id)}" title="Delete">×</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-chat')) return;
      resumeChat(el.dataset.id);
    });
  });

  list.querySelectorAll('.btn-delete-chat').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSingleChat(btn.dataset.id);
    });
  });
}

function formatHistoryDate(unixMs) {
  const d = new Date(unixMs);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function resumeChat(sessionId) {
  try {
    const { session, messages } = await api('GET', `/chats/${sessionId}`);
    currentSessionId = sessionId;

    // Switch workspace if needed (skip if workspace was deleted)
    const wsDeleted = session.workspace_id != null && session.workspace_name == null;
    currentSessionDeleted = wsDeleted;
    if (!wsDeleted && session.workspace_id != null) {
      const active = workspaces.find((w) => w.is_active);
      if (!active || active.id !== session.workspace_id) {
        await api('PUT', `/workspaces/${session.workspace_id}/activate`);
        workspaces = await api('GET', '/workspaces');
        renderWorkspaceDropdown();
        await loadIndexStats();
      }
    }

    // Rebuild chat thread from stored messages
    chatHistory = [];
    turnCounter = 0;
    document.getElementById('chat-thread').innerHTML = '';

    for (const msg of messages) {
      if (msg.role === 'user') {
        appendUserBubble(msg.content);
        chatHistory.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const citations = msg.citations ? JSON.parse(msg.citations) : [];
        appendAIBubble({ answer: msg.content, citations, rewriterFallback: false });
        chatHistory.push({ role: 'assistant', content: msg.content });
      }
    }

    updateChatTitle();
    renderChatHistory();
  } catch (err) {
    alert('Failed to load chat: ' + err.message);
  }
}

async function deleteSingleChat(sessionId) {
  await api('DELETE', `/chats/${sessionId}`);
  if (currentSessionId === sessionId) {
    currentSessionId = null;
    clearChat();
  }
  await loadChatHistory();
}

document.getElementById('btn-delete-all-chats').addEventListener('click', async () => {
  if (!confirm('Delete all chat history?')) return;
  await api('DELETE', '/chats');
  currentSessionId = null;
  clearChat();
  await loadChatHistory();
});

// ---------- Chat ----------

/** Each entry: { role: 'user'|'assistant', content: string } */
let chatHistory = [];
let turnCounter = 0;
const turnData = new Map(); // tid → { userQuery, answer, citations }
let pendingUserQuery = null;

function clearChat() {
  chatHistory = [];
  turnCounter = 0;
  turnData.clear();
  pendingUserQuery = null;
  currentSessionId = null;
  currentSessionDeleted = false;
  document.getElementById('chat-thread').innerHTML = '';
  updateChatTitle();
  renderChatHistory();
}

document.getElementById('btn-new-chat').addEventListener('click', () => {
  clearChat();
});

document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('search-query').value.trim();
  if (!query) return;

  const errorEl = document.getElementById('search-error');
  errorEl.classList.add('hidden');

  const btnSearch = document.getElementById('btn-search');
  btnSearch.disabled = true;
  document.getElementById('search-query').value = '';

  appendUserBubble(query);
  const thinkingEl = appendThinking();

  try {
    // Create session on first message
    if (!currentSessionId) {
      const active = workspaces.find((w) => w.is_active);
      const session = await api('POST', '/chats', {
        workspace_id: active ? active.id : null,
        title: query.length > 60 ? query.slice(0, 60) + '…' : query,
      });
      currentSessionId = session.id;
    }

    const result = await api('POST', '/search', {
      query,
      history: chatHistory,
      session_id: currentSessionId,
      skip_rag: currentSessionDeleted || undefined,
    });

    thinkingEl.remove();
    appendAIBubble(result);

    chatHistory.push({ role: 'user', content: query });
    chatHistory.push({ role: 'assistant', content: result.answer });

    await loadChatHistory();
  } catch (err) {
    thinkingEl.remove();
    errorEl.textContent = 'Error: ' + err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btnSearch.disabled = false;
    document.getElementById('search-query').focus();
  }
});

function appendUserBubble(text) {
  pendingUserQuery = text;
  const thread = document.getElementById('chat-thread');
  const turn = document.createElement('div');
  turn.className = 'chat-turn';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-user';
  bubble.textContent = text;
  turn.appendChild(bubble);
  thread.appendChild(turn);
  scrollChatToBottom();
}

function appendThinking() {
  const thread = document.getElementById('chat-thread');
  const el = document.createElement('div');
  el.className = 'chat-thinking';
  el.textContent = 'Thinking...';
  thread.appendChild(el);
  scrollChatToBottom();
  return el;
}

function appendAIBubble({ answer, citations, rewriterFallback }) {
  const tid = ++turnCounter;
  turnData.set(tid, { userQuery: pendingUserQuery, answer, citations });
  pendingUserQuery = null;
  const thread = document.getElementById('chat-thread');
  const turn = document.createElement('div');
  turn.className = 'chat-turn';

  if (rewriterFallback) {
    const notice = document.createElement('div');
    notice.className = 'rewriter-fallback-notice';
    notice.textContent = '⚠ Query rewriter unavailable — used original input for search';
    turn.appendChild(notice);
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-ai';
  bubble.innerHTML = renderMarkdownWithCitations(answer, citations, tid);
  turn.appendChild(bubble);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-copy-turn btn-link';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => copyToClipboard(turnToMarkdown(tid), copyBtn));
  turn.appendChild(copyBtn);

  if (citations.length > 0) {
    const details = document.createElement('details');
    details.className = 'chat-citations';
    const summary = document.createElement('summary');
    summary.textContent = `References (${citations.length})`;
    details.appendChild(summary);

    const inner = document.createElement('div');
    inner.className = 'chat-citations-inner';
    inner.innerHTML = citations.map((c) => `
      <div class="citation-item" id="cite-${tid}-${c.n}">
        <div class="citation-header">
          <span class="citation-n">[${c.n}]</span>
          <span class="citation-path">${esc(c.path)}</span>
          <span class="citation-score">score: ${c.score}</span>
          <button class="btn-open btn-link" data-path="${esc(c.path)}">Open</button>
          <button class="btn-copy-path btn-link" data-path="${esc(c.absolutePath)}">Copy</button>
        </div>
        <div class="citation-snippet">"${esc(c.snippet)}"</div>
      </div>
    `).join('');

    inner.querySelectorAll('.btn-open').forEach((btn) => {
      btn.addEventListener('click', () => openFile(btn.dataset.path));
    });

    inner.querySelectorAll('.btn-copy-path').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.path).then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });

    details.appendChild(inner);
    turn.appendChild(details);
  }

  thread.appendChild(turn);
  scrollChatToBottom();
}

function renderMarkdownWithCitations(answer, citations, tid) {
  const normalized = answer.replace(/【(\d+)】/g, '[$1]');

  const PLACEHOLDER = '\x00CITE$1\x00';
  const withPlaceholders = normalized.replace(/\[(\d+)\]/g, PLACEHOLDER);

  let html = typeof marked !== 'undefined'
    ? marked.parse(withPlaceholders)
    : withPlaceholders.replace(/\n/g, '<br>');

  html = html.replace(/\x00CITE(\d+)\x00/g, (_, n) => {
    const c = citations.find((x) => x.n === Number(n));
    if (!c) return `[${n}]`;
    return `<a class="cite-link" href="#cite-${tid}-${n}" title="${esc(c.path)}">[${n}]</a>`;
  });

  return html;
}

function scrollChatToBottom() {
  const thread = document.getElementById('chat-thread');
  thread.scrollTop = thread.scrollHeight;
}

async function openFile(path) {
  try {
    await api('GET', '/open?path=' + encodeURIComponent(path));
  } catch (err) {
    alert('Could not open file: ' + err.message);
  }
}

// ---------- Copy to Clipboard ----------

function turnToMarkdown(tid) {
  const data = turnData.get(tid);
  if (!data) return '';
  let md = `**You:** ${data.userQuery || ''}\n\n`;
  md += `**Assistant:**\n${data.answer}`;
  if (data.citations && data.citations.length > 0) {
    md += '\n\n**References:**\n';
    data.citations.forEach((c) => {
      const absPath = c.absolutePath.replace(/\\/g, '/');
      const fileUrl = absPath.startsWith('/') ? `file://${absPath}` : `file:///${absPath}`;
      md += `- [${c.n}] [${c.path}](${fileUrl}) (score: ${c.score})\n  > "${c.snippet}"\n`;
    });
  }
  return md;
}

function allToMarkdown() {
  const sorted = [...turnData.keys()].sort((a, b) => a - b);
  return sorted.map((tid) => turnToMarkdown(tid)).join('\n\n---\n\n');
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (_) {
    alert('Failed to copy to clipboard.');
  }
}

document.getElementById('btn-copy-all').addEventListener('click', (e) => {
  const text = allToMarkdown();
  if (!text) return;
  copyToClipboard(text, e.currentTarget);
});

// ---------- Util ----------

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Settings modal ----------

function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
  document.getElementById('settings-status').classList.add('hidden');
}

document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
document.getElementById('btn-settings-close').addEventListener('click', closeSettingsModal);
document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettingsModal();
});

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
loadChatHistory();
pollStatus();
