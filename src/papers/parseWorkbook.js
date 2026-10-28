// ============================================================================
// Reads an assessment Excel file in TAKMIL's item template (sheets "MCQs",
// "Match the column", "Fill in the blanks"; columns Q#, Curriculum,
// Chapter No., Lesson No., Assessment Name, SLO code, SLO description,
// Score, Scoring Type, Question type, Compose Question, then the options)
// into the item list the tablet renders.
//
// It never throws on content problems: every problem is reported as an
// issue on its item (or on the paper) so the admin sees the whole list at
// once on the Papers page. Items with blocking issues are left out of a
// published paper until fixed.
// ============================================================================

// Header normaliser: "Response-1 (Col B)" -> "response1colb", "Q #" -> "q".
const norm = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

function cell(row, ...keys) {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

// "Response -1", "Response 2", "response-1, response-3" -> [1] / [2] / [1, 3]
function parseCorrect(v) {
  if (!v) return []
  return [...String(v).matchAll(/(\d+)/g)].map(m => Number(m[1]))
}

function sheetKind(name) {
  const n = name.toLowerCase()
  if (n.includes('mcq')) return 'mcq'
  if (n.includes('match')) return 'match'
  if (n.includes('fill') || n.includes('blank')) return 'fill'
  return null
}

const PICTURE_WORDS = /تصویر|picture|diagram|label the|لیبل/i

// Turns raw rows ({ normalisedHeader: value }) of one sheet into items.
function itemsFromSheet(kind, sheetName, rows) {
  const items = []
  for (const row of rows) {
    const q = cell(row, 'q', 'qno', 'question', 'qnumber')
    const prompt = cell(row, 'composequestion')
    if (!q && !prompt) continue // empty row

    const base = {
      id: `${kind}-${(q || `row${items.length + 1}`).replace(/\s+/g, '')}`,
      type: kind,
      ref: `${sheetName} ${q || ''}`.trim(),
      chapter: cell(row, 'chapterno', 'chapter') ? Number(cell(row, 'chapterno', 'chapter')) : null,
      lesson: cell(row, 'lessonno', 'lesson'),
      slo: cell(row, 'slocode'),
      sloText: cell(row, 'slodescriptionstatement', 'slodescription', 'slo'),
      marks: Number(cell(row, 'score')) || 1,
      prompt: prompt || '',
      image: null,
      issues: []
    }
    const issue = (code, text, blocking = true) => base.issues.push({ code, text, blocking })
    if (!prompt) issue('no_prompt', 'Question text is empty')
    if (!base.slo) issue('no_slo', 'No SLO code', false)

    if (kind === 'mcq' || kind === 'fill') {
      const optKeys = Object.keys(row)
        .map(k => {
          const m = kind === 'mcq' ? k.match(/^response(\d+)$/) : k.match(/^blank(\d+)$/)
          return m ? { k, n: Number(m[1]) } : null
        })
        .filter(Boolean)
        .sort((a, b) => a.n - b.n)
      const options = optKeys
        .map(({ k, n }) => ({ id: `o${n}`, n, text: cell(row, k) }))
        .filter(o => o.text)
      const correctKey = Object.keys(row).find(k => k.startsWith('correct'))
      const correct = parseCorrect(correctKey ? row[correctKey] : null)
      const answers = correct.map(n => `o${n}`).filter(id => options.some(o => o.id === id))
      base.options = options.map(({ id, text }) => ({ id, text }))
      base.answers = answers
      if (options.length < 2) issue('few_options', `Only ${options.length} option(s)`)
      if (correct.length === 0) issue('no_answer', 'No correct answer given')
      else if (answers.length !== correct.length) issue('bad_answer', `Correct answer points to an empty option (${correct.join(', ')})`)
      const texts = options.map(o => o.text)
      if (new Set(texts).size !== texts.length) issue('dup_options', 'Two options have the same text', false)
      if (kind === 'fill' && !/\{\{\s*blank\d*\s*\}\}/i.test(prompt || '')) issue('no_blank', 'No {{blank1}} in the sentence')
    }

    if (kind === 'match') {
      const pairs = []
      for (let n = 1; n <= 20; n++) {
        const leftKey = Object.keys(row).find(k => k.startsWith(`stem${n}`))
        const rightKey = Object.keys(row).find(k => new RegExp(`^response${n}(col|$)`).test(k))
        const left = leftKey ? cell(row, leftKey) : null
        const right = rightKey ? cell(row, rightKey) : null
        if (!left && !right) continue
        pairs.push({ id: `p${n}`, left, right, leftImage: null })
      }
      base.pairs = pairs
      if (pairs.length < 2) issue('few_pairs', `Only ${pairs.length} pair(s) to match`)
      if (pairs.some(p => !p.right)) issue('missing_right', 'A Column B answer is empty')
      const missingLeft = pairs.filter(p => !p.left).length
      if (missingLeft > 0) {
        base.needsPairImages = true
        issue('needs_pictures', `Column A is empty for ${missingLeft} pair(s) — add a picture for each (e.g. the animal or machine to match)`)
      }
      if (pairs.length && base.marks !== pairs.length) {
        issue('marks_vs_pairs', `Score is ${base.marks} but there are ${pairs.length} pairs; marks will be shared equally`, false)
      }
    }

    // A match question whose Column A is pictures already has its pictures;
    // "تصویر" in its wording refers to those, not to one more picture.
    if (PICTURE_WORDS.test(prompt || '') && !base.needsPairImages) {
      base.needsImage = true
      issue('needs_picture', 'The question refers to a picture — add it')
    }

    items.push(base)
  }
  return items
}

// Paper details from the Curriculum / Assessment Name columns:
// "Primary-12- Science" + "Grand-Assessment" -> science, level 12, grand.
function metaFromRows(allRows) {
  const first = allRows.find(r => cell(r, 'curriculum')) || {}
  const curriculum = cell(first, 'curriculum') || ''
  const name = cell(first, 'assessmentname') || ''
  const level = Number((curriculum.match(/(\d+)/) || [])[1]) || null
  const subjectWord = (curriculum.match(/(science|urdu|math|maths|mathematics|english)/i) || [])[1] || ''
  const subject = { maths: 'math', mathematics: 'math' }[subjectWord.toLowerCase()] || subjectWord.toLowerCase() || null
  const kind = /grand/i.test(name) ? 'grand' : 'level'
  return { subject, level, kind, curriculum, assessmentName: name }
}

// sheets: { [sheetName]: rows[] } where rows are objects keyed by the
// sheet's own header text (as XLSX.utils.sheet_to_json gives them).
export function parseWorkbookSheets(sheets) {
  const items = []
  const paperIssues = []
  const allRows = []
  const counts = {}
  for (const [name, rawRows] of Object.entries(sheets)) {
    const kind = sheetKind(name)
    if (!kind) continue
    const rows = rawRows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v])))
    allRows.push(...rows)
    const sheetItems = itemsFromSheet(kind, name, rows)
    counts[kind] = sheetItems.length
    items.push(...sheetItems)
  }
  if (items.length === 0) paperIssues.push('No question sheets found (expected sheets named MCQs, Match the column, Fill in the blanks)')
  const ids = items.map(i => i.id)
  if (new Set(ids).size !== ids.length) paperIssues.push('Two questions on the same sheet have the same Q number')
  const meta = metaFromRows(allRows)
  if (!meta.subject) paperIssues.push('Could not read the subject from the Curriculum column')
  if (!meta.level) paperIssues.push('Could not read the level from the Curriculum column')
  items.forEach((it, i) => { it.number = i + 1 })
  return { meta, items, counts, paperIssues }
}

export function blockingIssues(item) {
  return (item.issues || []).filter(i => {
    if (!i.blocking) return false
    // A picture problem is solved once the picture(s) are attached.
    if (i.code === 'needs_picture') return !item.image && !(item.pairs?.length && item.pairs.every(p => p.leftImage))
    if (i.code === 'needs_pictures') return (item.pairs || []).some(p => !p.left && !p.leftImage)
    return true
  })
}
