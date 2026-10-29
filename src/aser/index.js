import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { SUBJECT_KEYS, levelFor, isSubjectComplete, levelLabel } from './aserScoring.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Content is versioned. A phone that synced weeks later with an older
// tool version must still be scored against the content it actually used,
// so keep old versions here when the booklet changes.
const CONTENT_BY_VERSION = {}
for (const file of fs.readdirSync(__dirname).filter(f => /^aser.*\.json$/.test(f))) {
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))
  CONTENT_BY_VERSION[content.version] = content
}

// The version new evaluations are created with (the teacher app ships the
// same file). Older versions stay loaded so old records still score.
export const CURRENT_VERSION = 'aser2018-v4'

export function contentFor(version) {
  return CONTENT_BY_VERSION[version] || null
}

// Recompute every level from the raw per-item marks.
export function scoreEvaluation(version, sampleNo, responses) {
  const content = contentFor(version)
  if (!content) return null
  const out = {}
  for (const subject of SUBJECT_KEYS) {
    const steps = responses?.[subject]?.steps || []
    out[subject] = {
      level: levelFor(subject, content, sampleNo, steps),
      complete: isSubjectComplete(subject, content, sampleNo, responses?.[subject]),
      stepsTaken: steps.length
    }
  }
  return out
}

export function labelFor(version, subject, rank) {
  const content = contentFor(version)
  return content ? levelLabel(content, subject, rank) : String(rank)
}

export { SUBJECT_KEYS }
