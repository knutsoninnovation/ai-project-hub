/**
 * The project board: grouping threads into projects, what counts as needing you, and that the
 * board's own records survive the state file's read, write and two-tab merge.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../src/board/model.js'
import { mergeState } from '../src/game/merge-state.js'
import { withServer } from './support/with-server.mjs'

const now = 1_800_000_000_000
const th = (id, project, extra = {}) => ({ id, project, projectPath: `/code/${project}`, title: id, lastActivityAt: now - 1000, harnessName: 'Claude Code', ...extra })

test('threads group by project, archived ones are counted but kept out', () => {
  const list = M.buildProjects(
    [th('a', 'x', { running: true }), th('b', 'x', { unread: true }), th('c', 'x', { archived: true }), th('d', 'y')],
    { archived: ['d'] },
    now
  )
  const x = list.find((p) => p.name === 'x')
  assert.equal(x.threads.length, 2)
  assert.equal(x.archivedCount, 1)
  assert.equal(x.counts.working, 1)
  assert.equal(x.counts.waiting, 1)
  assert.equal(x.attention, 1)
  assert.equal(list.find((p) => p.name === 'y').threads.length, 0)
})

test('a thread marked viewed stops needing you until it moves again', () => {
  const t = th('a', 'x', { unread: true })
  assert.equal(M.threadStatus(t, {}, now), 'waiting')
  assert.equal(M.threadStatus(t, { a: now }, now), 'idle')
  assert.equal(M.threadStatus({ ...t, lastActivityAt: now + 5 }, { a: now }, now + 10), 'waiting')
})

test('status order matches the colony: error beats running beats merged beats unread', () => {
  assert.equal(M.threadStatus(th('a', 'x', { hasError: true, running: true }), {}, now), 'blocked')
  assert.equal(M.threadStatus(th('a', 'x', { running: true, unread: true }), {}, now), 'working')
  assert.equal(M.threadStatus(th('a', 'x', { prState: 'MERGED', unread: true }), {}, now), 'shipped')
  assert.equal(M.threadStatus(th('a', 'x', { lastActivityAt: now - M.STALE_MS - 1 }), {}, now), 'sleeping')
})

test('a project recorded on the board with no threads still appears, with defaults filled in', () => {
  const list = M.buildProjects([], { projects: { idea: { status: 'idea', goal: 'g' } } }, now)
  assert.equal(list.length, 1)
  assert.equal(list[0].meta.status, 'idea')
  assert.equal(list[0].meta.priority, 2)
  assert.deepEqual(list[0].meta.tags, [])
})

test('pinned, then needing you, then priority, then recency', () => {
  const list = M.buildProjects(
    [th('1', 'quiet'), th('2', 'asks', { unread: true }), th('3', 'pinned')],
    { projects: { pinned: { pinned: true, priority: 3 }, quiet: { priority: 1 } } },
    now
  )
  assert.deepEqual(list.map((p) => p.name), ['pinned', 'asks', 'quiet'])
})

test('filters: text matches goal, notes, tags and thread titles; hidden repos stay out by default', () => {
  const list = M.buildProjects([th('Fix login', 'web'), th('z', 'secret')], {
    hiddenProjects: ['secret'],
    projects: { web: { tags: ['client'], notes: 'uses supabase' } },
  }, now)
  assert.deepEqual(M.filterProjects(list, { q: 'supabase' }).map((p) => p.name), ['web'])
  assert.deepEqual(M.filterProjects(list, { q: 'login' }).map((p) => p.name), ['web'])
  assert.deepEqual(M.filterProjects(list, { tag: 'client' }).map((p) => p.name), ['web'])
  assert.deepEqual(M.filterProjects(list, {}).map((p) => p.name), ['web'])
  assert.equal(M.filterProjects(list, { showHidden: true }).length, 2)
})

test('the attention queue lists the longest wait first and skips hidden repos', () => {
  const list = M.buildProjects(
    [th('new', 'a', { unread: true, lastActivityAt: now - 10 }), th('old', 'b', { hasError: true, lastActivityAt: now - 99 }), th('h', 'c', { unread: true })],
    { hiddenProjects: ['c'] },
    now
  )
  assert.deepEqual(M.attentionQueue(list).map((t) => t.id), ['old', 'new'])
})

test('withMeta never mutates, and rejects an unknown column', () => {
  const s = { projects: {} }
  const next = M.withMeta(s, 'x', { status: 'nonsense', tags: M.parseTags('a, b, a,, ') }, now)
  assert.deepEqual(s, { projects: {} })
  assert.equal(next.projects.x.status, 'active')
  assert.deepEqual(next.projects.x.tags, ['a', 'b'])
  assert.deepEqual(M.withoutMeta(next, 'x').projects, {})
})

test('two tabs editing different projects both keep their edit', () => {
  const out = mergeState(
    { projects: { a: { status: 'idea' }, b: { status: 'idea' } } },
    { projects: { a: { status: 'active' }, b: { status: 'idea' } } },
    { projects: { a: { status: 'idea' }, b: { status: 'shipped' } } }
  )
  assert.equal(out.projects.a.status, 'active')
  assert.equal(out.projects.b.status, 'shipped')
})

test('the server keeps board records, and cleans what it is sent', async () => {
  await withServer(async ({ call, put }) => {
    const res = await put({ projects: { x: { status: 'bogus', priority: 9, tags: ['a', 7, ''], goal: 'g', pinned: 'yes' }, '': { status: 'idea' } } })
    assert.equal(res.status, 200)
    const state = await (await call('/api/state')).json()
    assert.deepEqual(Object.keys(state.projects), ['x'])
    assert.equal(state.projects.x.status, 'active')
    assert.equal(state.projects.x.priority, 2)
    assert.deepEqual(state.projects.x.tags, ['a'])
    assert.equal(state.projects.x.goal, 'g')
    assert.equal(state.projects.x.pinned, false)
  })
})
