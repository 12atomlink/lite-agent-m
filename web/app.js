const API = ''

let currentSessionId = null
let currentSessionDir = null
let currentSSE = null

// ── DOM refs ──────────────────────────────────────────────
const sessionList = document.getElementById('session-list')
const messages    = document.getElementById('messages')
const chatTitle   = document.getElementById('chat-title')
const chatDir     = document.getElementById('chat-dir')
const input       = document.getElementById('input')
const btnSend     = document.getElementById('btn-send')
const btnAbort    = document.getElementById('btn-abort')
const btnNew      = document.getElementById('btn-new')

// ── API helpers ───────────────────────────────────────────
async function api(method, path, body) {
  const dir = currentSessionDir
  const sep = path.includes('?') ? '&' : '?'
  const url = API + path + (dir ? sep + 'directory=' + encodeURIComponent(dir) : '')
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204 || res.headers.get('content-length') === '0') return null
  return res.json()
}

// ── Sessions ──────────────────────────────────────────────
async function loadSessions() {
  const sessions = await api('GET', '/session')
  sessionList.innerHTML = ''
  const roots = sessions.filter(s => !s.parentID)
  const byParent = {}
  for (const s of sessions) {
    if (s.parentID) (byParent[s.parentID] = byParent[s.parentID] || []).push(s)
  }
  function renderSession(s, indent) {
    const el = document.createElement('div')
    el.className = 'session-item' + (s.id === currentSessionId ? ' active' : '') + (indent ? ' child' : '')
    el.textContent = (indent ? '↳ ' : '') + (s.title || s.id.slice(0, 8))
    el.dataset.id = s.id
    el.onclick = () => selectSession(s.id, s.title || s.id.slice(0, 8), s.directory)
    sessionList.appendChild(el)
    for (const child of byParent[s.id] || []) renderSession(child, true)
  }
  for (const s of roots) renderSession(s, false)
}

async function selectSession(id, title, directory) {
  currentSessionId = id
  currentSessionDir = directory || null
  chatTitle.textContent = title
  chatDir.textContent = directory || ''
  // reset busy state (fix 2.7)
  setStatus({ type: 'idle' })
  document.querySelectorAll('.session-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id))
  connectSSE()
  await loadMessages(id)
  await loadPendingInteractions(id).catch(() => {})
}

btnNew.onclick = async () => {
  const dir = prompt('工作目录（留空用默认）', '')
  const url = dir ? API + '/session?directory=' + encodeURIComponent(dir) : API + '/session'
  const s = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json())
  await loadSessions()
  await selectSession(s.id, s.title || s.id.slice(0, 8), s.directory)
}

// ── Messages ──────────────────────────────────────────────
async function loadMessages(sessionId) {
  messages.innerHTML = ''
  const data = await api('GET', `/session/${sessionId}/message`)
  for (const msg of data) {
    const info = msg.info || msg
    const parts = msg.parts || []
    if (!info.role || info.role === 'tool') continue
    ensureMessageContainer(info)
    if (info.role === 'user') {
      const text = parts.filter(p => p.type === 'text').map(p => p.text).join('')
      const el = messages.querySelector(`[data-id="${info.id}"]`)
      if (el) el.textContent = text
    } else {
      for (const part of parts) upsertPart(info.id, part)
    }
  }
  scrollBottom()
}

function ensureMessageContainer(info) {
  if (messages.querySelector(`[data-id="${info.id}"]`)) return
  const el = document.createElement('div')
  el.className = `msg ${info.role}`
  el.dataset.id = info.id
  messages.appendChild(el)
}

function upsertMessage(event) {
  const info = event.info || event
  if (!info.role || info.role === 'tool') return
  ensureMessageContainer(info)
  if (info.error) {
    const el = messages.querySelector(`[data-id="${info.id}"]`)
    if (el) el.dataset.error = info.error.message || 'error'
  }
}

function upsertPart(messageId, part) {
  const container = messages.querySelector(`[data-id="${messageId}"]`)
  if (!container) return
  const existing = container.querySelector(`[data-part-id="${part.id}"]`)
  if (existing) {
    updatePartEl(existing, part)
  } else {
    const el = createPartEl(part)
    if (el) container.appendChild(el)
  }
}

// ── Delta flush (throttle DOM updates) ───────────────────
const pendingDeltas = new Map() // partId -> { el, text }
let flushTimer = null

function scheduleDeltaFlush() {
  if (flushTimer) return
  flushTimer = requestAnimationFrame(() => {
    flushTimer = null
    for (const [, { el, text }] of pendingDeltas) {
      el.textContent = text
    }
    pendingDeltas.clear()
    scrollBottom()
  })
}

function applyPartDelta(messageId, partId, field, delta) {
  const container = messages.querySelector(`[data-id="${messageId}"]`)
  if (!container) return
  let el = container.querySelector(`[data-part-id="${partId}"]`)
  if (!el) {
    el = document.createElement('div')
    el.dataset.partId = partId
    el.className = 'part-text'
    el.dataset.raw = ''
    container.appendChild(el)
  }
  if (el.classList.contains('part-text')) {
    el.dataset.raw = (el.dataset.raw || '') + delta
    pendingDeltas.set(partId, { el, text: el.dataset.raw })
    scheduleDeltaFlush()
  } else {
    const target = el.querySelector('[data-delta]')
    if (target) target.textContent += delta
  }
}

function createPartEl(part) {
  const el = document.createElement('div')
  el.dataset.partId = part.id
  updatePartEl(el, part)
  return el.children.length || el.textContent ? el : null
}

function updatePartEl(el, part) {
  if (part.type === 'text') {
    el.className = 'part-text'
    el.innerHTML = marked.parse(part.text || '')
    el.dataset.delta = ''
  } else if (part.type === 'reasoning') {
    const text = part.text || ''
    if (!text || text.includes('[REDACTED]')) return
    el.className = 'part-reasoning'
    el.innerHTML = `<div class="reasoning-label">Thinking</div><pre data-delta>${escHtml(text)}</pre>`
  } else if (part.type === 'tool') {
    renderToolPart(el, part)
  } else if (part.type === 'patch') {
    el.className = 'part-patch'
    el.textContent = (part.files || []).join('  ')
  } else if (part.type === 'step-finish') {
    el.className = 'part-step-finish'
    const t = part.tokens || {}
    el.textContent = `tokens: ${(t.input||0)+(t.output||0)}  cost: $${(part.cost||0).toFixed(4)}`
  }
}

function renderToolPart(el, part) {
  const state = part.state || {}
  const status = state.status || 'pending'
  const toolName = part.tool || 'tool'

  // task tool — special subagent rendering
  if (toolName === 'task') {
    el.className = `part-tool task ${status}`
    if (status === 'pending' || status === 'running') {
      const subtitle = state.title ? ` · ${escHtml(state.title)}` : ''
      el.innerHTML = `<div class="task-running">↳ Subagent running${subtitle}<span class="spinner"></span></div>`
    } else if (status === 'completed') {
      const start = state.time?.start || 0
      const end = state.time?.end || 0
      const dur = end && start ? formatDuration(end - start) : ''
      const sessionId = state.metadata?.sessionId || part.metadata?.sessionId
      el.innerHTML = `<div class="task-done">└ Subagent completed${dur ? ' · ' + dur : ''}${sessionId ? ` <a class="task-link" data-session="${escHtml(sessionId)}">view</a>` : ''}</div>`
      const link = el.querySelector('.task-link')
      if (link) link.onclick = async () => {
        const sid = link.dataset.session
        const s = await api('GET', `/session/${sid}`)
        if (s) selectSession(s.id, s.title || s.id.slice(0, 8), s.directory)
      }
    } else {
      el.innerHTML = `<div class="task-error">✗ Subagent failed: ${escHtml(state.error || 'error')}</div>`
    }
    return
  }

  // todowrite tool — render todo list
  if (toolName === 'todowrite' && status === 'completed') {
    const todos = state.metadata?.todos || part.metadata?.todos || []
    if (todos.length) {
      el.className = 'part-tool todo-list completed'
      const items = todos.map(t => {
        const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '•' : ' '
        const cls = t.status === 'in_progress' ? 'todo-inprogress' : 'todo-other'
        return `<div class="todo-item ${cls}"><span class="todo-mark">[${mark}]</span> ${escHtml(t.content)}</div>`
      }).join('')
      el.innerHTML = `<div class="todo-title">Todos</div>${items}`
      return
    }
  }

  // generic tool
  el.className = `part-tool ${status}`
  const label = state.title || toolName
  if (status === 'pending' || status === 'running') {
    el.innerHTML = `<div>▶ ${escHtml(label)}</div>`
  } else if (status === 'completed') {
    el.innerHTML = `<details><summary>✓ ${escHtml(label)}</summary><pre>${escHtml(String(state.output || ''))}</pre></details>`
  } else {
    el.innerHTML = `<div>✗ ${escHtml(toolName)}: ${escHtml(state.error || 'error')}</div>`
  }
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's'
}

function renderMessage(msg) {
  const info = msg.info || msg
  const parts = msg.parts || []
  if (!info.role || info.role === 'tool') return
  ensureMessageContainer(info)
  if (info.role === 'user') {
    const text = parts.filter(p => p.type === 'text').map(p => p.text).join('')
    const el = messages.querySelector(`[data-id="${info.id}"]`)
    if (el) el.textContent = text
  } else {
    for (const part of parts) upsertPart(info.id, part)
  }
}

function scrollBottom() { messages.scrollTop = messages.scrollHeight }

// ── Send message (async, fix 2.1) ─────────────────────────
async function sendMessage() {
  const text = input.value.trim()
  if (!text || btnSend.disabled) return

  if (!currentSessionId) {
    const s = await api('POST', '/session', {})
    await loadSessions()
    await selectSession(s.id, s.title || s.id.slice(0, 8))
  }

  input.value = ''
  const dir = currentSessionDir
  const url = API + `/session/${currentSessionId}/prompt_async` + (dir ? '?directory=' + encodeURIComponent(dir) : '')
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text }] }),
  })
  // UI updates driven by SSE session.status + message.updated
}

btnSend.onclick = sendMessage
btnAbort.onclick = async () => {
  if (currentSessionId) await api('POST', `/session/${currentSessionId}/abort`, {})
}
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
})

// ── Session status (fix 2.8) ──────────────────────────────
function setStatus(status) {
  if (status.type === 'busy') {
    btnSend.disabled = true
    btnAbort.classList.remove('hidden')
  } else {
    btnSend.disabled = false
    btnAbort.classList.add('hidden')
  }
}

// ── SSE events ────────────────────────────────────────────
function connectSSE() {
  if (currentSSE) { currentSSE.close(); currentSSE = null }
  const dir = currentSessionDir
  const url = API + '/event' + (dir ? '?directory=' + encodeURIComponent(dir) : '')
  const es = new EventSource(url)
  es.onmessage = e => { try { handleBusEvent(JSON.parse(e.data)) } catch {} }
  es.onerror = () => { es.close(); currentSSE = null; setTimeout(connectSSE, 3000) }
  currentSSE = es
}

function handleBusEvent(event) {
  if (!event?.type) return
  if (event.type === 'session.updated') loadSessions()
  if (event.type === 'session.status' && event.properties?.sessionID === currentSessionId)
    setStatus(event.properties.status)
  if (event.type === 'message.updated' && event.properties?.info?.sessionID === currentSessionId)
    upsertMessage(event.properties)
  if (event.type === 'message.part.updated' && event.properties?.part?.sessionID === currentSessionId)
    upsertPart(event.properties.part.messageID, event.properties.part)
  if (event.type === 'message.part.delta' && event.properties?.sessionID === currentSessionId)
    applyPartDelta(event.properties.messageID, event.properties.partID, event.properties.field, event.properties.delta)
  if (event.type === 'permission.asked' && event.properties?.sessionID === currentSessionId)
    renderPermissionCard(event.properties)
  if (event.type === 'question.asked' && event.properties?.sessionID === currentSessionId)
    renderQuestionCard(event.properties)
}

// ── Interaction cards (fix 2.3/2.4/2.5/2.6/2.9) ──────────
async function loadPendingInteractions(sessionId) {
  const [perms, questions] = await Promise.all([
    api('GET', '/permission'),
    api('GET', '/question'),
  ])
  for (const p of perms.filter(p => p.sessionID === sessionId)) renderPermissionCard(p)
  for (const q of questions.filter(q => q.sessionID === sessionId)) renderQuestionCard(q)
}

function renderPermissionCard(req) {
  if (messages.querySelector(`[data-req-id="${req.id}"]`)) return
  const card = document.createElement('div')
  card.className = 'interaction-card'
  card.dataset.reqId = req.id
  const body = req.metadata?.description || JSON.stringify(req.metadata, null, 2)
  card.innerHTML = `<div class="card-title">Permission Request</div>
    <pre class="card-body">${escHtml(body)}</pre>
    <div class="card-actions">
      <button onclick="replyPermission('${req.id}','once')">Allow Once</button>
      <button onclick="replyPermission('${req.id}','always')">Always Allow</button>
      <button class="deny" onclick="replyPermission('${req.id}','reject')">Deny</button>
    </div>`
  messages.appendChild(card)
  scrollBottom()
}

function renderQuestionCard(req) {
  if (messages.querySelector(`[data-req-id="${req.id}"]`)) return
  const card = document.createElement('div')
  card.className = 'interaction-card'
  card.dataset.reqId = req.id
  const inner = req.questions.map((q, i) => {
    const btns = q.options.map(opt => {
      const btn = document.createElement('button')
      btn.textContent = opt.label
      btn.onclick = () => replyQuestion(req.id, i, opt.label, req.questions.length)
      return btn.outerHTML
    }).join('')
    return `<div class="card-title">${escHtml(q.header)}</div>
      <div class="card-body">${escHtml(q.question)}</div>
      <div class="card-actions">${btns}</div>`
  }).join('')
  card.innerHTML = inner
  // re-attach onclick handlers safely
  req.questions.forEach((q, i) => {
    const actions = card.querySelectorAll('.card-actions')[i]
    q.options.forEach((opt, j) => {
      actions.children[j].onclick = () => replyQuestion(req.id, i, opt.label, req.questions.length)
    })
  })
  messages.appendChild(card)
  scrollBottom()
}

async function replyPermission(id, reply) {
  await api('POST', `/permission/${id}/reply`, { reply })
  document.querySelector(`[data-req-id="${id}"]`)?.remove()
}

async function replyQuestion(id, questionIndex, label, totalQuestions) {
  const answers = Array.from({ length: totalQuestions }, (_, i) => i === questionIndex ? [label] : [])
  await api('POST', `/question/${id}/reply`, { answers })
  document.querySelector(`[data-req-id="${id}"]`)?.remove()
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Init ──────────────────────────────────────────────────
loadSessions()
connectSSE()
