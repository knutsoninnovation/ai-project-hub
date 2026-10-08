import './board.css'
import { fetchThreads, fetchState, saveState, openThread, newSession, revealFolder } from '../game/api.js'
import * as M from './model.js'
import { demoData } from './demo.js'

/**
 * The project board: every repo your agents have touched, organised into columns you choose,
 * with what needs you pulled to the top.
 *
 * Plain DOM, like the colony's HUD. It shares the colony's API and its state file, so a project
 * hidden on the map is hidden here, a thread marked viewed here stops waving there, and both
 * pages can be open at once — saves go through the same three-way merge.
 */

const POLL_MS = 15000
const DEMO = new URLSearchParams(location.search).has('demo')
const root = document.getElementById('board')

let threads = []
let state = null
let projects = []
let selected = null
let scannedAt = 0
let warnings = []
const filters = { q: '', tag: '', harness: '', showHidden: false }

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The colony's own "Open threads in" setting, so both pages open threads the same way. */
function openIn() {
  try {
    return JSON.parse(localStorage.getItem('botcrossing.settings.v1') || '{}').openIn === 'terminal' ? 'terminal' : 'app'
  } catch {
    return 'app'
  }
}

// ── saving ────────────────────────────────────────────────────────────────────

let saveTimer = 0
let saving = false
let dirty = false
function queueSave(delay = 400) {
  if (DEMO) return
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, delay)
}
async function flush() {
  if (saving) return queueSave(300)
  saving = true
  const sent = state
  try {
    const saved = await saveState(sent)
    // Only adopt a merged copy if nothing changed here while the save was in flight; otherwise
    // the next save carries the newer edits and merges again.
    if (state === sent) {
      state = saved
      dirty = false
    } else queueSave(100)
  } catch (err) {
    toast(err.message || 'Could not save', 'err')
  } finally {
    saving = false
  }
}

function patchMeta(name, patch, { rerenderDrawer = false } = {}) {
  state = M.withMeta(state, name, patch)
  queueSave()
  recompute()
  renderMain()
  if (rerenderDrawer) renderDrawer()
}

// ── data ──────────────────────────────────────────────────────────────────────

function recompute() {
  projects = M.buildProjects(threads, state)
}

async function poll() {
  if (DEMO) return
  try {
    const res = await fetchThreads()
    threads = res.threads || []
    warnings = res.warnings || []
    scannedAt = res.scannedAt || Date.now()
    recompute()
    renderMain()
    renderDrawerThreads()
  } catch (err) {
    toast(err.message || 'Scan failed', 'err')
  }
}

// ── layout ────────────────────────────────────────────────────────────────────

root.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo">▦</span> Project Hub</div>
    <input class="search" type="search" placeholder="Search projects, tags, threads  ( / )" aria-label="Search" />
    <select class="f-harness" aria-label="Filter by harness"></select>
    <label class="chk"><input type="checkbox" class="f-hidden" /> Hidden</label>
    <button class="btn primary" id="btn-new">+ Project</button>
    <a class="btn ghost" href="/" title="The 3D colony view">Colony view</a>
  </header>
  <div class="tags"></div>
  <section class="summary"></section>
  <section class="queue"></section>
  <main class="columns"></main>
  <aside class="drawer" aria-hidden="true"></aside>
  <div class="scrim"></div>
  <dialog class="new-dialog">
    <form method="dialog">
      <h3>New project</h3>
      <p class="muted">For something no agent has touched yet. Projects your agents work in appear on their own.</p>
      <label>Name<input name="name" required maxlength="80" placeholder="meeting-copilot" /></label>
      <label>Goal<input name="goal" maxlength="280" placeholder="What does done look like?" /></label>
      <label>Column<select name="status">${M.STATUSES.map((s) => `<option value="${s.id}" ${s.id === 'idea' ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <div class="row end"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div>
    </form>
  </dialog>
  <div class="toasts"></div>
`

const $ = (sel) => root.querySelector(sel)
const drawer = $('.drawer')

$('.search').addEventListener('input', (e) => {
  filters.q = e.target.value
  renderMain()
})
$('.f-harness').addEventListener('change', (e) => {
  filters.harness = e.target.value
  renderMain()
})
$('.f-hidden').addEventListener('change', (e) => {
  filters.showHidden = e.target.checked
  renderMain()
})
$('.tags').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]')
  if (!b) return
  filters.tag = filters.tag === b.dataset.tag ? '' : b.dataset.tag
  renderMain()
})

const dialog = $('.new-dialog')
$('#btn-new').addEventListener('click', () => {
  dialog.querySelector('form').reset()
  dialog.showModal()
})
dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'ok') return
  const f = new FormData(dialog.querySelector('form'))
  const name = String(f.get('name') || '').trim()
  if (!name) return
  if (projects.some((p) => p.name === name)) {
    toast(`${name} is already on the board`)
    select(name)
    return
  }
  patchMeta(name, { goal: String(f.get('goal') || '').trim(), status: String(f.get('status')) })
  select(name)
})

$('.scrim').addEventListener('click', () => select(null))

window.addEventListener('keydown', (e) => {
  const t = e.target
  const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
  if (e.key === 'Escape' && selected && !dialog.open) {
    select(null)
    return
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === '/') {
    e.preventDefault()
    $('.search').focus()
  } else if (e.key === 'n' || e.key === 'N') {
    const first = M.attentionQueue(projects)[0]
    if (first) select(first.projectName)
  }
})

// ── main view ─────────────────────────────────────────────────────────────────

function renderMain() {
  const visible = M.filterProjects(projects, filters)

  const harnesses = M.allHarnesses(projects)
  const hs = $('.f-harness')
  const hsHtml = `<option value="">All harnesses</option>${harnesses.map((h) => `<option ${h === filters.harness ? 'selected' : ''}>${esc(h)}</option>`).join('')}`
  if (hs.dataset.html !== hsHtml) {
    hs.innerHTML = hsHtml
    hs.dataset.html = hsHtml
  }

  const tags = M.allTags(projects)
  $('.tags').innerHTML = tags.length
    ? tags.map((t) => `<button class="tag ${t === filters.tag ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
    : ''

  const live = projects.filter((p) => !p.hidden)
  const sum = (k) => live.reduce((n, p) => n + p.counts[k], 0)
  const stale = scannedAt ? `scanned ${M.ago(scannedAt)}` : DEMO ? 'demo data' : 'scanning…'
  $('.summary').innerHTML = `
    <div class="stat"><b>${live.filter((p) => p.meta.status === 'active').length}</b><span>active projects</span></div>
    <div class="stat"><b>${sum('working')}</b><span>running now</span></div>
    <div class="stat ${sum('waiting') ? 'hot' : ''}"><b>${sum('waiting')}</b><span>need you</span></div>
    <div class="stat ${sum('blocked') ? 'bad' : ''}"><b>${sum('blocked')}</b><span>errored</span></div>
    <div class="meta">${esc(stale)}${warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}</div>`

  const queue = M.attentionQueue(projects)
  $('.queue').innerHTML = queue.length
    ? `<h2>Needs you <span class="muted">· N jumps to the first</span></h2><div class="q-list">${queue
        .slice(0, 12)
        .map(
          (t) => `<button class="q-item ${t.status}" data-project="${esc(t.projectName)}">
            <span class="pill ${t.status}">${M.THREAD_LABEL[t.status]}</span>
            <span class="q-title">${esc(t.title || 'Untitled thread')}</span>
            <span class="muted">${esc(t.projectName)} · ${M.ago(t.lastActivityAt)}</span></button>`
        )
        .join('')}</div>`
    : ''

  $('.columns').innerHTML = M.STATUSES.map((col) => {
    const items = visible.filter((p) => p.meta.status === col.id)
    return `<section class="col" data-status="${col.id}">
      <h3>${col.label} <span class="count">${items.length}</span></h3>
      <div class="cards">${items.map(card).join('') || '<div class="empty">Drop a project here</div>'}</div>
    </section>`
  }).join('')
}

function card(p) {
  const c = p.counts
  const chips = [
    c.working && `<span class="chip working">● ${c.working} running</span>`,
    c.waiting && `<span class="chip waiting">? ${c.waiting} need you</span>`,
    c.blocked && `<span class="chip blocked">! ${c.blocked} errored</span>`,
    c.shipped && `<span class="chip shipped">✓ ${c.shipped} merged</span>`,
  ]
    .filter(Boolean)
    .join('')
  const total = p.threads.length
  return `<article class="card prio-${p.meta.priority} ${selected === p.name ? 'sel' : ''} ${p.hidden ? 'is-hidden' : ''}" draggable="true" data-project="${esc(p.name)}" tabindex="0">
    <div class="c-head">
      <span class="c-name">${p.meta.pinned ? '<span class="pin" title="Pinned">★</span>' : ''}${esc(p.name)}</span>
      ${p.meta.priority === 1 ? '<span class="prio">High</span>' : ''}
    </div>
    ${p.meta.goal ? `<p class="goal">${esc(p.meta.goal)}</p>` : ''}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    <div class="c-foot">
      <span>${total ? `${total} thread${total === 1 ? '' : 's'}` : 'No threads yet'}${p.lastActivityAt ? ` · ${M.ago(p.lastActivityAt)}` : ''}</span>
      <span class="hs">${p.harnesses.map(esc).join(', ')}</span>
    </div>
    ${p.meta.tags.length ? `<div class="c-tags">${p.meta.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
  </article>`
}

// Card clicks, keyboard, and drag between columns — delegated, so re-renders cost nothing.
const columns = $('.columns')
columns.addEventListener('click', (e) => {
  const c = e.target.closest('.card')
  if (c) select(c.dataset.project)
})
columns.addEventListener('keydown', (e) => {
  const c = e.target.closest('.card')
  if (c && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    select(c.dataset.project)
  }
})
$('.queue').addEventListener('click', (e) => {
  const b = e.target.closest('[data-project]')
  if (b) select(b.dataset.project)
})
columns.addEventListener('dragstart', (e) => {
  const c = e.target.closest('.card')
  if (!c) return
  e.dataTransfer.setData('text/plain', c.dataset.project)
  e.dataTransfer.effectAllowed = 'move'
  c.classList.add('dragging')
})
columns.addEventListener('dragend', (e) => e.target.closest?.('.card')?.classList.remove('dragging'))
columns.addEventListener('dragover', (e) => {
  const col = e.target.closest('.col')
  if (!col) return
  e.preventDefault()
  for (const el of columns.querySelectorAll('.col.over')) if (el !== col) el.classList.remove('over')
  col.classList.add('over')
})
columns.addEventListener('dragleave', (e) => {
  const col = e.target.closest('.col')
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('over')
})
columns.addEventListener('drop', (e) => {
  const col = e.target.closest('.col')
  if (!col) return
  e.preventDefault()
  col.classList.remove('over')
  const name = e.dataTransfer.getData('text/plain')
  const p = projects.find((x) => x.name === name)
  if (p && p.meta.status !== col.dataset.status) {
    patchMeta(name, { status: col.dataset.status }, { rerenderDrawer: selected === name })
    toast(`${name} → ${M.STATUSES.find((s) => s.id === col.dataset.status).label}`)
  }
})

// ── drawer ────────────────────────────────────────────────────────────────────

function select(name) {
  selected = name
  root.classList.toggle('drawer-open', Boolean(name))
  drawer.setAttribute('aria-hidden', name ? 'false' : 'true')
  renderDrawer()
  for (const c of columns.querySelectorAll('.card')) c.classList.toggle('sel', c.dataset.project === name)
}

function renderDrawer() {
  const p = projects.find((x) => x.name === selected)
  if (!p) {
    drawer.innerHTML = ''
    return
  }
  const m = p.meta
  drawer.innerHTML = `
    <div class="d-head">
      <h2>${esc(p.name)}</h2>
      <button class="btn icon ghost" data-act="close" aria-label="Close">✕</button>
    </div>
    ${
      p.path
        ? `<div class="path"><code>${esc(p.path)}</code></div>
           <div class="row wrap">
             <button class="btn" data-act="new">+ New thread</button>
             <button class="btn ghost" data-act="reveal">Show folder</button>
             <button class="btn ghost" data-act="copy">Copy path</button>
           </div>`
        : '<p class="muted">No folder yet. Start a thread in this project’s folder and it will connect here by name.</p>'
    }
    <div class="field"><span>Column</span>
      <div class="seg">${M.STATUSES.map((s) => `<button class="${m.status === s.id ? 'on' : ''}" data-status="${s.id}">${s.label}</button>`).join('')}</div>
    </div>
    <div class="row">
      <label class="field grow"><span>Priority</span>
        <select data-field="priority">${Object.entries(M.PRIORITIES).map(([k, v]) => `<option value="${k}" ${Number(k) === m.priority ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
      <label class="chk pinbox"><input type="checkbox" data-field="pinned" ${m.pinned ? 'checked' : ''} /> Pinned</label>
    </div>
    <label class="field"><span>Goal</span><input data-field="goal" maxlength="280" value="${esc(m.goal)}" placeholder="What does done look like?" /></label>
    <label class="field"><span>Tags</span><input data-field="tags" value="${esc(m.tags.join(', '))}" placeholder="agents, evals, client-x" /></label>
    <label class="field"><span>Notes</span><textarea data-field="notes" rows="6" placeholder="Decisions, links, next steps…">${esc(m.notes)}</textarea></label>
    <div class="d-threads"></div>
    <div class="row wrap foot">
      ${p.hidden ? '<span class="muted">Hidden on the colony map.</span>' : ''}
      ${!p.threads.length && !p.archivedCount && state.projects?.[p.name] ? '<button class="btn danger ghost" data-act="remove">Remove from board</button>' : ''}
    </div>`
  renderDrawerThreads()
}

function renderDrawerThreads() {
  const box = drawer.querySelector('.d-threads')
  const p = projects.find((x) => x.name === selected)
  if (!box || !p) return
  box.innerHTML = `<h3>Threads <span class="count">${p.threads.length}</span>${p.archivedCount ? `<span class="muted"> · ${p.archivedCount} archived</span>` : ''}</h3>
    ${
      p.threads.length
        ? `<ul class="t-list">${p.threads
            .map(
              (t) => `<li>
            <span class="pill ${t.status}">${M.THREAD_LABEL[t.status]}</span>
            <div class="t-body">
              <div class="t-title">${esc(t.title || 'Untitled thread')}</div>
              <div class="muted small">${esc([t.harnessName, t.gitBranch, t.model].filter(Boolean).join(' · '))} · ${M.ago(t.lastActivityAt)}</div>
            </div>
            <div class="t-acts">
              ${t.status === 'waiting' ? `<button class="btn small ghost" data-viewed="${esc(t.id)}" title="Stop flagging until it moves again">Seen</button>` : ''}
              <button class="btn small" data-open="${esc(t.id)}" ${t.canOpen === false ? 'disabled' : ''}>Open</button>
            </div>
          </li>`
            )
            .join('')}</ul>`
        : '<p class="muted">Nothing running here yet.</p>'
    }`
}

// One timer per project field, so typing in one field never swallows a pending edit in another.
const typingTimers = new Map()
drawer.addEventListener('input', (e) => {
  const f = e.target.dataset?.field
  if (!f || !selected) return
  const name = selected
  const value = e.target.value
  const key = `${name}\u0000${f}`
  clearTimeout(typingTimers.get(key))
  typingTimers.set(key, setTimeout(() => {
    typingTimers.delete(key)
    if (f === 'goal' || f === 'notes') patchMeta(name, { [f]: value })
    else if (f === 'tags') patchMeta(name, { tags: M.parseTags(value) })
  }, 500))
})
drawer.addEventListener('change', (e) => {
  const f = e.target.dataset?.field
  if (!selected) return
  if (f === 'priority') patchMeta(selected, { priority: Number(e.target.value) })
  else if (f === 'pinned') patchMeta(selected, { pinned: e.target.checked })
})

drawer.addEventListener('click', async (e) => {
  const p = projects.find((x) => x.name === selected)
  if (!p) return
  const seg = e.target.closest('[data-status]')
  if (seg) return patchMeta(p.name, { status: seg.dataset.status }, { rerenderDrawer: true })

  const viewed = e.target.closest('[data-viewed]')
  if (viewed) {
    state = { ...state, viewedAt: { ...(state.viewedAt || {}), [viewed.dataset.viewed]: Date.now() } }
    queueSave()
    recompute()
    renderMain()
    renderDrawerThreads()
    return
  }

  const open = e.target.closest('[data-open]')
  if (open) {
    const t = p.threads.find((x) => x.id === open.dataset.open)
    if (!t) return
    if (DEMO) return toast('Demo mode: this would open the thread in its harness')
    try {
      const shown = await openThread(t, openIn())
      toast(shown.via === 'terminal' ? `Opened ${t.harnessName} in a terminal` : `Opened in ${t.harnessName}`)
      setTimeout(poll, 1800)
    } catch (err) {
      toast(err.message || 'Could not open that thread', 'err')
    }
    return
  }

  const act = e.target.closest('[data-act]')?.dataset.act
  if (!act) return
  if (act === 'close') return select(null)
  if (act === 'remove') {
    state = M.withoutMeta(state, p.name)
    queueSave()
    recompute()
    select(null)
    renderMain()
    return
  }
  if (DEMO && act !== 'copy') return toast('Demo mode: nothing on this machine to open')
  try {
    if (act === 'new') {
      const harness = p.threads[0]?.harness
      const shown = await newSession(p.path, harness, openIn())
      toast(shown.via === 'terminal' ? 'New thread in a terminal' : 'Starting a new thread')
      setTimeout(poll, 6000)
    } else if (act === 'reveal') {
      await revealFolder(p.path)
    } else if (act === 'copy') {
      await navigator.clipboard.writeText(p.path)
      toast('Path copied')
    }
  } catch (err) {
    toast(err.message || 'That did not work', 'err')
  }
})

// ── toasts ────────────────────────────────────────────────────────────────────

function toast(text, kind = '') {
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = text
  $('.toasts').append(el)
  setTimeout(() => el.remove(), 3200)
}

// ── boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  if (DEMO) {
    const d = demoData()
    threads = d.threads
    state = d.state
    recompute()
    renderMain()
    return
  }
  try {
    state = await fetchState()
  } catch (err) {
    root.querySelector('.columns').innerHTML = `<div class="fatal">Could not reach the local server: ${esc(err.message)}. Start it with <code>npm run dev</code>.</div>`
    return
  }
  recompute()
  renderMain()
  await poll()
  setInterval(poll, POLL_MS)
  // Another tab (the colony, say) may have changed the file; pick that up when this one regains focus.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || saving || dirty) return
    try {
      state = await fetchState()
      recompute()
      renderMain()
    } catch {}
  })
}
boot()
