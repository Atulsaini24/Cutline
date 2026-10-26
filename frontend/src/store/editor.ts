import { create } from 'zustand'
import { toast } from 'sonner'
import { buildPlan, intentIsEmpty, parseIntent, RULES_HELP, type Plan } from '../lib/agent'
import { replayNow, seqDur, srcToTl, tlToSrc, keptIn, type NewOp, type OpRecord, type Range, type TimelineState } from '../lib/timeline'
import { loadIndex, SAMPLE_RAW, snippet, WORDS } from '../lib/sample'
import { clone, fmt } from '../lib/format'
import { ApiError, clientId, onEvent, req, subscribe } from '../lib/api'
import { useSession } from '../lib/session'

export interface ChatMsg {
  id: string; role: 'user' | 'agent'; kind?: 'text' | 'working' | 'plan' | 'run' | 'discarded'
  text?: string; steps?: string[]; plan?: Plan; preview?: boolean; runId?: string; runN?: number; provider?: string
}
export interface Snapshot { name: string; v: number; state: TimelineState; at: number }
export type Selection = { kind: 'clip'; s: number; e: number; multi?: Range[] } | { kind: 'broll'; id: string } | null

interface Persisted { log: OpRecord[]; cursor: number; snaps: Snapshot[]; chat: ChatMsg[]; runN: number; opN: number; title: string }
interface EditorStore extends Persisted {
  projectId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  loadError: string | null
  media: { proxy: string | null; poster: string | null; synthetic: boolean }
  tl: TimelineState
  reverted: Set<string>
  seq: string
  sel: Selection
  selWords: { a: number; b: number } | null
  hlRun: string | null
  busy: boolean
  syncing: number
  marks: { in: number | null; out: number | null }
  ranges: () => Range[]
  openDemo: () => void
  openRemote: (id: string) => Promise<void>
  commit: (ops: NewOp[], opts?: { silent?: boolean }) => void
  undo: () => void
  redo: () => void
  goto: (v: number) => void
  setSeq: (s: string) => void
  setSel: (s: Selection) => void
  setSelWords: (w: { a: number; b: number } | null) => void
  setHlRun: (r: string | null) => void
  setTitle: (t: string) => void
  setMarks: (m: Partial<{ in: number | null; out: number | null }>) => void
  cutTimelineRange: (a: number, b: number, label: string) => void
  send: (text: string) => void
  applyPlan: (msgId: string) => void
  discardPlan: (msgId: string) => void
  togglePreview: (msgId: string) => void
  togglePlanItem: (msgId: string, idx: number) => void
  revertRun: (runId: string) => void
  saveSnapshot: (name: string) => void
  restoreSnapshot: (i: number) => void
  reset: (title?: string) => void
}

const DEMO_KEY = 'cutline-editor-v3'
const DEFAULT_TITLE = 'Episode 14, home studio on a budget'
const chatKey = (pid: string | null) => `cutline-chat:${pid ?? 'demo'}`
const uid = () => Math.random().toString(36).slice(2, 9)
const EMPTY_P: Persisted = { log: [], cursor: 0, snaps: [], chat: [], runN: 0, opN: 0, title: DEFAULT_TITLE }
function loadDemo(): Persisted {
  try { const d = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); if (d) return fixChat(d) } catch { /* ignore */ }
  return { ...EMPTY_P }
}
const fixChat = <T extends { chat: ChatMsg[] }>(d: T) => ({ ...d, chat: d.chat.map(m => m.kind === 'working' ? { ...m, kind: 'text' as const, text: 'That plan was interrupted. Send the instruction again.' } : m) })

const initial = loadDemo()
const r0 = replayNow(initial.log, initial.cursor)
let chain: Promise<unknown> = Promise.resolve()   // server writes are serialised so baseHead is always right
let serverHead = 0
let unsubWs: (() => void) | null = null

export const useEditor = create<EditorStore>((set, get) => {
  const recompute = (patch: Partial<EditorStore> = {}) => {
    const s = { ...get(), ...patch }
    const { state, reverted } = replayNow(s.log, s.cursor)
    const seq = s.seq !== 'main' && !state.shorts.find(x => x.id === s.seq) ? 'main' : s.seq
    set({ ...patch, tl: state, reverted, seq })
    persist()
  }
  const persist = () => {
    const { log, cursor, snaps, chat, runN, opN, title, projectId } = get()
    try {
      if (projectId) localStorage.setItem(chatKey(projectId), JSON.stringify({ chat, runN }))
      else localStorage.setItem(DEMO_KEY, JSON.stringify({ log, cursor, snaps, chat, runN, opN, title }))
    } catch { /* ignore */ }
  }
  const updateMsg = (id: string, patch: Partial<ChatMsg>) => { set({ chat: get().chat.map(m => m.id === id ? { ...m, ...patch } : m) }); persist() }
  /** Queue a server write; on failure roll back to what the server has. */
  const remote = (label: string, fn: () => Promise<void>) => {
    if (!get().projectId) return
    set({ syncing: get().syncing + 1 })
    chain = chain.then(fn).catch(async (e: unknown) => {
      const err = e as ApiError
      toast.error(err.status === 409 ? 'Timeline changed elsewhere' : `Couldn’t save: ${label}`, { description: err.message })
      await get().openRemote(get().projectId!)
    }).finally(() => set({ syncing: Math.max(0, get().syncing - 1) }))
  }
  const pushHead = (head: number) => remote('undo', async () => { await req('PATCH', `/projects/${get().projectId}/head`, { head, clientId }); serverHead = head })

  return {
    ...initial,
    projectId: null, status: 'ready', loadError: null,
    media: { proxy: null, poster: null, synthetic: true },
    tl: r0.state, reverted: r0.reverted,
    seq: 'main', sel: null, selWords: null, hlRun: null, busy: false, syncing: 0,
    marks: { in: null, out: null },

    ranges: () => { const s = get(); if (s.seq === 'main') return s.tl.v1; return s.tl.shorts.find(x => x.id === s.seq)?.ranges ?? s.tl.v1 },

    openDemo: () => {
      unsubWs?.(); unsubWs = null
      loadIndex(SAMPLE_RAW)
      const d = loadDemo()
      set({ ...d, projectId: null, status: 'ready', loadError: null, media: { proxy: null, poster: null, synthetic: true }, seq: 'main', sel: null, selWords: null, hlRun: null, busy: false, marks: { in: null, out: null } })
      recompute()
    },
    openRemote: async (id) => {
      const first = get().projectId !== id
      if (first) set({ status: 'loading', loadError: null, projectId: id })
      try {
        const d = await req(`GET`, `/projects/${id}`)
        if (!d.index) { set({ status: 'error', loadError: d.project.status === 'failed' ? (d.project.error ?? 'Indexing failed.') : 'This project is still being indexed.' }); return }
        loadIndex(d.index)
        serverHead = d.head
        let local = { chat: [] as ChatMsg[], runN: 0 }
        try { local = fixChat(JSON.parse(localStorage.getItem(chatKey(id)) || '{"chat":[],"runN":0}')) } catch { /* ignore */ }
        const runN = Math.max(local.runN, ...d.ops.map((o: OpRecord) => Number(o.runId?.replace(/\D/g, '') || 0)))
        set({ projectId: id, title: d.project.title, log: d.ops, cursor: d.head, snaps: d.snapshots, opN: d.ops.length, chat: first ? local.chat : get().chat, runN, status: 'ready',
          media: { proxy: d.media.proxy, poster: d.media.poster, synthetic: d.project.synthetic }, ...(first ? { seq: 'main', sel: null, selWords: null, hlRun: null, marks: { in: null, out: null } } : {}) })
        recompute()
        // a brand-new project starts with the caption style chosen in Settings
        const pref = useSession.getState().user?.settings?.captionStyle
        if (first && d.ops.length === 0 && pref && pref !== get().tl.cap.style) get().commit([{ type: 'captionStyle', author: 'user', label: `Caption style: ${pref}`, p: { style: pref } }], { silent: true })
        if (first) {
          subscribe(id); unsubWs?.()
          unsubWs = onEvent(m => {
            if (m.projectId !== get().projectId || m.clientId === clientId) return
            if (m.type === 'ops' || m.type === 'head') { toast('Updated from another window'); get().openRemote(id) }
          })
        }
      } catch (e) { set({ status: 'error', loadError: (e as Error).message }) }
    },

    commit: (ops, opts) => {
      const s = get()
      const before = { log: s.log, cursor: s.cursor }
      const log = s.log.slice(0, s.cursor)
      let opN = s.opN
      ops.forEach(o => { opN++; log.push({ ...o, id: 'op' + opN + uid(), version: log.length + 1, at: Date.now() } as OpRecord) })
      recompute({ log, cursor: log.length, opN })
      if (!opts?.silent && ops.length === 1 && ops[0].author === 'user') toast(ops[0].label, { action: { label: 'Undo', onClick: () => get().undo() }, duration: 2600 })
      if (s.projectId) remote(ops[0].label, async () => {
        const base = serverHead
        if (base !== before.cursor) await req('PATCH', `/projects/${s.projectId}/head`, { head: before.cursor, clientId })
        const r = await req('POST', `/projects/${s.projectId}/ops`, { baseHead: before.cursor, ops, clientId })
        serverHead = r.head
        // adopt server ids so later ops reference the same records
        const cur = get(); const fixed = cur.log.map(o => { const rec = r.records.find((x: OpRecord) => x.version === o.version); return rec ?? o })
        set({ log: fixed })
      })
    },
    undo: () => {
      const s = get(); if (!s.cursor) return
      let c = s.cursor; const last = s.log[c - 1]
      if (last.runId) { while (c > 0 && s.log[c - 1].runId === last.runId) c--; toast('Undid the whole AI run', { description: 'Redo brings every edit back.', action: { label: 'Redo', onClick: () => get().redo() } }) }
      else { c--; toast(`Undid: ${last.label}`, { action: { label: 'Redo', onClick: () => get().redo() } }) }
      recompute({ cursor: c }); pushHead(c)
    },
    redo: () => {
      const s = get(); if (s.cursor >= s.log.length) return
      let c = s.cursor; const nx = s.log[c]
      if (nx.runId) { while (c < s.log.length && s.log[c].runId === nx.runId) c++ } else c++
      toast(`Redid: ${nx.runId ? 'AI run' : nx.label}`)
      recompute({ cursor: c }); pushHead(c)
    },
    goto: (v) => { recompute({ cursor: v }); pushHead(v); toast(`Viewing version ${v}`, { description: 'New edits will replace anything after it.' }) },
    setSeq: (seq) => set({ seq, sel: null, selWords: null, marks: { in: null, out: null } }),
    setSel: (sel) => set({ sel }),
    setSelWords: (selWords) => set({ selWords }),
    setHlRun: (hlRun) => set({ hlRun }),
    setTitle: (title) => { set({ title }); persist(); const pid = get().projectId; if (pid) remote('title', () => req('PATCH', `/projects/${pid}`, { title: title || 'Untitled' })) },
    setMarks: (m) => set({ marks: { ...get().marks, ...m } }),
    cutTimelineRange: (a, b, label) => {
      const r = get().tl.v1; if (b - a < 40) return
      // a timeline range can span earlier cuts: cut each source piece it covers
      const ops: NewOp[] = []
      let acc = 0
      for (const iv of r) {
        const d = iv.e - iv.s; const x = Math.max(a, acc), y = Math.min(b, acc + d)
        if (y - x > 20) ops.push({ type: 'cut', author: 'user', label, p: { s: Math.round(iv.s + x - acc), e: Math.round(iv.s + y - acc) } })
        acc += d
      }
      if (ops.length) get().commit(ops)
    },

    send: (raw) => {
      const text = raw.trim(); const s = get(); if (!text || s.busy) return
      let chat = s.chat.map(m => m.kind === 'plan' ? { ...m, kind: 'discarded' as const } : m)
      chat = [...chat, { id: uid(), role: 'user', text }]
      const id = uid()
      chat.push({ id, role: 'agent', kind: 'working', steps: [] })
      set({ chat, busy: true }); persist()
      const finish = (plan: Plan, provider?: string) => {
        set({ busy: false })
        if (!plan.total && !plan.shorts.length) updateMsg(id, { kind: 'text', text: plan.summary.includes(RULES_HELP.slice(0, 40)) ? plan.summary : [plan.note, 'Nothing left to change for that request: those parts of the timeline are already clean.'].filter(Boolean).join(' ') })
        else {
          updateMsg(id, { kind: 'plan', plan, preview: true, provider })
          // "Always show a plan first" switched off in Settings: apply straight away (still one undoable run)
          if (useSession.getState().user?.settings?.planFirst === false) setTimeout(() => get().applyPlan(id), 400)
        }
      }
      const addStep = (step: string) => { const m = get().chat.find(x => x.id === id); if (m && m.kind === 'working') updateMsg(id, { steps: [...(m.steps ?? []), step] }) }
      if (s.projectId) {
        const off = onEvent(m => { if (m.type === 'agent.step' && m.requestId === id) addStep(m.step) })
        req('POST', `/projects/${s.projectId}/agent`, { instruction: text, requestId: id })
          .then(r => finish(r.plan, r.provider))
          .catch(e => { set({ busy: false }); updateMsg(id, { kind: 'text', text: `I couldn’t plan that: ${(e as Error).message}` }) })
          .finally(off)
        return
      }
      const intent = parseIntent(text)
      if (intentIsEmpty(intent)) { set({ busy: false }); updateMsg(id, { kind: 'text', text: RULES_HELP }); return }
      const st = useSession.getState().user?.settings ?? {}
      const steps = ['Reading the transcript, shots and speakers', 'Planning the edit', 'Writing timeline edits', 'Checking each edit against the current timeline']
      let k = 0
      const tick = () => { addStep(steps[k++]); if (k < steps.length) setTimeout(tick, 380 + Math.random() * 320); else setTimeout(() => finish(buildPlan(get().tl, intent, { aggressiveness: st.aggressiveness, keepJokes: st.keepJokes }), 'demo'), 420) }
      setTimeout(tick, 200)
    },
    applyPlan: (msgId) => {
      const s = get(); const m = s.chat.find(x => x.id === msgId); if (!m?.plan) return
      const runN = s.runN + 1; const runId = 'run' + runN
      const items = m.plan.items.filter(x => x.on !== false)
      const ops: NewOp[] = items.map(x => ({ type: 'cut', author: 'agent', runId, label: `${x.group}: “${snippet(x.s, x.e)}”`, p: { s: x.s, e: x.e } }))
      if (m.plan.shorts.length) ops.push({ type: 'addShorts', author: 'agent', runId, label: `Created ${m.plan.shorts.length} Shorts`, p: { shorts: m.plan.shorts } })
      if (!ops.length) { toast('Nothing selected to apply'); return }
      set({ runN, chat: s.chat.map(x => x.id === msgId ? { ...x, kind: 'run', runId, runN } : x) })
      get().commit(ops, { silent: true })
      toast.success(`Applied ${ops.length} edits as run ${runN}`, { description: 'One undo reverts all of them.', action: { label: 'Undo', onClick: () => get().undo() } })
    },
    discardPlan: (msgId) => updateMsg(msgId, { kind: 'discarded' }),
    togglePreview: (msgId) => { const m = get().chat.find(x => x.id === msgId); updateMsg(msgId, { preview: !m?.preview }) },
    togglePlanItem: (msgId, idx) => {
      const m = get().chat.find(x => x.id === msgId); if (!m?.plan) return
      const items = m.plan.items.map((x, i) => i === idx ? { ...x, on: x.on === false } : x)
      const groups = m.plan.groups.map(g => { const gi = g.items.map(it => items.find(x => x.s === it.s && x.e === it.e)!); return { ...g, items: gi } })
      updateMsg(msgId, { plan: { ...m.plan, items, groups } })
    },
    revertRun: (runId) => {
      const n = runId.replace(/\D/g, '')
      get().commit([{ type: 'revertRun', author: 'user', label: `Reverted AI run ${n}`, p: { runId } }], { silent: true })
      toast(`Reverted run ${n}`, { description: 'Your later edits are kept.', action: { label: 'Undo', onClick: () => get().undo() } })
    },
    saveSnapshot: (name) => {
      const s = get(); set({ snaps: [{ name, v: s.cursor, state: clone(s.tl), at: Date.now() }, ...s.snaps] }); persist()
      if (s.projectId) remote('snapshot', () => req('POST', `/projects/${s.projectId}/snapshots`, { name }))
      toast.success(`Saved snapshot “${name}”`)
    },
    restoreSnapshot: (i) => { const sn = get().snaps[i]; get().commit([{ type: 'setState', author: 'user', label: `Restored snapshot “${sn.name}”`, p: { state: sn.state } }], { silent: true }); toast(`Restored “${sn.name}”`, { description: 'Saved as a new version, so you can undo it.' }) },
    reset: (title) => {
      try { localStorage.removeItem(DEMO_KEY) } catch { /* ignore */ }
      loadIndex(SAMPLE_RAW)
      set({ ...EMPTY_P, title: title ?? DEFAULT_TITLE, projectId: null, seq: 'main', sel: null, selWords: null, hlRun: null, busy: false, marks: { in: null, out: null } }); recompute()
    },
  }
})

export function runStatus(log: OpRecord[], cursor: number, reverted: Set<string>, runId: string) {
  const idx = log.findIndex(o => o.runId === runId)
  if (idx < 0 || idx >= cursor) return 'undone' as const
  return reverted.has(runId) ? 'reverted' as const : 'applied' as const
}

/* ---------- playback: separate store, updates every frame ---------- */
interface Playback { t: number; playing: boolean; rate: number; skim: number | null; loop: boolean; setT: (t: number) => void; setPlaying: (p: boolean) => void; setRate: (r: number) => void; setSkim: (t: number | null) => void; setLoop: (l: boolean) => void }
export const usePlayback = create<Playback>((set) => ({
  t: 0, playing: false, rate: 1, skim: null, loop: false,
  setT: (t) => set({ t: Math.max(0, Math.min(t, seqDur(useEditor.getState().ranges()))) }),
  setPlaying: (playing) => set(playing ? { playing } : { playing, rate: 1 }),
  setRate: (rate) => set({ rate }),
  setSkim: (skim) => set({ skim }),
  setLoop: (loop) => set({ loop }),
}))

const EMPTY: never[] = []
export const pendingItems = (chat: ChatMsg[]) => { const m = chat.find(x => x.kind === 'plan' && x.preview); return m?.plan?.items.filter(x => x.on !== false) ?? EMPTY }

/* ---------- helpers used by panels ---------- */
export function fillerOps(): NewOp[] {
  const tl = useEditor.getState().tl; const out: NewOp[] = []
  WORDS.forEach(w => {
    if (!w.filler || !keptIn(tl.v1, (w.s + w.e) / 2)) return
    const nx = WORDS[w.i + 1]; const e = nx && nx.sent === w.sent ? nx.s : w.e
    const L = out[out.length - 1] as any
    if (L && Math.abs(L.p.e - w.s) < 5) { L.p.e = e; L.label = `Cut filler “${snippet(L.p.s, e)}”` }
    else out.push({ type: 'cut', author: 'user', label: `Cut filler “${w.text}”`, p: { s: w.s, e } })
  })
  return out
}
export const tlOf = (ms: number) => srcToTl(useEditor.getState().ranges(), ms)
export const srcOf = (t: number) => tlToSrc(useEditor.getState().ranges(), t)
export { fmt }
