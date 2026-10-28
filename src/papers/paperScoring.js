// ============================================================================
// Curriculum assessment scoring. SHARED: the same file is copied into the
// teacher app (src/papers/) to score on the tablet, and the backend
// re-scores every synced attempt with it, so the server never trusts a
// score the tablet sends. If you change it, change both copies.
//
// Item types and answer shapes:
//   mcq   -> answer = option id ('o1'..)        one correct option (or several accepted)
//   fill  -> answer = option id                  the blank is filled by choosing an option
//   match -> answer = { [pairId]: pairId }       left item -> the right item the child chose
// ============================================================================

export function itemMax(item) {
  return Number(item.marks) || 0
}

// Points earned on one item.
export function scoreItem(item, answer) {
  const max = itemMax(item)
  if (answer == null) return 0
  if (item.type === 'mcq' || item.type === 'fill') {
    return item.answers.includes(answer) ? max : 0
  }
  if (item.type === 'match') {
    const pairs = item.pairs || []
    if (pairs.length === 0) return 0
    const correct = pairs.filter(p => answer[p.id] === p.id).length
    // "Partial match": marks are shared equally across the pairs.
    return Math.round((max * correct / pairs.length) * 100) / 100
  }
  return 0
}

export function isAnswered(item, answer) {
  if (answer == null) return false
  if (item.type === 'match') return (item.pairs || []).every(p => answer[p.id])
  return true
}

// Whole attempt: total, and breakdowns by SLO and by chapter for reporting.
export function scoreAttempt(items, answers = {}) {
  let score = 0
  let max = 0
  const bySlo = {}
  const byChapter = {}
  const byItem = {}
  for (const item of items) {
    const m = itemMax(item)
    const s = scoreItem(item, answers[item.id])
    score += s
    max += m
    byItem[item.id] = s
    const slo = item.slo || 'none'
    bySlo[slo] = bySlo[slo] || { earned: 0, max: 0, text: item.sloText || '' }
    bySlo[slo].earned += s
    bySlo[slo].max += m
    const ch = item.chapter ?? 'none'
    byChapter[ch] = byChapter[ch] || { earned: 0, max: 0 }
    byChapter[ch].earned += s
    byChapter[ch].max += m
  }
  return { score: Math.round(score * 100) / 100, max, bySlo, byChapter, byItem }
}
