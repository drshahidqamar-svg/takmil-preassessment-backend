// ============================================================================
// Evaluation (ASER 2018 tool): flow + scoring. Two flows are supported:
// the original ASER adaptive one (content v1) and the fixed order with
// Letter/Word gates (content v2, the one in use).
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

// ---------------------------------------------------------------------------
// FIXED-ORDER FLOW (content v2, from the Oct 2026 UAT change requests).
// Content files with a `flow` block use this instead of the adaptive one:
// sections always run in order from the easiest; a section listed in
// `gates` that is not passed stops that subject; every other section is
// shown regardless of its result. The teacher moves on with Next, so a
// step here has no "undecided" state -- the marks are simply counted.
// ---------------------------------------------------------------------------
export function nextStepFixed(subject, sampleContent, steps, flow) {
  const order = flow[subject].order
  if (steps.length === 0) return { level: order[0], variant: 0 }
  const last = steps[steps.length - 1]
  const def = sampleContent[subject][last.level]
  const passed = evaluateStep(def, last.marks, last.variant).passed
  if (!passed && flow[subject].gates.includes(last.level)) return null
  // Paragraph has two versions: a child who misses the first gets the second.
  if (!passed && def.variants && last.variant + 1 < def.variants.length) {
    return { level: last.level, variant: last.variant + 1 }
  }
  const i = order.indexOf(last.level)
  return i + 1 < order.length ? { level: order[i + 1], variant: 0 } : null
}

// Why a subject ended early, if it did: the gate section that was not passed.
export function stoppedAt(subject, sampleContent, steps, flow) {
  if (!flow || !steps?.length) return null
  const last = steps[steps.length - 1]
  if (!flow[subject].gates.includes(last.level)) return null
  const def = sampleContent[subject][last.level]
  const r = evaluateStep(def, last.marks, last.variant)
  return r.passed ? null : { level: last.level, correct: r.correct, total: stepItems(def, last.variant).length, need: def.need }
}

// Given the steps taken so far, return the next step to show, or null when
// the subject is finished.
//   steps: [{ level, variant, marks }]
//   flow:  content.flow when the content uses the fixed order (v2+)
export function nextStep(subject, sampleContent, steps, flow) {
  if (flow) return nextStepFixed(subject, sampleContent, steps, flow)
  const adaptive = flowFor(subject)
  if (steps.length === 0) return { level: adaptive.start, variant: 0 }

  const last = steps[steps.length - 1]
  const def = sampleContent[subject][last.level]
  const result = evaluateStep(def, last.marks, last.variant)
  if (!result.decided) return { level: last.level, variant: last.variant }

  if (result.passed) {
    const up = adaptive.up[last.level]
    // Going up from a level we only reached by going down would re-test a
    // level already failed (e.g. para failed -> sentence passed -> para
    // again). Stop instead.
    if (!up || steps.some(s => s.level === up)) return null
    return { level: up, variant: 0 }
  }

  if (def.variants && last.variant + 1 < def.variants.length) {
    return { level: last.level, variant: last.variant + 1 }
  }
  const down = adaptive.down[last.level]
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

// subjectResponses = { steps, finished }. With the fixed flow the teacher
// ends each subject explicitly, so `finished` is what counts.
export function isSubjectComplete(subject, content, sampleNo, subjectResponses) {
  const steps = subjectResponses?.steps || []
  if (content.flow) return !!subjectResponses?.finished
  return steps.length > 0 && nextStep(subject, content.samples[String(sampleNo)], steps) === null
}
