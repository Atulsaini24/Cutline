# Cutline: AI-native video editor

Upload a long recording, describe the edit in plain English (“tighten the first 15 seconds, remove repeated takes, make three Shorts”), and the result lands on a real, editable timeline. The AI never touches the video: it proposes small, typed timeline operations, and every one is validated before it is applied, recorded in a history, and grouped so one click undoes a whole instruction.

**It costs nothing to run.** No OpenAI or Anthropic account is needed. The AI can be Google Gemini’s free tier, Groq’s free tier, an OpenRouter free model, or Ollama running on your own computer. Transcription can be Groq’s free Whisper or Whisper running inside the server with no account at all. With nothing configured, a built-in rule planner still handles most everyday edits.

```
frontend/   React 18, TypeScript, Vite, Tailwind, Framer Motion, React Three Fiber, Zustand
backend/    Node, Express, TypeScript, SQLite or Postgres, bundled FFmpeg, WebSockets
shared/     Timeline engine, op validation, transcript analysis, rule planner (used by both)
```

## Quick start

You need **Node.js 20 or newer**. FFmpeg and SQLite are installed by npm, so there is nothing else to install.

```bash
npm run setup     # installs backend + frontend and builds the web app (first time: a few minutes)
npm start         # http://localhost:8787
```

Sign in with **demo@cutline.dev / demo1234**. That account is created on first start with a sample episode.

The terminal tells you exactly which AI is active, for example:

```
Cutline on http://localhost:8787
  transcription: local Whisper (Xenova/whisper-base), no account needed
  edit agent:    built-in planner. For any instruction, add a free GEMINI_API_KEY or GROQ_API_KEY, or run Ollama
```

For frontend work with hot reload, keep `npm start` running and run `npm run dev:web` in a second terminal (http://localhost:5173).

## Turn on the free AI (2 minutes)

Copy `backend/.env.example` to `backend/.env`, add **one** key, and restart. The Settings page in the app shows the same steps, a live status, and a **Test connection** button.

| Option | What you get | How |
|---|---|---|
| **Google Gemini** (recommended for editing) | Edit agent with a huge free context window, so whole transcripts fit | Free key at https://aistudio.google.com/apikey → `GEMINI_API_KEY=...` |
| **Groq** (recommended for transcription) | Whisper large-v3-turbo word-level transcription **and** an edit agent, very fast | Free key at https://console.groq.com/keys → `GROQ_API_KEY=...` |
| **Both together** (best) | Groq transcribes, Gemini edits | Set both keys |
| **Ollama** (fully offline) | Edit agent on your own machine, no account; needs about 8 GB RAM | Install https://ollama.com, run `ollama pull qwen2.5:7b`, set `OLLAMA_MODEL=qwen2.5:7b` |
| **Local Whisper** (fully offline) | Word-level transcription with no account | Installed automatically by `npm install`; the model (~80 MB) downloads on first use |

After turning on transcription, open an existing project and choose **Re-index now** so it gets a word-level transcript.

**Free tiers have limits.** When a limit is reached, the editor tells you why and the built-in planner makes the plan instead, so nothing ever dead-ends. Usage (requests, tokens, fallbacks) is shown in Settings.

### What works with no AI at all

The built-in planner understands:
- “Tighten the first 15 seconds”
- “Remove repeated takes and filler”
- “Shorten pauses longer than 2 seconds”
- “Cut 1:20 to 1:45”
- “Remove the first 10 seconds” or “Trim the last minute”
- “Remove every ‘basically’”
- “Make 5 Shorts”

It follows the **How hard to cut** and **Keep jokes** settings. An AI provider adds everything else, such as “remove the off-topic tangent about my cat”, and better Shorts picks.

## How the AI works (and why it is cheap on free tiers)

1. The model gets a compact, numbered transcript (`S12 [1:02.3] Maya: …`). Already-cut words are shown as ✂, and false starts are marked.
2. It replies in JSON:
   - whole sentences to cut, by number, and exact quoted phrases to cut;
   - Shorts as sentence ranges;
   - switches such as `removeFillers` and `shortenPausesOver` for mechanical jobs, which code does more precisely than a model.
3. The server turns those into exact milliseconds and validates every edit against the timeline. Anything that fails goes back to the model once for repair.
4. Nothing changes until you press **Apply**, and every applied plan is one undoable run.

JSON mode works on far more free and local models than tool calling, and quoting phrases uses about half the tokens of numbering every word. That matters under free-tier limits.

## Check that it works

```bash
npm test                      # 20 unit tests: timeline engine, planner, AI layer (no server needed)
npm start                     # then, in another terminal:
npm run test:e2e              # end-to-end against the running server
```

The end-to-end test covers:
- registration, a resumable upload with a simulated drop, and indexing
- range-request streaming of the preview proxy
- valid, invalid and conflicting edits; the agent; undo and redo
- parallel rendering, 720p export, audio cleanup and cancel
- review links with comments and approval, and revoking them
- refusing non-media uploads, audio-only podcasts, password change and account deletion

**Testing the AI path without any key:** `npm run mock-ai` starts a fake server that speaks the same API as Gemini, Groq and Whisper. Start the backend with:

```
LLM_PROVIDER=custom LLM_BASE_URL=http://localhost:9911/v1 LLM_MODEL=mock STT_PROVIDER=custom STT_BASE_URL=http://localhost:9911/v1
```

Then `npm run test:e2e` also checks transcription, plan parsing, the repair round, and the rate-limit fallback. GitHub Actions (`.github/workflows/ci.yml`) runs all of this on every push.

## Deploy for free

The whole app is one process. With Docker:

```bash
docker compose up --build                       # http://localhost:8787, data kept in a volume
docker compose --profile offline up --build     # also starts Ollama for an offline agent
```

In production, set `NODE_ENV=production` and a long random `JWT_SECRET`; the server refuses to start without one. Video work needs CPU and disk, so pick a host with a persistent disk:

- **Oracle Cloud Always Free** (4 ARM cores, 24 GB RAM). The most capable free option; run the Docker image on it.
- **Any small VPS**, or your own computer with a tunnel (Cloudflare Tunnel is free) for demos.
- Free web hosts that sleep and have no persistent disk (for example Render’s free tier) are fine for showing the UI, but uploads and renders are lost on restart.

Note: the Dockerfile and compose file were written carefully but not built in the environment where they were written. If the build fails, check the log.

## Troubleshooting

| Problem | Fix |
|---|---|
| Transcript shows “(speech)” blocks instead of words | No transcription ran. Add a free `GROQ_API_KEY`, or make sure local Whisper could download its model (needs internet the first time), then **Re-index now**. The editor shows the exact reason. |
| “free-tier limit was reached” | Wait a minute, or add a second provider. The built-in planner already made a plan for you. |
| Ollama: “Can’t reach Ollama” | Run `ollama serve`, and check `OLLAMA_URL`. |
| Ollama: model not found | Run `ollama pull qwen2.5:7b`, or whichever model `OLLAMA_MODEL` names. |
| Local Whisper: “ONNX runtime is missing” | In `backend/` run `npm rebuild onnxruntime-node`. |
| Captions missing from renders | The machine has no fonts for FFmpeg. Install DejaVu fonts; the Docker image already has them. |
| Port in use | Set `PORT=8790` in `backend/.env`. |

## Project layout

```
backend/src/
  server.ts          app, security headers, static web app, hourly storage sweep
  routes/api.ts      every HTTP endpoint (see PROJECT_PLAN.md)
  ai/llm.ts          one client for Gemini, Groq, OpenRouter, Ollama, any OpenAI-compatible server
  ai/agent.ts        transcript → JSON plan → validated edits; repair round; rule fallback
  ai/transcribe.ts   Groq Whisper, local Whisper (transformers.js), speech-segment fallback
  jobs/              queue (retries, cancel, crash recovery), ingest, render, cleanup
  media/ffmpeg.ts    probe, proxy, waveform, silences, shots, loudness
  security.ts        rate limits, headers, upload type check
  dev/mock-ai.ts     fake AI provider for tests and CI
shared/              timeline.ts, analysis.ts, planner.ts, sample.ts, tests/
frontend/src/        pages/, components/editor/, store/editor.ts, lib/
```

## Honest limitations

- **Speakers:** every upload is labelled as one speaker; diarization isn’t implemented.
- **Shorts framing:** Shorts are center-cropped to 9:16; there is no face tracking.
- **B-roll:** the B-roll library is a placeholder.
- **Login tokens:** sessions use a token stored in the browser rather than an httpOnly cookie. Fine for a portfolio project; worth changing before handling real users’ data.
- **Rate limits:** they are kept in memory, so they reset on restart and apply per server.
