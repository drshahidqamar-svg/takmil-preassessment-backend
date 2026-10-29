import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { SUBJECT_KEYS, levelFor, isSubjectComplete, levelLabel, stepDef, stepItems } from './aserScoring.js'

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

// Subject marks (UAT US-11): 1 mark per item marked correct. The subject
// total is the number of items in every section of the subject -- also
// the sections the child never reached (stopped at a gate), which score 0.
// - A section tried more than once (the second paragraph) counts once, by
//   its best try, so marks can never exceed the total.
// - From v3 each section has its own sample; an attempted section is
//   counted with the sample it used, an unreached one with the
//   evaluation's sample (only story length differs between samples).
// - Sections are those of the version's fixed flow (v2+); the adaptive v1
//   counts every section of the booklet.
export function subjectMarks(version, sampleNo, responses) {
  const content = contentFor(version)
  if (!content) return null
  const out = {}
  for (const subject of SUBJECT_KEYS) {
    const order = content.flow?.[subject]?.order
      || content.subjects[subject].levels.filter(l => l.rank > 0).map(l => l.key)
    const steps = responses?.[subject]?.steps || []
    let marks = 0
    let total = 0
    for (const key of order) {
      const tries = steps
        .filter(st => st.level === key)
        .map(st => {
          const def = stepDef(content, subject, st, sampleNo)
          return def ? { correct: (st.marks || []).filter(m => m === 1).length, total: stepItems(def, st.variant || 0).length } : null
        })
        .filter(Boolean)
        .sort((a, b) => b.correct - a.correct)
      if (tries.length) {
        marks += tries[0].correct
        total += tries[0].total
      } else {
        const def = content.samples[String(sampleNo)]?.[subject]?.[key]
        total += def ? stepItems(def, 0).length : 0
      }
    }
    out[subject] = { marks, total, percent: total ? Math.round((marks / total) * 10000) / 100 : null }
  }
  return out
}

// Samples a sitting actually used (one per section from v3), for display.
export function samplesUsed(sampleNo, responses) {
  const set = new Set()
  for (const subject of SUBJECT_KEYS) for (const st of responses?.[subject]?.steps || []) set.add(Number(st.sample ?? sampleNo))
  if (set.size === 0 && sampleNo != null) set.add(Number(sampleNo))
  return [...set].sort((a, b) => a - b)
}

export { SUBJECT_KEYS }
