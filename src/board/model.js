/**
 * The project board's view of the world, pure and browser-free so it runs under bare node.
 *
 * The colony draws threads; the board organises the *projects* those threads belong to. A
 * project is a repo the scan found (keyed on the same name a zone is keyed on), plus whatever
 * you have recorded about it here — a status column, a priority, tags, a goal and notes. A
 * project can also exist with no threads at all: an idea you have written down before any agent
 * has touched it.
 */

export const STATUSES = [
  { id: 'idea', label: 'Ideas' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'shipped', label: 'Shipped' },
]
export const STATUS_IDS = STATUSES.map((s) => s.id)

export const PRIORITIES = { 1: 'High', 2: 'Normal', 3: 'Low' }

/** Mirrors the colony's own threshold, so "dormant" means the same thing on both pages. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000

export const THREAD_LABEL = {
  blocked: 'Errored',
  working: 'Running',
  shipped: 'PR merged',
  waiting: 'Needs you',
  idle: 'Idle',
  sleeping: 'Dormant',
}

/** Same rules, same order as the colony's `statusFor`, with viewedAt folded in first. */
export function threadStatus(thread, viewedAt = {}, now = Date.now()) {
  if (thread.hasError) return 'blocked'
  if (thread.running) return 'working'
  if (String(thread.prState || '').toUpperCase() === 'MERGED') return 'shipped'
  const seen = viewedAt[thread.id]
  if (thread.unread && !(seen && thread.lastActivityAt <= seen)) return 'waiting'
  if (now - (thread.lastActivityAt || 0) > STALE_MS) return 'sleeping'
  return 'idle'
}

export const defaultMeta = () => ({ status: 'active', priority: 2, tags: [], goal: '', notes: '', pinned: false, updatedAt: 0 })

export function metaFor(state, name) {
  return { ...defaultMeta(), ...(state?.projects?.[name] || {}) }
}

/**
 * Threads → projects. Archived threads (the harness's flag or the colony's own list) are kept
 * out of every count but still tallied, so a project whose work is all archived reads as quiet
 * rather than vanishing.
 */
export function buildProjects(threads, state = {}, now = Date.now()) {
  const archived = new Set(state.archived || [])
  const hidden = new Set(state.hiddenProjects || [])
  const viewedAt = state.viewedAt || {}
  const byName = new Map()

  const ensure = (name) => {
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        path: '',
        harnesses: [],
        threads: [],
        archivedCount: 0,
        counts: { blocked: 0, working: 0, shipped: 0, waiting: 0, idle: 0, sleeping: 0 },
        lastActivityAt: 0,
        branches: [],
        hidden: hidden.has(name),
        meta: metaFor(state, name),
      })
    }
    return byName.get(name)
  }

  for (const t of threads || []) {
    const p = ensure(t.project || 'unknown')
    if (!p.path && t.projectPath) p.path = t.projectPath
    if (t.archived || archived.has(t.id)) {
      p.archivedCount += 1
      continue
    }
    const status = threadStatus(t, viewedAt, now)
    p.threads.push({ ...t, status })
    p.counts[status] += 1
    p.lastActivityAt = Math.max(p.lastActivityAt, t.lastActivityAt || 0)
    const h = t.harnessName || t.harness
    if (h && !p.harnesses.includes(h)) p.harnesses.push(h)
    if (t.gitBranch && !p.branches.includes(t.gitBranch)) p.branches.push(t.gitBranch)
  }

  // Projects recorded on the board that no scan has seen (yet, or any more).
  for (const name of Object.keys(state.projects || {})) ensure(name)

  for (const p of byName.values()) {
    p.threads.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
    p.attention = p.counts.waiting + p.counts.blocked
  }
  return sortProjects([...byName.values()])
}

/** Pinned first, then what needs you, then priority, then most recently touched. */
export function sortProjects(list) {
  return [...list].sort(
    (a, b) =>
      Number(b.meta.pinned) - Number(a.meta.pinned) ||
      Number(b.attention > 0) - Number(a.attention > 0) ||
      a.meta.priority - b.meta.priority ||
      b.lastActivityAt - a.lastActivityAt ||
      a.name.localeCompare(b.name)
  )
}

export function filterProjects(list, { q = '', tag = '', harness = '', showHidden = false } = {}) {
  const needle = q.trim().toLowerCase()
  return list.filter((p) => {
    if (p.hidden && !showHidden) return false
    if (tag && !p.meta.tags.includes(tag)) return false
    if (harness && !p.harnesses.includes(harness)) return false
    if (!needle) return true
    const hay = [p.name, p.path, p.meta.goal, p.meta.notes, ...p.meta.tags, ...p.branches, ...p.threads.map((t) => t.title)]
      .join('\n')
      .toLowerCase()
    return hay.includes(needle)
  })
}

export const allTags = (list) => [...new Set(list.flatMap((p) => p.meta.tags))].sort((a, b) => a.localeCompare(b))
export const allHarnesses = (list) => [...new Set(list.flatMap((p) => p.harnesses))].sort((a, b) => a.localeCompare(b))

/** Every thread asking for you, across every visible project, oldest wait first. */
export function attentionQueue(list) {
  return list
    .filter((p) => !p.hidden)
    .flatMap((p) => p.threads.filter((t) => t.status === 'waiting' || t.status === 'blocked').map((t) => ({ ...t, projectName: p.name })))
    .sort((a, b) => (a.lastActivityAt || 0) - (b.lastActivityAt || 0))
}

export function parseTags(text) {
  return [...new Set(String(text || '').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20)
}

/** A new state with one project's record patched. Never mutates the one it is given. */
export function withMeta(state, name, patch, now = Date.now()) {
  const next = { ...metaFor(state, name), ...patch, updatedAt: now }
  if (!STATUS_IDS.includes(next.status)) next.status = 'active'
  return { ...state, projects: { ...(state.projects || {}), [name]: next } }
}

/** Forget what the board recorded about a project. Its threads, if any, are untouched. */
export function withoutMeta(state, name) {
  const projects = { ...(state.projects || {}) }
  delete projects[name]
  return { ...state, projects }
}

export function ago(ms, now = Date.now()) {
  if (!ms) return 'never'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
