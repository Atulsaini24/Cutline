// Stand-in "footage" drawn on canvas so the prototype runs without real video.
// Replace with <video> / WebCodecs playback of proxy files once the media pipeline exists.

import { sentAt, wordAt, type Sentence } from './sample'
import { keptIn, type CaptionStyle, type Range } from './timeline'

export const SCENE_W = 960, SCENE_H = 540

function person(c: CanvasRenderingContext2D, cx: number, by: number, sc: number, skin: string, hair: string, top: string, talk: boolean, t: number) {
  c.save(); c.translate(cx, by); c.scale(sc, sc)
  const g = c.createLinearGradient(0, -150, 0, 0); g.addColorStop(0, top); g.addColorStop(1, shade(top, -30))
  c.fillStyle = g; c.beginPath(); c.moveTo(-125, 0); c.bezierCurveTo(-125, -120, -62, -152, 0, -152); c.bezierCurveTo(62, -152, 125, -120, 125, 0); c.fill()
  c.fillStyle = shade(skin, -18); c.fillRect(-22, -178, 44, 42)
  c.fillStyle = skin; c.beginPath(); c.ellipse(0, -226, 52, 64, 0, 0, Math.PI * 2); c.fill()
  c.fillStyle = hair; c.beginPath(); c.ellipse(0, -262, 57, 35, 0, Math.PI, Math.PI * 2); c.fill(); c.fillRect(-57, -264, 13, 42)
  c.fillStyle = '#1b1b1f'; c.beginPath(); c.arc(-18, -229, 4.5, 0, 7); c.arc(18, -229, 4.5, 0, 7); c.fill()
  const mo = talk ? 4 + 7 * Math.abs(Math.sin(t / 70)) : 2
  c.fillStyle = '#5b2a25'; c.beginPath(); c.ellipse(0, -196, 13, mo, 0, 0, 7); c.fill()
  c.restore()
}
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt))
  return `rgb(${r},${g},${b})`
}

export function drawScene(c: CanvasRenderingContext2D, src: number) {
  const W = SCENE_W, H = SCENE_H
  const s = sentAt(src); const talk = !!wordAt(src)
  if (s.spk === 'M') {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#5d5249'); g.addColorStop(1, '#27231f'); c.fillStyle = g; c.fillRect(0, 0, W, H)
    c.fillStyle = '#3d332b'; c.fillRect(650, 80, 240, 360); c.fillStyle = '#2a221c'; [150, 250, 350].forEach(y => c.fillRect(650, y, 240, 10))
    ;['#8a5a44', '#4f6d7a', '#9b8a5c', '#6d4f6e', '#58745a', '#a0663f'].forEach((col, i) => {
      c.fillStyle = col; c.fillRect(662 + i * 36, 100 + (i % 2) * 8, 26, 50 - (i % 2) * 8); c.fillRect(668 + i * 34, 198, 22, 52); c.fillRect(664 + i * 35, 296 + (i % 3) * 6, 28, 54 - (i % 3) * 6)
    })
    const lg = c.createRadialGradient(140, 40, 10, 140, 40, 440); lg.addColorStop(0, 'rgba(255,214,160,.42)'); lg.addColorStop(1, 'rgba(255,214,160,0)'); c.fillStyle = lg; c.fillRect(0, 0, W, H)
    person(c, 390, 560, 1.25, '#d9a684', '#2c1d16', '#5b7fae', talk, src)
  } else {
    c.fillStyle = '#2a2f37'; c.fillRect(0, 0, W, H)
    for (let x = 0; x < W; x += 46) {
      c.fillStyle = (x / 46) % 2 ? '#3a414c' : '#323843'
      c.beginPath(); c.moveTo(x, 0); c.quadraticCurveTo(x + 23, 270, x, 540); c.lineTo(x + 46, 540); c.quadraticCurveTo(x + 23, 270, x + 46, 0); c.fill()
    }
    const lg = c.createRadialGradient(820, 60, 10, 820, 60, 480); lg.addColorStop(0, 'rgba(190,220,255,.32)'); lg.addColorStop(1, 'rgba(190,220,255,0)'); c.fillStyle = lg; c.fillRect(0, 0, W, H)
    person(c, 560, 560, 1.2, '#8d5a3b', '#151214', '#7f8d55', talk, src)
  }
  c.fillStyle = '#141518'; c.save(); c.translate(470, 420); c.rotate(-0.5); c.beginPath(); c.roundRect(-13, -72, 26, 72, 10); c.fill(); c.restore()
  c.fillStyle = '#1e2024'; c.fillRect(455, 400, 8, 140)
  // vignette
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = v; c.fillRect(0, 0, W, H)
}

export function drawBroll(c: CanvasRenderingContext2D, W: number, H: number, id: string, p: number) {
  c.fillStyle = '#22252b'; c.fillRect(0, 0, W, H)
  if (id === 'blankets') for (let x = -20; x < W + 40; x += W / 12) {
    c.fillStyle = Math.round(x / (W / 12)) % 2 ? '#46506a' : '#3b4459'
    c.beginPath(); c.moveTo(x + p * 20, 0); c.quadraticCurveTo(x + W / 24, H / 2, x + p * 10, H); c.lineTo(x + W / 12, H); c.quadraticCurveTo(x + W / 12, H / 2, x + W / 12, 0); c.fill()
  }
  if (id === 'mic') {
    const g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 1.5); g.addColorStop(0, '#3d3b38'); g.addColorStop(1, '#141414'); c.fillStyle = g; c.fillRect(0, 0, W, H)
    const s = 1 + p * 0.08; c.save(); c.translate(W / 2, H / 2); c.scale(s, s); c.rotate(-0.35)
    c.fillStyle = '#0d0d0e'; c.fillRect(-W * 0.09, -H * 0.42, W * 0.18, H * 0.8); c.fillStyle = '#2d2e31'
    for (let y = -H * 0.4; y < -H * 0.05; y += H * 0.035) c.fillRect(-W * 0.085, y, W * 0.17, H * 0.012)
    c.restore()
  }
  if (id === 'light') {
    c.fillStyle = '#d8d2c6'; c.fillRect(0, 0, W, H * 0.4)
    const g = c.createRadialGradient(W * 0.55, H * 0.1, 5, W * 0.55, H * 0.1, W * 0.7 * (0.8 + p * 0.3)); g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(1, 'rgba(255,250,235,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H)
    c.fillStyle = '#2b2b2e'; c.fillRect(W * 0.2, H * 0.55, W * 0.18, H * 0.06); c.fillRect(W * 0.28, H * 0.6, W * 0.02, H * 0.4)
  }
  if (id === 'mat') {
    c.fillStyle = '#4a3c30'; c.fillRect(0, 0, W, H); c.fillStyle = '#5f6064'; c.fillRect(W * 0.12, H * 0.3, W * 0.76, H * 0.45)
    c.fillStyle = '#d9d6cf'; c.fillRect(W * 0.18, H * 0.36, W * 0.64, H * 0.3); c.fillStyle = '#bab6ad'
    for (let r = 0; r < 4; r++) for (let k = 0; k < 13; k++) c.fillRect(W * 0.2 + k * W * 0.047 + (r % 2) * 6, H * 0.39 + r * H * 0.065, W * 0.04, H * 0.05)
  }
}

export function drawCaption(c: CanvasRenderingContext2D, W: number, H: number, src: number, r: Range[], style: CaptionStyle, vertical: boolean, edited?: string) {
  const s: Sentence = sentAt(src)
  const ws = s.w.filter(w => keptIn(r, (w.s + w.e) / 2) && w.text !== '(speech)')
  if (!ws.length || src > s.e + 600 || src < s.s - 200) return
  const cur = wordAt(src)
  let scale = (H / 540) * (vertical ? 0.9 : 1)
  if (style === 'bold') {
    const ci = Math.max(0, ws.findIndex(w => cur && w.i === cur.i)); const start = Math.floor(ci / 3) * 3; const chunk = ws.slice(start, start + 3)
    c.font = `800 ${Math.round(40 * scale)}px "Bricolage Grotesque", sans-serif`; c.textAlign = 'center'; c.lineJoin = 'round'
    const txt = chunk.map(w => w.text.replace(/[,.]$/, '')); let widths = txt.map(t => c.measureText(t + ' ').width); let tot = widths.reduce((a, b) => a + b, 0)
    if (tot > W * 0.88) { const f = (W * 0.88) / tot; c.font = `800 ${Math.round(40 * scale * f)}px "Bricolage Grotesque", sans-serif`; widths = widths.map(w => w * f); tot *= f; scale *= f }
    let x = W / 2 - tot / 2; const y = H * (vertical ? 0.72 : 0.86)
    chunk.forEach((w, i) => {
      const cx = x + widths[i] / 2; const active = cur && w.i === cur.i
      c.save(); if (active) { c.translate(cx, y); c.scale(1.08, 1.08); c.translate(-cx, -y) }
      c.lineWidth = 9 * scale; c.strokeStyle = '#000'; c.strokeText(txt[i], cx, y)
      c.fillStyle = active ? '#FFD27A' : '#fff'; c.fillText(txt[i], cx, y); c.restore()
      x += widths[i]
    })
    c.textAlign = 'start'
    return
  }
  const text = edited ?? ws.map(w => w.text).join(' ')
  const fs = Math.round((style === 'boxed' ? 22 : 25) * scale); c.font = `600 ${fs}px Manrope, sans-serif`
  const maxW = W * 0.8; const lines: string[] = []; let line = ''
  text.split(' ').forEach(t => { const tryL = line ? line + ' ' + t : t; if (c.measureText(tryL).width > maxW && line) { lines.push(line); line = t } else line = tryL })
  if (line) lines.push(line)
  const lh = fs * 1.3; let y = H * 0.9 - (lines.length - 1) * lh
  lines.forEach(l => {
    const w = c.measureText(l).width; const x = (W - w) / 2
    if (style === 'boxed') { c.fillStyle = 'rgba(0,0,0,.72)'; c.beginPath(); c.roundRect(x - 12 * scale, y - fs * 1.05, w + 24 * scale, fs * 1.45, 6 * scale); c.fill(); c.fillStyle = '#fff'; c.fillText(l, x, y) }
    else { c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 8 * scale; c.fillStyle = '#fff'; c.fillText(l, x, y); c.shadowBlur = 0 }
    y += lh
  })
}

/** Small offscreen render of a moment, used for thumbnails and 3D textures. */
export function frameCanvas(src: number, w = 320, h = 180, broll?: string) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const c = cv.getContext('2d')!
  if (broll) { drawBroll(c, w, h, broll, 0.5); return cv }
  const sc = document.createElement('canvas'); sc.width = SCENE_W; sc.height = SCENE_H
  drawScene(sc.getContext('2d')!, src); c.drawImage(sc, 0, 0, w, h)
  return cv
}
