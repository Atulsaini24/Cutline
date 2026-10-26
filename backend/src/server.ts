import express from 'express'
import cors from 'cors'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config'
import { db, initDb, isPostgres } from './db'
import { api } from './routes/api'
import { attachRealtime } from './realtime'
import { startQueue } from './jobs/queue'
import { securityHeaders } from './security'
import { localWhisperAvailable } from './ai/transcribe'
import './jobs/ingest'
import { sweepStorage } from './jobs/render'
import { seed } from './seed'

if (config.production && (config.jwtSecretIsDefault || config.jwtSecret.length < 32)) {
  console.error('Refusing to start: set JWT_SECRET to a random string of at least 32 characters in production.\n  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  process.exit(1)
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1) // correct client IPs (for rate limits) behind Render, Railway, Nginx, etc.
app.use(securityHeaders)
app.use(cors({ origin: config.corsOrigin, credentials: true }))
app.use('/api', (req, res, next) => req.path.match(/^\/uploads\/[^/]+\/parts\//) ? next() : express.json({ limit: '10mb' })(req, res, next))
app.use('/api', api)
app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }))

// Serve the built frontend if it exists, so one process runs the whole app.
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
if (fs.existsSync(web)) {
  app.use('/assets', express.static(path.join(web, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use(express.static(web, { index: false }))
  app.get('*', (_req, res) => res.sendFile(path.join(web, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }))
}

const server = http.createServer(app)
attachRealtime(server)
await initDb()
await seed()
await startQueue()
setInterval(() => { void sweepStorage().catch(e => console.error('[sweep]', e.message)) }, 60 * 60_000).unref()
void sweepStorage().catch(() => {})

server.listen(config.port, async () => {
  const stt = config.stt.id === 'groq' ? `Groq ${config.stt.model} (free tier)`
    : config.stt.id === 'custom' ? `${config.stt.model} at ${config.stt.baseUrl}`
    : config.stt.id === 'local' ? (await localWhisperAvailable() ? `local Whisper (${config.stt.localModel}), no account needed` : 'speech segments only. For word transcripts: npm install @huggingface/transformers, or add a free GROQ_API_KEY')
    : 'off'
  console.log(`Cutline on http://localhost:${config.port}`)
  console.log(`  database:      ${isPostgres ? 'PostgreSQL' : 'SQLite (' + config.dbFile + ')'}`)
  console.log(`  storage:       ${config.storageDir}`)
  console.log(`  transcription: ${stt}`)
  console.log(`  edit agent:    ${config.llm.id === 'none' ? 'built-in planner. For any instruction, add a free GEMINI_API_KEY or GROQ_API_KEY, or run Ollama' : `${config.llm.label}, ${config.llm.model}`}`)
  if (config.jwtSecretIsDefault) console.log('  note: JWT_SECRET is not set; fine locally, required in production')
  if (fs.existsSync(web)) console.log(`  serving the web app from ${web}`)
  else console.log('  web app not built yet: run "npm run build" in frontend/ (or use "npm run dev" there)')
})

const shutdown = (sig: string) => {
  console.log(`\n${sig}: shutting down`)
  server.close(); void db.close().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
