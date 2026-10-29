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

// Section-by-section marks (UAT US-11/12/13), used by the Student Results
// list, the student detail page and the Excel.
// - 1 mark per item marked correct; anything else (wrong, unmarked) is 0.
// - Every section of the subject's flow is listed. A section the child
//   never reached (the subject stopped at a gate) is "not_attempted": 0
//   marks, but its items stay in the total so percentages are comparable.
// - A section tried more than once (the second paragraph) counts once, by
//   its best try, so marks can never exceed the total.
// - From v3 each section has its own sample; an attempted section is
//   counted with the sample it used, an unreached one with the
//   evaluation's sample (only story length differs between samples).
// - A subject with no section at all (not taken) is marked taken: false;
//   it shows "-" and is left out of the overall result.
// - Sections are those of the version's fixed flow (v2+); the adaptive v1
//   lists every section of the booklet.
// Results are computed from the raw marks on every request, so older
// evaluations always follow the same rules as new ones.
export function sectionBreakdown(version, sampleNo, responses) {
  const content = contentFor(version)
  if (!content) return null
  const out = {}
  for (const subject of SUBJECT_KEYS) {
    const order = content.flow?.[subject]?.order
      || content.subjects[subject].levels.filter(l => l.rank > 0).map(l => l.key)
    const steps = responses?.[subject]?.steps || []
    const sections = order.map(key => {
      const label = content.subjects[subject].levels.find(l => l.key === key)?.label || key
      const tries = steps
        .filter(st => st.level === key)
        .map(st => {
          const def = stepDef(content, subject, st, sampleNo)
          if (!def) return null
          const correct = (st.marks || []).filter(m => m === 1).length
          return { obtained: correct, total: stepItems(def, st.variant || 0).length, need: def.need, sample: Number(st.sample ?? sampleNo) }
        })
        .filter(Boolean)
        .sort((a, b) => b.obtained - a.obtained)
      if (tries.length) {
        const t = tries[0]
        return { key, label, ...t, status: t.obtained >= t.need ? 'passed' : 'not_passed' }
      }
      const def = content.samples[String(sampleNo)]?.[subject]?.[key]
      return { key, label, obtained: 0, total: def ? stepItems(def, 0).length : 0, need: def?.need ?? null, sample: null, status: 'not_attempted' }
    })
    out[subject] = { taken: steps.length > 0, sections }
  }
  return out
}

const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null)

// Subject and overall marks. Overall = sum of the subjects taken (marks
// obtained / total marks), the method the programme confirmed on Oct 29.
export function subjectMarks(version, sampleNo, responses) {
  const b = sectionBreakdown(version, sampleNo, responses)
  if (!b) return null
  const out = {}
  let om = 0
  let ot = 0
  for (const subject of SUBJECT_KEYS) {
    if (!b[subject].taken) { out[subject] = { taken: false, marks: null, total: null, percent: null }; continue }
    const marks = b[subject].sections.reduce((a, x) => a + x.obtained, 0)
    const total = b[subject].sections.reduce((a, x) => a + x.total, 0)
    out[subject] = { taken: true, marks, total, percent: pct(marks, total) }
    om += marks
    ot += total
  }
  out.overall = ot ? { taken: true, marks: om, total: ot, percent: pct(om, ot) } : { taken: false, marks: null, total: null, percent: null }
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
