// Scoring convention: yes = 1, partially = 0.5, no = 0. A domain (subject)
// score is the average across that domain's questions, shown as a
// percentage. The overall score is the average across all 26 questions.
// This lives in its own file since both the JSON results endpoint and the
// Excel export need identical scoring -- one source of truth avoids the
// two ever quietly drifting apart.

export const ANSWER_VALUE = { yes: 1, partial: 0.5, no: 0 }

export function scoreFromAnswers(answers) {
  const values = Object.values(answers).map(a => ANSWER_VALUE[a] ?? 0)
  if (values.length === 0) return 0
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 10 // one decimal place
}

// Groups a flat list of { domain, questionCode, answer } into per-domain
// answer maps, then scores each domain plus the overall total.
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
