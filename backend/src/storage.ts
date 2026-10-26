// Local-disk storage. Same layout an S3 bucket would use, so swapping the driver later is contained here.
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'

export const dirs = {
  project: (pid: string) => path.join(config.storageDir, 'projects', pid),
  parts: (uid: string) => path.join(config.storageDir, 'uploads', uid),
  renders: (pid: string) => path.join(config.storageDir, 'projects', pid, 'renders'),
}
export function ensure(dir: string) { fs.mkdirSync(dir, { recursive: true }); return dir }
export async function assembleParts(uploadId: string, total: number, dest: string) {
  ensure(path.dirname(dest))
  const out = fs.createWriteStream(dest)
  for (let n = 0; n < total; n++) {
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(path.join(dirs.parts(uploadId), String(n)))
      rs.on('error', reject); rs.on('end', resolve); rs.pipe(out, { end: false })
    })
  }
  await new Promise<void>(r => out.end(r))
  fs.rmSync(dirs.parts(uploadId), { recursive: true, force: true })
}
