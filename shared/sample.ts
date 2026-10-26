// The built-in demo episode, as an indexing worker would return it.
import type { RawIndex } from './types'

const SCRIPT: ['M' | 'D', string, number, ('preroll' | 'retake')?][] = [
  ['M', 'Okay, is it, is it recording? Yeah, the red light’s on.', 2600, 'preroll'],
  ['M', 'Alright, um, let’s just start.', 2200, 'preroll'],
  ['M', 'Welcome back to Small Room Sound, I’m Maya.', 1900],
  ['M', 'Most people think a home studio costs, uh, thousands of dollars.', 700, 'retake'],
  ['M', 'Most people think a decent home studio costs thousands of dollars.', 1300],
  ['M', 'I built this entire setup for under four hundred, and nobody on the channel noticed.', 600],
  ['M', 'Today Dev is here to show exactly how we did it.', 500],
  ['D', 'Thanks for having me. So, um, the first thing is the room, not the gear.', 900],
  ['D', 'Your room is, like, the biggest microphone you own.', 700],
  ['D', 'Every flat wall is basically a mirror for sound.', 600],
  ['D', 'We hung two moving blankets behind the desk and the echo just, you know, collapsed.', 700],
  ['M', 'Wait, two blankets? That’s it?', 500],
  ['D', 'Two blankets and a bookshelf full of, uh, random stuff.', 600],
  ['D', 'Uneven surfaces scatter the sound instead of bouncing it.', 800, 'retake'],
  ['D', 'Uneven surfaces scatter the reflections instead of sending them straight back at you.', 1700],
  ['M', 'Okay so, um, what about the microphone itself?', 900],
  ['D', 'Honestly, a dynamic mic beats a condenser in a room like this.', 600],
  ['D', 'It only hears what’s right in front of it, so the room matters less.', 600],
  ['M', 'Which one did we end up with?', 500],
  ['D', 'A used broadcast dynamic, sixty dollars on a marketplace listing.', 700],
  ['M', 'Sixty dollars. I keep telling people that number and they don’t believe me.', 2100],
  ['D', 'Then the interface. Um, you don’t need eight.', 800, 'retake'],
  ['D', 'Then the interface, and you really don’t need eight inputs. Two is plenty.', 600],
  ['D', 'Ours was ninety dollars and the preamps are, uh, genuinely clean.', 1200],
  ['M', 'And lighting, because people always ask about the lighting.', 600],
  ['D', 'One big soft light at forty-five degrees, bounced off the ceiling.', 600],
  ['D', 'Shadows get softer and your face stops looking like a crime documentary.', 500],
  ['M', 'That’s the part that made the biggest difference on camera, honestly.', 2400],
  ['D', 'The last thing is your desk, because it reflects straight into the mic.', 600],
  ['D', 'A cheap foam mat under the keyboard fixed a weird ringing we had for months.', 900],
  ['M', 'So the full list is blankets, a used dynamic mic, a small interface, and one light.', 600],
  ['M', 'If you build your own, tag us. We’d genuinely love to see it.', 500],
  ['M', 'See you next week.', 400],
]
export const sampleHash = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) }

export function buildSampleRaw(): RawIndex {
  const words: RawIndex['words'] = []; const starts: number[] = []; const tags: Record<number, 'preroll' | 'retake'> = {}
  let t = 0
  SCRIPT.forEach(([spk, text, gap, tag], si) => {
    t += gap; starts.push(words.length); if (tag) tags[si] = tag
    const toks = text.split(' ')
    toks.forEach((tok, ti) => {
      const clean = tok.replace(/[^A-Za-z’'-]/g, '')
      const d = Math.round(170 + clean.length * 55 + sampleHash(si * 31 + ti) * 90)
      words.push({ text: tok, s: t, e: t + d, spk }); t += d
      if (/,$/.test(tok)) t += 240; else if (/[.?!]$/.test(tok) && ti < toks.length - 1) t += 380; else t += 60
    })
  })
  return {
    id: 'sample', duration: t + 1600, source: 'sample', words, sentenceStarts: starts, tags,
    speakers: [{ id: 'M', name: 'Maya', color: '#7CC4FF' }, { id: 'D', name: 'Dev', color: '#5FD3A1' }],
    frames: [{ t: 30000, text: 'Two people at a desk, moving blankets on the wall, soft key light.' }],
    shortsHints: [
      { a: 8, b: 14, title: 'Your room is the biggest microphone you own', hook: '“Every flat wall is basically a mirror for sound.”', score: 92 },
      { a: 15, b: 20, title: 'A $60 mic beat our condenser', hook: '“Sixty dollars. They don’t believe me.”', score: 88 },
      { a: 24, b: 27, title: 'Stop looking like a crime documentary', hook: '“One big soft light, bounced off the ceiling.”', score: 84 },
    ],
  }
}
