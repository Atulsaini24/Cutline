// Types shared by the frontend and the backend.

export interface Word { i: number; text: string; s: number; e: number; sent: number; spk: string; filler: boolean }
export interface Sentence { i: number; spk: string; tag: 'preroll' | 'retake' | null; s: number; e: number; w: Word[] }
export interface Speaker { id: string; name: string; color: string }
export interface Range { s: number; e: number }
export interface ShortHint { a: number; b: number; title: string; hook: string; score: number }

/** What the indexing workers produce. Small and JSON-friendly; rebuilt into a MediaIndex with buildIndex(). */
export interface RawIndex {
  id: string
  duration: number
  source: 'whisper' | 'sample' | 'segments'
  words: { text: string; s: number; e: number; spk?: string }[]
  speakers?: Speaker[]
  sentenceStarts?: number[]               // word indices where sentences begin (optional)
  tags?: Record<number, 'preroll' | 'retake'>
  scenes?: number[]                        // shot boundaries in ms
  silences?: Range[]
  frames?: { t: number; text: string }[]   // frame descriptions
  peaks?: number[]                         // audio peak per 50 ms, 0..1
  shortsHints?: ShortHint[]
  engine?: string                          // which transcriber produced the words
  note?: string                            // why the transcript is limited, if it is
}

export interface MediaIndex extends Omit<RawIndex, 'words'> {
  words: Word[]
  sentences: Sentence[]
  speakers: Speaker[]
  stats: { speakers: number; shots: number; fillers: number; retakes: number; pauses: number; words: number; lines: number }
}
