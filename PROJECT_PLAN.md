# Cutline: Project Plan, Status and Pending Work

*Last updated: 26 October 2026 (v0.3: free AI providers, fixes, review links). Living document: update the status tables as tasks land.*

---

## 1. What we are making

Cutline is an AI-native video editor. You upload a long recording, describe the edit in plain English ("tighten the first 15 seconds, remove repeated takes, make three Shorts"), and the result appears on a normal, editable timeline. It is not a black-box generated MP4.

**Core principle:** the AI never touches the video. It can only propose small, typed timeline operations (cut this range, trim that clip, add Shorts). Every operation is validated before it is applied, recorded in a history, and grouped per instruction so one click undoes everything an instruction did.

**What "done" means** (from the original blueprint):

1. **Trustworthy agent.** Every AI change is visible on the timeline, inspectable, and undoable in one click.
2. **The core flow never breaks.** Upload a long video, index it, ask for edits, watch the timeline change, export.
3. **Backed by real numbers.** Systems performance and AI edit quality are measured and published.
4. **Live and used.** Deployed, documented, and used by a handful of real creators.

| Goal | Where we are |
|---|---|
| 1. Trustworthy agent | Largely met: plans shown first, per-cut opt-out, grouped undo, revert run, seam inspector |
| 2. Core flow works | Met locally and in CI: upload → index → AI edit → manual edit → server render, with and without AI keys |
| 3. Real numbers | Started: AI requests, tokens, latency and fallbacks are recorded per run (`agent_runs`); no evaluation set yet |
| 4. Live and used | Not started: runs locally only, no deployment, no users |

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Marketing site (home, pricing, sign-in, 404) | Done | 3D scenes, scroll story, custom cursor, smooth scroll |
| App pages (projects, upload, exports, settings, share) | Done | Share page on real renders; settings all wired; real usage |
| Editor UI | Done | Transcript, preview, 4-track timeline, AI chat, history, media, captions, export, command palette |
| Editing interactions | Done | Snapping, seam inspector, context menu, ranges, markers, J/K/L, loop, find-and-cut |
| Shared timeline engine and validation | Done | Same code on client and server |
| Auth (email and password) | Done | JWT, rate-limited, password change, account deletion; Google OAuth not wired |
| Resumable chunked upload | Done | Tested with forced interruption |
| Job queue | Done (in-process, SQLite) | Survives restarts, retries, priorities |
| Indexing: proxy, poster, waveform, silences, shots | Done | Bundled FFmpeg |
| Transcription | Done, free | Groq free Whisper, or local Whisper with no account; speech segments as last resort |
| Speaker diarization | **Pending** | All uploads are one speaker |
| Frame descriptions (vision) | **Pending** | Only the sample has one |
| AI agent | Done, free | Gemini, Groq, OpenRouter or Ollama; JSON plans, repair round, falls back to rules on limits |
| Op log, undo/redo, conflicts, snapshots | Done | 409 on stale writes, 422 on invalid ops |
| Server render (parallel segments, captions, Shorts) | Done | Resolution presets, audio cleanup, cancel, audio-only waveform video; center crop for vertical |
| B-roll in renders | **Pending** | Library is a placeholder |
| Evaluation set and metrics | **Pending** | Mock AI provider exists for deterministic tests |
| Deployment, CI/CD, Docker | Partly done | Dockerfile, compose, GitHub Actions CI; not deployed yet |
| Real users | **Pending** | |

---

## 3. How it works

### 3.1 Components

| Component | Tech | Responsibility |
|---|---|---|
| Web client | React 18, TypeScript, Vite, Tailwind, Framer Motion, React Three Fiber, Zustand | All UI; optimistic editing; offline demo mode |
| API server | Node, Express, TypeScript (`backend/src/server.ts`) | Auth, projects, uploads, op log, agent, renders; also serves the built frontend |
| Realtime | `ws` WebSocket hub (`backend/src/realtime.ts`) | Job progress, render progress, agent steps, edits from other tabs |
| Database | SQLite via better-sqlite3 (`backend/src/db.ts`) | Users, projects, ops, uploads, jobs, renders, snapshots |
| Job queue | In-process, persisted in SQLite (`backend/src/jobs/queue.ts`) | Ingest, render, demo footage; retries; crash recovery |
| Media | Bundled ffmpeg-static and ffprobe-static (`backend/src/media/ffmpeg.ts`) | Probe, proxy, audio, peaks, silences, shots, render |
| AI | Free: Gemini, Groq, OpenRouter, Ollama, local Whisper (`backend/src/ai/`) | Transcription; edit planning |
| Storage | Local disk (`backend/src/storage.ts`, `backend/storage/`) | Uploads, proxies, posters, renders |
| Shared | `shared/` | Timeline engine, validation, transcript analysis, planner, sample episode |

### 3.2 End-to-end flow

1. **Sign in.** `POST /api/auth/login` returns a JWT stored in the browser.
2. **Create a project and upload.** The client creates a project, asks for an upload session, and sends the file in 8 MB parts, three at a time. If a part fails, it backs off, asks the server which parts it already has, and only resends what's missing. Refreshing the page and choosing the same file resumes the same upload.
3. **Assemble and index.** When all parts are in, the server joins them and queues an `ingest` job:
   - Probe: duration, size, frame rate, codec, audio presence.
   - Proxy: a 540p H.264 copy for smooth browser preview.
   - Poster: one frame for thumbnails.
   - Audio: 16 kHz mono MP3 plus a peak value every 50 ms for the waveform.
   - Silences (FFmpeg `silencedetect`) and shot boundaries (scene-change filter).
   - Transcript: Groq's free Whisper with word timestamps (10-minute chunks), or local Whisper in ≤28 s windows that end in silences; without either, stretches of speech between silences. The engine and any reason for a limited transcript are stored on the index.
   - The raw index (words, silences, shots, peaks) is saved on the project. Progress for each step streams over the WebSocket.
4. **Open the editor.** The client loads the project, the raw index and the op log. `shared/analysis.ts` turns the raw index into sentences, filler labels and repeated-take labels. The current timeline is the result of replaying the log up to the project's `head`.
5. **Edit.** Manual edits and AI edits are both typed operations. The client applies them instantly (optimistic), then sends them to the server with `baseHead`. The server replays, validates every op, and either appends them or rejects:
   - **409** if the timeline changed elsewhere; the client reloads.
   - **422** if an op is invalid; the client rolls back and shows the reason.
6. **Ask the AI.** `POST /api/projects/:id/agent` returns a plan, and planning steps stream over the WebSocket. Nothing changes until the user clicks Apply, and they can untick individual cuts first. Applied cuts share a `runId`, so undo and revert act on the whole run.
7. **Export.** `POST /api/projects/:id/renders` queues one render job per sequence (main edit, each Short):
   - The kept ranges are split into segments of 15 s or less.
   - Segments render in parallel (`RENDER_WORKERS`), each retried on its own, with captions burned in and 12 ms audio fades at every cut.
   - The segments are joined without re-encoding.
   - Progress is reported per segment, and the file is downloadable from the Exports page.

### 3.3 The timeline data model (`shared/timeline.ts`)

The main video track is a list of kept source ranges in order. Removed ranges are remembered with who removed them, which powers the amber and blue strikethroughs and the seam inspector.

| Operation | What it does |
|---|---|
| `cut` / `deleteClip` | Remove a source range from the main track |
| `restore` | Put a removed range back; rejoins clips when a gap closes |
| `split` | Split a clip at a source time |
| `trim` | Move a clip's start or end, without overlapping neighbours |
| `addBroll` / `moveBroll` / `removeBroll` | B-roll anchored to a source moment, so it follows cuts |
| `captionEdit` / `captionStyle` / `captionsOn` | Caption text overrides and style |
| `addShorts` / `removeShort` | Vertical sequences made of source ranges |
| `addMarker` / `removeMarker` | Timeline markers |
| `setState` | Restore a snapshot as a new version |
| `revertRun` | Undo one AI run while keeping later edits |

**Validation rules (`validateOp`):** ranges must be inside the recording and non-empty; cuts must remove something still on the timeline; splits must land inside a clip; trims must reference the current clip and not overlap neighbours; referenced B-roll, Shorts, markers and runs must exist. These run on the server for every op, including AI ops.

### 3.4 The AI agent (`backend/src/ai/agent.ts`, `llm.ts`)

- **Providers (all free):** Gemini (OpenAI-compatible endpoint), Groq, OpenRouter `:free` models, Ollama (native API, so the context window can be raised), or any OpenAI-compatible server. Picked automatically from whichever key is set; `LLM_PROVIDER` forces one.
- **Prompt:** a compact transcript with sentence numbers, timestamps, pauses, ✂ for already-cut words, and tags for retakes and pre-roll. It is trimmed to the provider's free limits (`LLM_CONTEXT_WORDS`), with a note when that happens.
- **Answer:** one JSON object (JSON mode, with fence-tolerant parsing):
  - `cutSentences` (by number) and `cutPhrases` (exact quotes, matched tolerant of case and punctuation);
  - `cutRanges` (times the creator gave);
  - `shorts` (sentence ranges);
  - switches `removeFillers`, `removeRetakes` and `shortenPausesOver`, executed by the deterministic planner.
- **Checks:** the server converts everything to milliseconds, dedupes, and validates each cut in order. Failures go back to the model once for repair; if the repair call fails, the edits that passed are kept.
- **Fallback:** a missing key, rate limit, timeout or non-JSON reply makes the rule planner answer instead. The plan carries a note explaining why.
- **Rule planner (`shared/planner.ts`):** understands:
  - Shorts counts ("make 5 Shorts");
  - time ranges ("cut 1:20 to 1:45", "remove the first 10 seconds", "trim the last minute");
  - specific words ("remove every 'basically'");
  - pause thresholds;
  - the opening, retakes and fillers.
  It follows the Settings slider (pause thresholds 2 s, 1.5 s or 0.8 s) and "keep jokes".
- **Accounting:** every request is stored in `agent_runs` (provider, model, tokens, latency, fallback), shown in Settings.

### 3.5 Offline demo mode

If the backend is unreachable, or the app is opened as a single HTML file, the frontend runs the built-in sample episode entirely in the browser. It uses the same engine and planner, saves edits to localStorage, and simulates renders. `lib/session.ts` decides the mode at start-up.

---

## 4. Repository layout

```
Ai video editor/
  PROJECT_PLAN.md            this file
  README.md                  how to run
  shared/                    used by frontend and backend
    types.ts                 Word, Sentence, RawIndex, MediaIndex
    timeline.ts              ops, replay, validateOp, sequence mapping
    analysis.ts              sentences, fillers, repeated takes, stats
    planner.ts               rule planner, Shorts finder
    sample.ts                demo episode
  backend/
    src/server.ts            app, routes, static frontend, boot
    src/routes/api.ts        all HTTP endpoints
    src/ops.ts               validated op commits, conflicts
    src/jobs/                queue.ts, ingest.ts, render.ts
    src/ai/                  transcribe.ts, agent.ts
    src/media/ffmpeg.ts      FFmpeg wrappers
    src/selftest.ts          end-to-end test (npm test)
    .env.example
  frontend/
    src/pages/               Landing, Pricing, SignIn, Projects, Ingest, Editor, Exports, Settings, Share, NotFound
    src/components/editor/   Timeline, Preview, Transcript, AgentPanel, SidePanels, Overlays
    src/components/three/    FilmRibbon, Story, Scenes (3D)
    src/components/fx.tsx    cursor, smooth scroll, reveals, magnetic, tilt, transitions
    src/store/editor.ts      editor state, op sync, agent, playback
    src/lib/                 api.ts, session.ts, sample.ts, draw.ts, timeline.ts, agent.ts
```

---

## 5. Running it

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm start      # http://localhost:8787
# demo account: demo@cutline.dev / demo1234
npm test                                       # 20 unit tests
cd backend && npm test                         # end-to-end check, server must be running
npm run mock-ai                                # fake free-AI provider for testing the AI path offline
cd frontend && npm run dev                     # hot reload on :5173, proxies to :8787
```

| Setting (`backend/.env`) | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` | empty | Free edit agent; a Groq key also enables free transcription |
| `OLLAMA_MODEL`, `OLLAMA_URL` | empty, `http://localhost:11434` | Offline edit agent |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_CONTEXT_WORDS` | auto | Force or customise the agent |
| `STT_PROVIDER`, `WHISPER_LOCAL_MODEL`, `WHISPER_LANGUAGE` | auto, `Xenova/whisper-base`, auto-detect | Transcription choice |
| `PORT` | 8787 | API and web port |
| `JWT_SECRET` | derived (dev only) | Required (32+ chars) when `NODE_ENV=production` |
| `STORAGE_DIR` | `./storage` | Database, media, downloaded models |
| `DATABASE_URL` | empty (SQLite) | Postgres, e.g. a free Neon database |
| `RENDER_WORKERS` / `JOB_CONCURRENCY` | 3 / 2 | Parallelism |
| `RENDER_TTL_DAYS` | 7 | Render files are removed after this |
| `MAX_UPLOAD_GB` | 20 | Upload size limit |
| `CORS_ORIGIN`, `PUBLIC_URL` | `http://localhost:5173`, empty | Dev origin; public address |

---

## 6. API reference

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Status and which providers are active |
| `POST /api/auth/register`, `POST /api/auth/login` | Accounts; returns a token |
| `GET /api/me`, `PATCH /api/me`, `GET /api/me/usage` | Profile, settings, 30-day usage |
| `GET /api/projects`, `POST /api/projects` | List, create |
| `GET/PATCH/DELETE /api/projects/:id` | Load (index, ops, head, snapshots, media URLs), rename, delete |
| `GET /api/projects/:id/media/:kind` | Proxy or poster (supports range requests) |
| `POST /api/projects/:id/uploads` | Start or resume an upload |
| `GET /api/uploads/:uid`, `PUT /api/uploads/:uid/parts/:n`, `POST /api/uploads/:uid/complete` | Status, send part, finish |
| `POST /api/projects/:id/reindex` | Run indexing again (e.g. after adding a key) |
| `POST /api/projects/:id/ops` | Commit ops with `baseHead` |
| `PATCH /api/projects/:id/head` | Undo, redo, jump to version |
| `POST /api/projects/:id/snapshots` | Save a snapshot |
| `POST /api/projects/:id/agent` | Plan an edit |
| `POST /api/projects/:id/renders`, `GET /api/renders` | Start renders, list them |
| `GET /api/renders/:rid/file`, `POST /api/renders/:rid/retry` | Download or stream, retry |
| `GET /api/ai/status`, `POST /api/ai/test` | Active providers; round-trip test |
| `POST /api/me/password`, `DELETE /api/me` | Change password; delete account and all files |
| `POST /api/renders/:rid/cancel`, `DELETE /api/renders/:rid` | Cancel (kills FFmpeg); delete |
| `POST/DELETE /api/renders/:rid/share` | Create or revoke a review link |
| `GET /api/public/shares/:token`, `…/video`, `POST …/comments`, `POST …/approve` | Public review page, no sign-in |
| `WS /ws?token=` | Subscribe to a project: `job`, `render`, `ops`, `head`, `agent.step` events |

---

## 7. Editor features (for reference and testing)

- **Transcript:**
  - Select words and press Delete to cut; select struck words to restore.
  - Double-click to select a sentence.
  - Ctrl/⌘ F finds words and cuts every match.
  - One click removes all filler words.
- **Timeline:**
  - Trim by dragging clip edges, snapping to word edges and the playhead (Alt bypasses).
  - Click an amber or blue seam to see what was removed and restore it or play across it.
  - Right-click a clip for split, delete, restore the cut before or after, shorten pauses inside, or mark as range.
  - Shift-click selects several clips.
  - Shift-drag on the ruler, or press I and O, to mark a range, then press Delete to cut it.
  - M adds a marker. Drag B-roll to move it.
  - Ctrl/⌘ + scroll zooms around the pointer. Hovering previews that frame.
- **Playback:** Space, J/K/L shuttle with 1.5× and 2×, loop the marked range or selected clip, Home/End, arrow-key frame steps.
- **AI panel:**
  - The plan appears first, and proposed cuts are hatched on the timeline.
  - Expand a group to untick individual cuts or jump to hear them.
  - Apply creates one run. Show changes highlights it; Revert run removes it.
- **History:** every version, jump to any of them, snapshots.
- **Export:** main edit and each Short, with per-segment progress and download.
- **Command palette:** ⌘K.

---

## 8. Pending tasks

Priorities: **P0** blocks a public launch, **P1** is needed for "excellent" per the blueprint, **P2** is stretch.

### 8.1 P0: before anyone else uses it

| # | Task | Why | Done when |
|---|---|---|---|
| 1 | 🟡 **Deploy** (Dockerfile and compose written, not yet deployed) (Dockerfile, docker-compose, a host such as Fly.io, Railway or a VPS) | Goal 4 | Public URL; HTTPS; persistent volume for storage |
| 2 | ✅ **CI/CD** with GitHub Actions: typecheck, build, unit tests, `npm test` against a booted server | Keep the core flow from breaking | Every push runs the pipeline; main is always green |
| 3 | ✅ **Unit tests for `shared/`** (replay, validateOp, restore merging, planner, analysis) | The engine is the heart of the product | Coverage of every op type, edge cases, conflict paths |
| 4 | 🟡 **Security hardening:** (done: rate limits, production secret check, upload type check, security headers. Left: httpOnly cookie) httpOnly cookie instead of a localStorage token, rate limiting on auth and agent, strong `JWT_SECRET` required in production, upload file-type checks via ffprobe before indexing, size limits per plan | Public exposure | Basic security review checklist passes |
| 5 | **Password reset and email verification** | Real accounts | Reset link by email works |
| 6 | ✅ **Account deletion endpoint** (UI exists, server does not) | Settings promises it | Deletes user, projects and files |
| 7 | ✅ **Share page on real data:** public share tokens per render, viewer, timestamped comments stored server-side, approve button | Currently uses demo data | A shared link plays a real render without signing in |
| 8 | ✅ **Render cancel** and cleanup of old render files | Disk usage, user control | Cancel button stops the job; files older than N days removed (the "7 days" copy becomes true) |
| 9 | **Preview playback polish:** smoother playback across cuts (pre-seek the next clip, or two alternating video elements), and a waveform-only view for audio-only uploads | Cuts can stutter briefly when the video seeks | No audible gap at cuts in Chrome and Safari |
| 10 | 🟡 **Error states and empty states audit** (done: indexing retry, render failures, offline/demo banner, empty Exports) across all pages (failed indexing with retry button, failed render reasons, offline banner) | Trust | Every failure says what happened and what to do |

### 8.2 P1: to meet the blueprint fully

| # | Task | Notes |
|---|---|---|
| 11 | **Evaluation set: 50–100 clips** with instructions and hand-made expected cuts | Store under `eval/` with a manifest; mix of podcasts, tutorials, vlogs |
| 12 | **Eval runner in CI** | Metrics: op validity rate, acceptance rate (runs kept unmodified), repeated-take precision and recall, Shorts human rating 1–5, cost and latency per instruction. Fails CI on regressions |
| 13 | **Systems metrics** | p95 queue wait, indexing time per hour of footage, agent latency, render time for a 10-minute export, render throughput vs worker count, upload resume success under forced disconnects |
| 14 | 🟡 **Load test** (commit now applies ops incrementally; long-recording waveform crash fixed; load test not run): 3 hours of footage indexed; 500+ ops on one project without UI blocking | Server currently replays per op on commit: add incremental apply or state caching per head |
| 15 | **Speaker diarization** | Options: pyannote in a Python worker, or a hosted API. Feeds speaker colours and per-speaker Shorts reframing |
| 16 | **Frame descriptions** with a vision model on shot keyframes | Gives the agent visual context ("cut where the screen is blank") |
| 17 | ✅ **Use the user's AI settings in the agent** | Cutting strength, keep jokes, plan-first exist in Settings but are not yet sent to the planner |
| 18 | **Agent instruction coverage** | Chapters, "make it faster" pacing, hook reordering (needs a move op and non-source-order timelines) |
| 19 | ✅ **Cost tracking per agent run** (tokens and latency; transcription seconds not yet) | Store tokens and seconds; show in Settings usage |
| 20 | **Plan limits and usage enforcement** | Hours indexed and AI runs per plan; friendly limit messages |
| 21 | **Postgres option** | Swap SQLite for Postgres behind the same `db.ts` API for multi-instance deploys |
| 22 | **S3-compatible storage** with presigned multipart uploads straight from the browser | `storage.ts` is the seam; removes upload load from the API server |
| 23 | **BullMQ + Redis queue** and separate worker processes | `jobs/queue.ts` is the seam; enables horizontal render scaling |
| 24 | **Google OAuth** | Button exists, not wired |
| 25 | **Accessibility audit**: keyboard-only editing, screen reader labels on timeline elements, reduced-motion check on all 3D scenes, colour contrast | |
| 26 | **Mobile editor pass** | Usable today, not comfortable; touch trim handles, bottom-sheet panels |

### 8.3 P2: stretch features (only after P0 and P1)

| # | Task |
|---|---|
| 27 | Automatic vertical reframing with face or subject tracking (renders currently center-crop) |
| 28 | Real B-roll: user library uploads, stock search, rendering B-roll as overlays |
| 29 | Generative image or B-roll insertion |
| 30 | ✅ Audio cleanup: noise reduction and loudness normalization (FFmpeg `afftdn`, `loudnorm`) |
| 31 | Background music with auto-ducking under speech |
| 32 | Caption style editor (font, colour, position) and per-Short caption edits |
| 33 | ✅ Export presets: 720p, 4K, square; the Settings resolution choice applied to renders |
| 34 | Email or browser notifications when renders finish (setting exists, no sender) |
| 35 | Billing (Stripe) for the pricing page plans |
| 36 | Chapters and YouTube description export |

**Explicitly out of scope:** real-time multi-user editing, a transitions or effects library, colour grading, reference-style analysis.

### 8.4 Known issues and rough edges

- **Uploads with no transcription available** (no Groq key and local Whisper unable to download its model) get "(speech)" segments, so word-level features do nothing until you re-index. The editor says why and offers Re-index now.
- **The sample project** has no real footage. The preview draws an illustrated stand-in; renders use a generated test pattern with a running clock so cuts can be checked.
- **Undo after another tab edits** reloads the project instead of merging.
- **Server-side commit cost** is now linear: the log is replayed once per commit, then ops apply incrementally.
- **Fonts** load from Google Fonts; the offline single-file preview falls back to system fonts.
- **Caption burn-in** relies on libass finding a font. If it can't, renders continue without captions and say so.

---

## 8.5 Changelog v0.3 (26 October 2026)

**Free AI:**
- Replaced OpenAI and Anthropic with free providers (Gemini, Groq, OpenRouter, Ollama, local Whisper).
- JSON plans with a repair round, and a rule fallback on rate limits.
- A much smarter rule planner.

**Fixed:**
- Transactions never rolled back (SQLite) and weren't on one connection (Postgres).
- The waveform crashed on recordings over about 1.5 hours (`Math.max(...)` overflowed the call stack).
- Upload part tracking raced on Postgres; the files on disk are now the source of truth.
- Concurrent commits could both succeed; now locked.
- The job queue could exceed `JOB_CONCURRENCY`.
- MP3 cover art was treated as video.
- Audio-only uploads couldn't render; they now become a waveform video.

**Added:**
- Review links with comments and approval.
- Render cancel, delete and expiry sweep.
- Resolution presets and audio cleanup.
- Password change and account deletion.
- Rate limits and security headers.
- AI usage tracking.
- Unit tests, a mock AI provider, CI, Docker.

**UI:**
- AI setup card with Test connection.
- Real usage instead of hard-coded numbers.
- Offline/demo banner, re-index and retry buttons, an Exports empty state.
- Settings that actually apply (cutting strength, keep jokes, plan first, caption style, resolution).

## 9. Suggested schedule for the remaining work

| Week | Focus | Milestone |
|---|---|---|
| 1 | Tasks 2, 3, 4: CI, shared unit tests, security hardening | Green pipeline on every push |
| 2 | Tasks 1, 5, 6, 8: deploy, auth emails, account deletion, render cleanup | Public URL with real sign-up |
| 3 | Tasks 7, 9, 10: real share page, playback across cuts, error states | Core flow polished end to end |
| 4 | Tasks 11, 12: evaluation set and eval runner in CI | First quality numbers |
| 5 | Tasks 13, 14: systems metrics and load tests; fix replay cost | First performance numbers |
| 6 | Tasks 15, 17, 19: diarization, settings into the agent, cost tracking | Agent quality pass |
| 7 | Onboard 5–20 creators; collect feedback; fix what they hit | Real usage |
| 8 | Demo video, README metrics table, blog post ("Why my AI video editor never touches the video") | Launch |

Stretch tasks enter only if a week finishes early.

---

## 10. Metrics to publish

| Metric | Target or what it shows |
|---|---|
| Op validity rate | % of AI-proposed ops that pass validation first time (and after repair) |
| Acceptance rate | % of AI runs kept without modification or revert |
| Repeated-take detection | Precision and recall against hand labels |
| Shorts quality | Human rating 1–5 |
| Agent latency and cost | p50/p95 seconds and cents per instruction |
| Indexing | Minutes per hour of footage; 3 hours indexed without failure |
| Render | p95 time for a 10-minute export; throughput vs number of workers |
| Upload | Resume success rate under forced disconnects |
| Editor responsiveness | 500+ ops with no frame longer than 50 ms during edits |

Resume line, once measured: *"Built an AI-native video editing platform that converts natural-language instructions into validated, non-destructive timeline operations, with multimodal indexing, horizontally scaled FFmpeg render workers and resumable uploads; [X]% of agent edits accepted without modification, p95 render time of [Y] for a 10-minute export."*

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope creep into stretch features | Strict P0 → P1 → P2 order; stretch only when a week finishes early |
| AI proposes bad edits | Word-number proposals, server validation, repair round, plan-first review, per-cut opt-out, grouped undo |
| AI costs grow | Cache indexing results, send only the transcript, track cost per run (task 19), plan limits (task 20) |
| Long renders fail | Segment-level retries, job retries with backoff, crash recovery on restart |
| Large uploads fail | Chunked, resumable uploads with server-side part tracking |
| Single-machine limits | Seams in place for S3, Postgres and BullMQ (tasks 21–23) |
| Burnout | Weekly milestones; something demoable every week |

---

## 12. Decisions so far

| Decision | Reason |
|---|---|
| Op log with replay, not mutable timeline state | Undo, history, conflict checks and AI grouping come for free |
| Shared engine in `shared/` | Client and server validate with the same rules; no drift |
| AI proposes word and sentence numbers, code computes milliseconds | Models are unreliable with raw timestamps; validation is exact |
| SQLite, local disk and in-process queue first | Zero-setup local runs; clear seams for Postgres, S3 and BullMQ |
| Bundled FFmpeg via npm | No system install; same binary everywhere |
| Optimistic client with server as the authority | Instant UI, consistent history, clear 409 and 422 handling |
| Offline demo mode | The UI can be shown anywhere, even without the server |
| Parallel segment rendering with per-segment captions | Faster renders, isolated retries, no extra full re-encode |
