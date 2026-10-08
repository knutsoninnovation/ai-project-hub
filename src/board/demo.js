/**
 * Sample threads for `board.html?demo` — enough to see the board without any harness installed.
 * Nothing here is read from disk and nothing it does is saved.
 */
const H = 3600 * 1000
const D = 24 * H

export function demoData(now = Date.now()) {
  const t = (id, project, title, extra = {}) => ({
    id: `demo:${id}`,
    title,
    preview: '',
    project,
    projectPath: `/Users/you/code/${project}`,
    harness: 'claude-code',
    harnessName: 'Claude Code',
    gitBranch: 'main',
    model: 'claude-opus-5-5',
    lastActivityAt: now - H,
    createdAt: now - 5 * D,
    canOpen: true,
    ref: {},
    ...extra,
  })
  const threads = [
    t(1, 'support-agent', 'Add retrieval over the help-center docs', { running: true, gitBranch: 'rag-index' }),
    t(2, 'support-agent', 'Write evals for refund-policy answers', { unread: true, lastActivityAt: now - 3 * H }),
    t(3, 'support-agent', 'Fix flaky tool-call test', { prState: 'MERGED', lastActivityAt: now - 2 * D }),
    t(4, 'invoice-extractor', 'Parse multi-page PDFs', { hasError: true, harness: 'codex', harnessName: 'Codex', lastActivityAt: now - 40 * 60 * 1000 }),
    t(5, 'invoice-extractor', 'Schema for line items', { harness: 'codex', harnessName: 'Codex', lastActivityAt: now - 6 * H }),
    t(6, 'voice-notes', 'Whisper → summary pipeline', { lastActivityAt: now - 9 * D }),
    t(7, 'prompt-library', 'Tag prompts by task type', { unread: true, harness: 'cursor', harnessName: 'Cursor', lastActivityAt: now - 20 * H }),
    t(8, 'prompt-library', 'Import from Notion export', { running: true, harness: 'cursor', harnessName: 'Cursor', lastActivityAt: now - 2 * 60 * 1000 }),
    t(9, 'eval-dashboard', 'Chart pass rate per model', { lastActivityAt: now - 4 * D }),
  ]
  const state = {
    version: 2,
    archived: [],
    archivedAt: {},
    opened: [],
    plots: {},
    seen: {},
    hiddenProjects: [],
    viewedAt: {},
    settings: null,
    updatedAt: now,
    projects: {
      'support-agent': { status: 'active', priority: 1, tags: ['agents', 'customer'], goal: 'Answer tier-1 tickets with cited sources', notes: '', pinned: true, updatedAt: now },
      'invoice-extractor': { status: 'active', priority: 2, tags: ['extraction'], goal: 'Structured JSON from vendor invoices', notes: '', pinned: false, updatedAt: now },
      'voice-notes': { status: 'paused', priority: 3, tags: ['personal'], goal: '', notes: 'Waiting on a better diarization model.', pinned: false, updatedAt: now },
      'prompt-library': { status: 'active', priority: 2, tags: ['tooling'], goal: 'One searchable home for reusable prompts', notes: '', pinned: false, updatedAt: now },
      'eval-dashboard': { status: 'shipped', priority: 2, tags: ['tooling', 'evals'], goal: '', notes: '', pinned: false, updatedAt: now },
      'meeting-copilot': { status: 'idea', priority: 2, tags: ['agents'], goal: 'Live notes + action items during calls', notes: '', pinned: false, updatedAt: now },
    },
  }
  return { threads, state }
}
