// ============================================================================
// ASER-style evaluation: adaptive flow + scoring.
//
// The SAME file is copied into the teacher app (to drive the flow on the
// device, offline) and the backend (to recompute every level from the raw
// per-item marks on sync, so the server never trusts a level the phone
// claims). If you change it, change both copies.
//
// How ASER works: a child is not given every item. Testing starts in the
// middle (reading: paragraph, math: subtraction). Pass -> go up one level;
// fail -> go down until the child passes something. The child's result is
// the highest level they passed.
// ============================================================================

export const SUBJECT_KEYS = ['english', 'urdu', 'math']

const READING_FLOW = {
  start: 'para',
  up:   { para: 'story', story: null, sentence: null, word: null, letter: null },
  down: { para: 'sentence', story: null, sentence: 'word', word: 'letter', letter: null }
}

const MATH_FLOW = {
  start: 'sub',
  up:   { sub: 'mul', mul: null, num3: null, num2: null },
  down: { sub: 'num3', mul: null, num3: 'num2', num2: null }
}

export function flowFor(subject) {
  return subject === 'math' ? MATH_FLOW : READING_FLOW
}

// Items shown for a step. Paragraph has two variants: if the child fails
// the first, ASER lets them try the second before moving down.
export function stepItems(levelDef, variant = 0) {
  return levelDef.variants ? levelDef.variants[variant] : levelDef.items
}

// marks: array aligned with items -- 1 correct, 0 wrong, null not asked.
// "attempt" (math only) caps how many items may be tried: "do any 6
// subtractions, 5 must be correct".
export function evaluateStep(levelDef, marks, variant = 0) {
  const items = stepItems(levelDef, variant)
  const limit = levelDef.attempt ?? items.length
  const correct = marks.filter(m => m === 1).length
  const marked = marks.filter(m => m === 0 || m === 1).length
  const remaining = Math.max(0, limit - marked)
  const passed = correct >= levelDef.need
  const failed = !passed && correct + remaining < levelDef.need
  return {
    correct, marked, limit, need: levelDef.need,
    passed, failed, decided: passed || failed,
    canMarkMore: marked < limit
  }
}

// Given the steps taken so far, return the next step to show, or null when
// the subject is finished.
//   steps: [{ level, variant, marks }]
export function nextStep(subject, sampleContent, steps) {
  const flow = flowFor(subject)
  if (steps.length === 0) return { level: flow.start, variant: 0 }

  const last = steps[steps.length - 1]
  const def = sampleContent[subject][last.level]
  const result = evaluateStep(def, last.marks, last.variant)
  if (!result.decided) return { level: last.level, variant: last.variant }

  if (result.passed) {
    const up = flow.up[last.level]
    // Going up from a level we only reached by going down would re-test a
    // level already failed (e.g. para failed -> sentence passed -> para
    // again). Stop instead.
    if (!up || steps.some(s => s.level === up)) return null
    return { level: up, variant: 0 }
  }

  if (def.variants && last.variant + 1 < def.variants.length) {
    return { level: last.level, variant: last.variant + 1 }
  }
  const down = flow.down[last.level]
  if (!down || steps.some(s => s.level === down)) return null
  return { level: down, variant: 0 }
}

// The child's level for a subject = highest-ranked level passed.
export function levelFor(subject, content, sampleNo, steps) {
  const sample = content.samples[String(sampleNo)]
  const ranks = Object.fromEntries(content.subjects[subject].levels.map(l => [l.key, l.rank]))
  let best = 0
  for (const s of steps || []) {
    const def = sample?.[subject]?.[s.level]
    if (!def || !Array.isArray(s.marks)) continue
    if (evaluateStep(def, s.marks, s.variant || 0).passed) best = Math.max(best, ranks[s.level] ?? 0)
  }
  return best
}

export function levelLabel(content, subject, rank) {
  return content.subjects[subject].levels.find(l => l.rank === rank)?.label ?? 'Beginner'
}

export function isSubjectComplete(subject, content, sampleNo, steps) {
  return nextStep(subject, content.samples[String(sampleNo)], steps || []) === null
}
