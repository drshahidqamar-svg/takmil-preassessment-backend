export const ANSWER_VALUE = { yes: 1, partial: 0.5, no: 0 }

export function scoreFromAnswers(answers) {
  const values = Object.values(answers).map(a => ANSWER_VALUE[a] ?? 0)
  if (values.length === 0) return 0
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 10
}

export function buildScores(responseRows) {
  const byDomain = {}
  const allAnswers = {}

  for (const r of responseRows) {
    if (!r.questionCode || !r.answer) continue
    byDomain[r.domain] = byDomain[r.domain] || {}
    byDomain[r.domain][r.questionCode] = r.answer
    allAnswers[r.questionCode] = r.answer
  }

  const domainScores = {}
  for (const [domain, answers] of Object.entries(byDomain)) {
    domainScores[domain] = scoreFromAnswers(answers)
  }

  return {
    domainScores,
    overallScore: scoreFromAnswers(allAnswers),
    answers: allAnswers
  }
}
