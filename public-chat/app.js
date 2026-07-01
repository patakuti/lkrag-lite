/* lkrag-lite public chat frontend (read-only, token-scoped) */

// ---------- API helper ----------

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function showFatalBanner(msg) {
  const el = document.getElementById('chat-error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
  document.getElementById('btn-search').disabled = true;
  document.getElementById('search-query').disabled = true;
}

// ---------- Header ----------

async function loadWhoami() {
  try {
    const who = await api('GET', '/whoami');
    document.getElementById('chat-title').textContent =
      who.workspaceName ? `lkrag-lite — ${who.workspaceName}` : 'lkrag-lite';
  } catch (err) {
    showFatalBanner('Access error: ' + err.message);
  }
}

// ---------- Chat history ----------

let currentSessionId = null;

async function loadChatHistory() {
  try {
    const sessions = await api('GET', '/chats');
    renderChatHistory(sessions);
  } catch (_) { /* ignore */ }
}

function renderChatHistory(sessions) {
  const list = document.getElementById('chat-history-list');
  if (!sessions || sessions.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = sessions.map((s) => {
    const isActive = s.id === currentSessionId;
    const date = formatHistoryDate(s.updated_at);
    return `
      <div class="history-item${isActive ? ' active' : ''}" data-id="${esc(s.id)}">
        <span class="history-item-title" title="${esc(s.title)}">${esc(s.title)}</span>
        <span class="history-item-date">${date}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', () => resumeChat(el.dataset.id));
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
    const { messages } = await api('GET', `/chats/${sessionId}`);
    currentSessionId = sessionId;

    chatHistory = [];
    turnCounter = 0;
    turnData.clear();
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

    await loadChatHistory();
  } catch (err) {
    alert('Failed to load chat: ' + err.message);
  }
}

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
  document.getElementById('chat-thread').innerHTML = '';
  loadChatHistory();
}

document.getElementById('btn-new-chat').addEventListener('click', clearChat);

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
    const result = await api('POST', '/chat', {
      query,
      history: chatHistory,
      session_id: currentSessionId,
    });

    currentSessionId = result.session_id;

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
        </div>
        <div class="citation-snippet">"${esc(c.snippet)}"</div>
        <div class="citation-links">
          <a href="/api/file?path=${encodeURIComponent(c.path)}" target="_blank" rel="noopener">View</a>
          <a href="/api/file?path=${encodeURIComponent(c.path)}&download=1">Download</a>
        </div>
      </div>
    `).join('');

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

// ---------- Copy to Clipboard ----------

function turnToMarkdown(tid) {
  const data = turnData.get(tid);
  if (!data) return '';
  let md = `**You:** ${data.userQuery || ''}\n\n`;
  md += `**Assistant:**\n${data.answer}`;
  if (data.citations && data.citations.length > 0) {
    md += '\n\n**References:**\n';
    data.citations.forEach((c) => {
      md += `- [${c.n}] ${c.path} (score: ${c.score})\n  > "${c.snippet}"\n`;
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

// ---------- Init ----------

loadWhoami();
loadChatHistory();
