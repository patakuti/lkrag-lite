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

async function deleteSingleChat(sessionId) {
  await api('DELETE', `/chats/${sessionId}`);
  if (currentSessionId === sessionId) {
    clearChat();
  } else {
    await loadChatHistory();
  }
}

document.getElementById('btn-delete-all-chats').addEventListener('click', async () => {
  if (!confirm('Delete all of your chat history?')) return;
  await api('DELETE', '/chats');
  clearChat();
});

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

    // Tags are not stored with citations (they can change later); look up the current ones.
    const fileTags = await lookupFileTags(
      messages.flatMap((m) => (m.role === 'assistant' && m.citations ? JSON.parse(m.citations).map((c) => c.path) : []))
    );

    chatHistory = [];
    turnCounter = 0;
    turnData.clear();
    document.getElementById('chat-thread').innerHTML = '';

    let lastFilter = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        lastFilter = msg.filter_tags ? JSON.parse(msg.filter_tags) : [];
        appendUserBubble(msg.content, lastFilter);
        chatHistory.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const citations = msg.citations ? JSON.parse(msg.citations) : [];
        appendAIBubble({ answer: msg.content, citations, rewriterFallback: false, fileTags });
        chatHistory.push({ role: 'assistant', content: msg.content });
      }
    }

    // The filter of the last question stays in effect when the chat is continued
    activeTags = lastFilter;
    renderTagFilter();

    await loadChatHistory();
  } catch (err) {
    alert('Failed to load chat: ' + err.message);
  }
}

// ---------- Chat ----------

/** Each entry: { role: 'user'|'assistant', content: string } */
let chatHistory = [];
let turnCounter = 0;
const turnData = new Map(); // tid → { userQuery, answer, citations, fileTags, filterTags }
let pendingUserQuery = null;
let pendingFilterTags = [];

function clearChat() {
  chatHistory = [];
  turnCounter = 0;
  turnData.clear();
  pendingUserQuery = null;
  pendingFilterTags = [];
  activeTags = [];
  renderTagFilter();
  currentSessionId = null;
  document.getElementById('chat-thread').innerHTML = '';
  loadChatHistory();
}

document.getElementById('btn-new-chat').addEventListener('click', clearChat);

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = document.getElementById('search-query').value.trim();
  if (!query || sending) return;
  document.getElementById('search-query').value = '';
  sendQuery(query);
});

// Sends one question as a new turn, applying the current tag filter.
async function sendQuery(query) {
  if (sending) return;
  sending = true;

  const errorEl = document.getElementById('search-error');
  errorEl.classList.add('hidden');

  const btnSearch = document.getElementById('btn-search');
  btnSearch.disabled = true;

  const tags = [...activeTags];
  appendUserBubble(query, tags);
  const thinkingEl = appendThinking();

  try {
    const result = await api('POST', '/chat', {
      query,
      history: chatHistory,
      session_id: currentSessionId,
      tags: tags.length > 0 ? tags : undefined,
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
    sending = false;
    btnSearch.disabled = false;
    document.getElementById('search-query').focus();
  }
}

function appendUserBubble(text, tags = []) {
  pendingUserQuery = text;
  pendingFilterTags = tags;
  const thread = document.getElementById('chat-thread');
  const turn = document.createElement('div');
  turn.className = 'chat-turn';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-user';
  bubble.textContent = text;
  if (tags.length > 0) {
    const tagBox = document.createElement('div');
    tagBox.className = 'bubble-tags';
    tagBox.innerHTML = tags.map((t) => `<span class="tag-chip">#${esc(t)}</span>`).join('');
    bubble.appendChild(tagBox);
  }
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

function appendAIBubble({ answer, citations, rewriterFallback, fileTags }) {
  const tid = ++turnCounter;
  turnData.set(tid, {
    userQuery: pendingUserQuery, answer, citations,
    fileTags: fileTags || {}, filterTags: pendingFilterTags,
  });
  pendingUserQuery = null;
  pendingFilterTags = [];
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

  const related = document.createElement('div');
  related.className = 'related-tags';
  turn.appendChild(related);
  renderRelatedTags(tid, related);

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
        ${citationTagsHtml(turnData.get(tid).fileTags[c.path])}
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

// ---------- Tags (read-only: display, filter and retry; managed in the admin UI) ----------

/** Tag filter applied to every question of the current chat. */
let activeTags = [];
let sending = false;

function normalizeTagInput(raw) {
  const tag = raw.trim().replace(/^#+/, '').normalize('NFKC').toLowerCase();
  if (!tag || tag.length > 64 || /[\s,#]/.test(tag)) return null;
  return tag;
}

function renderTagFilter() {
  const box = document.getElementById('tag-filter-chips');
  box.innerHTML = activeTags.map((t) =>
    `<span class="tag-chip">#${esc(t)}<button type="button" class="tag-remove" data-tag="${esc(t)}" title="Remove from filter">✕</button></span>`
  ).join('');
  box.querySelectorAll('.tag-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTags = activeTags.filter((t) => t !== btn.dataset.tag);
      renderTagFilter();
    });
  });
}

async function loadTagList() {
  try {
    const tags = await api('GET', '/tags');
    document.getElementById('tag-list').innerHTML =
      tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.count})</option>`).join('');
  } catch (_) {
    // Autocomplete is optional; ignore failures
  }
}

const tagFilterInput = document.getElementById('tag-filter-input');
tagFilterInput.addEventListener('focus', loadTagList);
tagFilterInput.addEventListener('change', () => {
  const tag = normalizeTagInput(tagFilterInput.value);
  tagFilterInput.value = '';
  if (tag && !activeTags.includes(tag)) {
    activeTags.push(tag);
    renderTagFilter();
  }
});

/** Current tags of the given paths, in batches (the server caps one request). */
async function lookupFileTags(paths) {
  const unique = [...new Set(paths)];
  const fileTags = {};
  for (let i = 0; i < unique.length; i += 200) {
    const res = await api('POST', '/tags/lookup', { paths: unique.slice(i, i + 200) });
    Object.assign(fileTags, res.fileTags);
  }
  return fileTags;
}

/** Path-derived tags (ext:/dir:): shown greyed out and left out of "Related tags". */
function isSystemTag(t) {
  return t.sources.every((s) => s === 'system');
}

function citationTagsHtml(tags) {
  if (!tags || tags.length === 0) return '';
  const sorted = [...tags].sort((a, b) => Number(isSystemTag(a)) - Number(isSystemTag(b)));
  return `<div class="citation-tags">${sorted.map((t) =>
    `<span class="tag-chip${isSystemTag(t) ? ' system' : ''}">#${esc(t.name)}</span>`).join('')}</div>`;
}

/** Tags of the cited files by number of files, excluding those already in the turn's filter. */
function relatedTagsOf(data) {
  const counts = new Map();
  for (const path of new Set(data.citations.map((c) => c.path))) {
    for (const t of data.fileTags[path] || []) {
      if (!isSystemTag(t)) counts.set(t.name, (counts.get(t.name) || 0) + 1);
    }
  }
  for (const t of data.filterTags) counts.delete(t);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
}

function renderRelatedTags(tid, el) {
  const data = turnData.get(tid);
  const related = relatedTagsOf(data);
  if (related.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = 'Related tags: ' + related.map(([name, count]) =>
    `<button type="button" class="tag-chip" data-tag="${esc(name)}" title="Ask the same question again, limited to documents with this tag">#${esc(name)} <span class="tag-count">${count}</span></button>`
  ).join('');
  el.querySelectorAll('button.tag-chip').forEach((btn) => {
    btn.addEventListener('click', () => retryWithTag(tid, btn.dataset.tag));
  });
}

/** Adds the tag to the filter and asks the turn's question again as a new turn (the old answer stays). */
function retryWithTag(tid, tag) {
  const data = turnData.get(tid);
  if (sending || !data || !data.userQuery) return;
  if (!activeTags.includes(tag)) activeTags.push(tag);
  renderTagFilter();
  sendQuery(data.userQuery);
}

// ---------- Copy to Clipboard ----------

function turnToMarkdown(tid) {
  const data = turnData.get(tid);
  if (!data) return '';
  let md = `**You:** ${data.userQuery || ''}\n\n`;
  if (data.filterTags && data.filterTags.length > 0) {
    md += `**Tag filter:** ${data.filterTags.map((t) => '#' + t).join(' ')}\n\n`;
  }
  md += `**Assistant:**\n${data.answer}`;
  if (data.citations && data.citations.length > 0) {
    md += '\n\n**References:**\n';
    data.citations.forEach((c) => {
      const tags = (data.fileTags[c.path] || []).map((t) => '#' + t.name).join(' ');
      md += `- [${c.n}] ${c.path} (score: ${c.score})${tags ? ' ' + tags : ''}\n  > "${c.snippet}"\n`;
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
