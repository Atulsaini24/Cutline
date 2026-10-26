import { db, id, now } from './db'
import { createUser } from './auth'
import { enqueue } from './jobs/queue'
import { buildSampleRaw } from '../../shared/sample'

export const DEMO = { email: 'demo@cutline.dev', password: 'demo1234' }
/** First boot: a demo account with the sample episode, so the app has something to open. */
export async function seed() {
  const count = (((await db.prepare('SELECT COUNT(*) n FROM users').get()) as any)?.n ?? 0)
  if (count > 0) return
  const u = await createUser(DEMO.email, 'Maya Okafor', DEMO.password)
  const raw = buildSampleRaw(); const pid = id('p_')
  await db.prepare('INSERT INTO projects (id, user_id, title, status, duration, index_json, asset_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, u.id, 'Episode 14, home studio on a budget', 'ready', raw.duration, JSON.stringify(raw), JSON.stringify({ fileName: 'episode-14-sample.mp4', synthetic: true }), now(), now())
  await enqueue('demo-footage', pid, { projectId: pid })
  console.log(`Seeded demo account ${DEMO.email} / ${DEMO.password}`)
}
