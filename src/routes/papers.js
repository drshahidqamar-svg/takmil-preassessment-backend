import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { query, pool } from '../db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { parseWorkbookSheets, blockingIssues } from '../papers/parseWorkbook.js'
import { scoreAttempt } from '../papers/paperScoring.js'

// ============================================================================
// Curriculum assessments (Primary Levels 1-12 + Grand): papers imported
// from Excel by admins, downloaded by tablets, taken by the child offline,
// synced back and re-scored here.
// ============================================================================

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
const admin = [requireAuth, requireRole('admin')]
const MAX_IMAGE_CHARS = 600 * 1024 // a data URL; the dashboard shrinks pictures before sending

const SUBJECT_LABELS = { science: 'Science', urdu: 'Urdu', math: 'Math', english: 'English' }

function paperTitle(meta) {
  const s = SUBJECT_LABELS[meta.subject] || meta.subject
  return meta.kind === 'grand' ? `${s} — Level ${meta.level} Grand Assessment` : `${s} — Level ${meta.level}`
}

function summarize(items) {
  const blocked = items.filter(i => blockingIssues(i).length > 0)
  return {
    questions: items.length,
    marks: items.reduce((a, i) => a + (Number(i.marks) || 0), 0),
    blocked: blocked.length,
    readyMarks: items.filter(i => !blockingIssues(i).length).reduce((a, i) => a + (Number(i.marks) || 0), 0),
    warnings: items.filter(i => (i.issues || []).some(x => !x.blocking)).length
  }
}

// What a tablet needs: no review notes.
function forTablet(items) {
  return items.map(({ issues, needsImage, needsPairImages, ref, ...rest }) => rest)
}

/* ------------------------------ Admin: papers ------------------------------ */

router.post('/admin/papers/upload', ...admin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected field name "file")' })
  let sheets
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    sheets = Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: false })]))
  } catch {
    return res.status(400).json({ error: 'Could not read the file. Upload the .xlsx in the assessment template.' })
  }
  const { meta, items, counts, paperIssues } = parseWorkbookSheets(sheets)
  // The admin can correct what the file says (e.g. a mistyped Curriculum).
  const subject = (req.body.subject || meta.subject || '').toLowerCase()
  const level = Number(req.body.level || meta.level)
  const kind = req.body.kind || meta.kind
  if (!subject || !(level >= 1 && level <= 12) || !['level', 'grand'].includes(kind)) {
    return res.status(400).json({ error: 'Subject, level (1-12) and type could not be read from the file — choose them on the form.', paperIssues, counts })
  }
  if (items.length === 0) return res.status(400).json({ error: paperIssues.join('; ') || 'No questions found', counts })

  const paperKey = `${subject}-${level}-${kind}`
  const { rows: [{ v }] } = await query('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM assessment_papers WHERE paper_key = $1', [paperKey])
  const m = { subject, level, kind }
  const { rows: [paper] } = await query(
    `INSERT INTO assessment_papers (paper_key, version, subject, level, kind, title, items, total_marks, source_file, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, paper_key AS "paperKey", version, status`,
    [paperKey, v, subject, level, kind, paperTitle(m), JSON.stringify(items), summarize(items).marks, req.file.originalname, req.user.userId]
  )
  res.status(201).json({ ...paper, title: paperTitle(m), counts, paperIssues, summary: summarize(items) })
})

router.get('/admin/papers', ...admin, async (req, res) => {
  const { rows } = await query(`
    SELECT p.id, p.paper_key AS "paperKey", p.version, p.subject, p.level, p.kind, p.title, p.status,
           p.total_marks AS "totalMarks", p.source_file AS "sourceFile", p.created_at AS "createdAt",
           p.published_at AS "publishedAt", p.items,
           (SELECT COUNT(*) FROM assessment_attempts a WHERE a.paper_id = p.id) AS attempts
    FROM assessment_papers p
    ORDER BY p.subject, p.level, p.kind, p.version DESC`)
  res.json(rows.map(({ items, ...r }) => ({ ...r, summary: summarize(items) })))
})

router.get('/admin/papers/:id', ...admin, async (req, res) => {
  const { rows: [p] } = await query('SELECT * FROM assessment_papers WHERE id = $1', [req.params.id])
  if (!p) return res.status(404).json({ error: 'Paper not found' })
  res.json({
    id: p.id, paperKey: p.paper_key, version: p.version, subject: p.subject, level: p.level, kind: p.kind,
    title: p.title, status: p.status, totalMarks: p.total_marks, sourceFile: p.source_file,
    items: p.items.map(i => ({ ...i, blocking: blockingIssues(i) })),
    summary: summarize(p.items)
  })
})

// Attach a picture to a question (pairId omitted) or to one Column A item.
router.put('/admin/papers/:id/items/:itemId/image', ...admin, async (req, res) => {
  const { image, pairId } = req.body || {}
  if (image !== null && (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image))) {
    return res.status(400).json({ error: 'Send the picture as a PNG/JPEG data URL' })
  }
  if (image && image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'Picture too large — use a smaller one' })
  const { rows: [p] } = await query('SELECT status, items FROM assessment_papers WHERE id = $1', [req.params.id])
  if (!p) return res.status(404).json({ error: 'Paper not found' })
  if (p.status !== 'draft') return res.status(409).json({ error: 'Only a draft can be changed. Upload the file again to make a new version.' })
  const item = p.items.find(i => i.id === req.params.itemId)
  if (!item) return res.status(404).json({ error: 'Question not found' })
  if (pairId) {
    const pair = (item.pairs || []).find(x => x.id === pairId)
    if (!pair) return res.status(404).json({ error: 'Pair not found' })
    pair.leftImage = image
  } else {
    item.image = image
  }
  await query('UPDATE assessment_papers SET items = $1 WHERE id = $2', [JSON.stringify(p.items), req.params.id])
  res.json({ item: { ...item, blocking: blockingIssues(item) }, summary: summarize(p.items) })
})

// Publish: questions that still have blocking problems are left out (the
// admin is told how many and which); the previous published version of
// the same paper is retired so tablets switch to this one.
router.post('/admin/papers/:id/publish', ...admin, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [p] } = await client.query('SELECT * FROM assessment_papers WHERE id = $1 FOR UPDATE', [req.params.id])
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Paper not found' }) }
    if (p.status !== 'draft') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already published' }) }
    const ready = p.items.filter(i => blockingIssues(i).length === 0)
    const left = p.items.filter(i => blockingIssues(i).length > 0)
    if (ready.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No question is ready to publish' }) }
    const total = ready.reduce((a, i) => a + (Number(i.marks) || 0), 0)
    ready.forEach((it, n) => { it.number = n + 1 })
    await client.query(`UPDATE assessment_papers SET status = 'retired' WHERE paper_key = $1 AND status = 'published'`, [p.paper_key])
    await client.query(
      `UPDATE assessment_papers SET status = 'published', published_at = now(), items = $1, total_marks = $2 WHERE id = $3`,
      [JSON.stringify(ready), total, p.id]
    )
    await client.query('COMMIT')
    res.json({ published: true, questions: ready.length, totalMarks: total, leftOut: left.map(i => i.ref) })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Publish failed:', err.message)
    res.status(500).json({ error: 'Could not publish' })
  } finally {
    client.release()
  }
})

router.delete('/admin/papers/:id', ...admin, async (req, res) => {
  const { rowCount } = await query(`DELETE FROM assessment_papers WHERE id = $1 AND status = 'draft'`, [req.params.id])
  if (rowCount === 0) return res.status(409).json({ error: 'Only drafts can be deleted' })
  res.json({ deleted: true })
})

/* ------------------------------ Teacher: download + sync ------------------------------ */

// Published papers for the tablet to keep offline. `have` lets a tablet
// skip papers it already holds: ?have=id1,id2
router.get('/papers', requireAuth, async (req, res) => {
  const have = new Set(String(req.query.have || '').split(',').filter(Boolean))
  const { rows } = await query(
    `SELECT id, paper_key AS "paperKey", version, subject, level, kind, title, language, total_marks AS "totalMarks", items
     FROM assessment_papers WHERE status = 'published' ORDER BY subject, level, kind`
  )
  res.json({
    papers: rows.filter(p => !have.has(p.id)).map(p => ({ ...p, items: forTablet(p.items) })),
    publishedIds: rows.map(p => p.id)
  })
})

router.post('/attempts/sync', requireAuth, async (req, res) => {
  const { attempts } = req.body || {}
  if (!Array.isArray(attempts) || attempts.length === 0) return res.status(400).json({ error: 'attempts must be a non-empty array' })
  const client = await pool.connect()
  const accepted = []
  const rejected = []
  const paperCache = new Map()
  try {
    await client.query('BEGIN')
    for (const a of attempts) {
      if (!a.uuid || !a.paperId || !a.studentId || !a.teacherId || !a.schoolId) {
        rejected.push({ uuid: a.uuid || null, reason: 'Missing fields' })
        continue
      }
      if (!paperCache.has(a.paperId)) {
        const { rows: [p] } = await client.query('SELECT items FROM assessment_papers WHERE id = $1', [a.paperId])
        paperCache.set(a.paperId, p || null)
      }
      const paper = paperCache.get(a.paperId)
      if (!paper) { rejected.push({ uuid: a.uuid, reason: 'Unknown paper' }); continue }
      const { rows: [st] } = await client.query('SELECT 1 FROM students WHERE id = $1 AND school_id = $2', [a.studentId, a.schoolId])
      if (!st) { rejected.push({ uuid: a.uuid, reason: 'Student not found at this school' }); continue }

      const scored = scoreAttempt(paper.items, a.answers || {})
      await client.query('SAVEPOINT one_record')
      try {
        await client.query(
          `INSERT INTO assessment_attempts
             (uuid, paper_id, student_id, teacher_id, school_id, answers, score, max_score,
              device_id, started_at, completed_at, active_seconds)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (uuid) DO NOTHING`,
          [a.uuid, a.paperId, a.studentId, a.teacherId, a.schoolId, JSON.stringify(a.answers || {}),
           scored.score, scored.max, a.deviceId || null, a.startedAt || null, a.completedAt || null,
           Number.isFinite(a.activeSeconds) ? Math.round(a.activeSeconds) : null]
        )
        await client.query('RELEASE SAVEPOINT one_record')
        accepted.push(a.uuid)
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT one_record')
        console.error(`Attempt sync rejected ${a.uuid}:`, err.message)
        rejected.push({ uuid: a.uuid, reason: 'This record could not be saved' })
      }
    }
    await client.query('COMMIT')
    res.json({ accepted, rejected })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Attempt sync failed:', err.message)
    res.status(500).json({ error: 'Sync failed, the tablet will retry automatically', accepted: [], rejected: [] })
  } finally {
    client.release()
  }
})

/* ------------------------------ Admin: results ------------------------------ */

async function loadAttempts(paperId) {
  const { rows } = await query(`
    SELECT a.uuid, a.answers, a.score, a.max_score, a.started_at, a.completed_at, a.active_seconds,
           st.first_name, st.last_name, st.gender, st.age,
           s.name AS school_name, s.province, u.name AS teacher_name
    FROM assessment_attempts a
    JOIN students st ON st.id = a.student_id
    JOIN schools s ON s.id = a.school_id
    JOIN users u ON u.id = a.teacher_id
    WHERE a.paper_id = $1
    ORDER BY s.name, st.last_name, st.first_name`, [paperId])
  return rows
}

const pct = (e, m) => (m > 0 ? Math.round((e / m) * 1000) / 10 : null)

// Everything the results page shows for one paper: each child's score,
// mastery per SLO, and how each question did (share fully correct, and the
// most common wrong option -- the classic sign of a misconception).
async function analyse(paperId) {
  const { rows: [p] } = await query('SELECT * FROM assessment_papers WHERE id = $1', [paperId])
  if (!p) return null
  const attempts = await loadAttempts(paperId)
  const slo = {}
  const items = p.items.map(it => ({ id: it.id, number: it.number, type: it.type, prompt: it.prompt, slo: it.slo, marks: it.marks, full: 0, earned: 0, wrongChoices: {} }))
  const itemById = Object.fromEntries(items.map(i => [i.id, i]))
  const students = attempts.map(a => {
    const r = scoreAttempt(p.items, a.answers)
    for (const [code, v] of Object.entries(r.bySlo)) {
      slo[code] = slo[code] || { code, text: v.text, earned: 0, max: 0 }
      slo[code].earned += v.earned
      slo[code].max += v.max
    }
    for (const it of p.items) {
      const s = r.byItem[it.id]
      const row = itemById[it.id]
      row.earned += s
      if (s >= Number(it.marks)) row.full += 1
      const ans = a.answers?.[it.id]
      if ((it.type === 'mcq' || it.type === 'fill') && ans && !it.answers.includes(ans)) {
        const txt = it.options.find(o => o.id === ans)?.text || ans
        row.wrongChoices[txt] = (row.wrongChoices[txt] || 0) + 1
      }
    }
    return {
      uuid: a.uuid, name: `${a.first_name} ${a.last_name}`, gender: a.gender, age: a.age,
      school: a.school_name, province: a.province, teacher: a.teacher_name,
      score: r.score, max: r.max, percent: pct(r.score, r.max),
      completedAt: a.completed_at, minutes: a.active_seconds != null ? Math.round(a.active_seconds / 6) / 10 : null,
      slo: Object.fromEntries(Object.entries(r.bySlo).map(([k, v]) => [k, pct(v.earned, v.max)]))
    }
  })
  const n = attempts.length
  return {
    paper: { id: p.id, title: p.title, version: p.version, totalMarks: Number(p.total_marks), questions: p.items.length },
    attempts: n,
    average: n ? pct(students.reduce((a, s) => a + s.score, 0), students.reduce((a, s) => a + s.max, 0)) : null,
    students,
    slos: Object.values(slo).map(s => ({ ...s, percent: pct(s.earned, s.max) })).sort((a, b) => a.percent - b.percent),
    items: items.map(i => {
      const top = Object.entries(i.wrongChoices).sort((a, b) => b[1] - a[1])[0]
      return {
        id: i.id, number: i.number, type: i.type, prompt: i.prompt, slo: i.slo, marks: i.marks,
        fullyCorrect: n ? pct(i.full, n) : null,
        commonWrong: top ? { text: top[0], count: top[1] } : null
      }
    })
  }
}

router.get('/admin/papers/:id/results', ...admin, async (req, res) => {
  const result = await analyse(req.params.id)
  if (!result) return res.status(404).json({ error: 'Paper not found' })
  res.json(result)
})

router.get('/admin/papers/:id/results-export', ...admin, async (req, res) => {
  const r = await analyse(req.params.id)
  if (!r) return res.status(404).json({ error: 'Paper not found' })
  const sloCodes = r.slos.map(s => s.code)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.students.map(s => {
    const row = {
      School: s.school, Province: s.province || '', Teacher: s.teacher, Student: s.name,
      Gender: s.gender || '', Age: s.age ?? '', Score: s.score, 'Out of': s.max, 'Percent': s.percent,
      'Minutes': s.minutes ?? ''
    }
    for (const c of sloCodes) row[`SLO ${c} (%)`] = s.slo[c] ?? ''
    return row
  })), 'Students')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.slos.map(s => ({
    'SLO': s.code, 'Description': s.text, 'Marks earned': Math.round(s.earned * 100) / 100, 'Marks possible': s.max, 'Mastery (%)': s.percent
  }))), 'By SLO')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.items.map(i => ({
    'Q': i.number, 'Type': i.type, 'SLO': i.slo || '', 'Question': i.prompt, 'Marks': i.marks,
    'Fully correct (%)': i.fullyCorrect ?? '', 'Most common wrong answer': i.commonWrong ? `${i.commonWrong.text} (${i.commonWrong.count})` : ''
  }))), 'By Question')
  const bySchool = {}
  for (const s of r.students) {
    bySchool[s.school] = bySchool[s.school] || { School: s.school, Province: s.province || '', Students: 0, e: 0, m: 0 }
    bySchool[s.school].Students += 1
    bySchool[s.school].e += s.score
    bySchool[s.school].m += s.max
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(bySchool).map(({ e, m, ...b }) => ({ ...b, 'Average (%)': pct(e, m) }))), 'By School')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${r.paper.title.replace(/[^\w\- ]+/g, '').trim() || 'assessment'}-results.xlsx"`)
  res.send(buf)
})

export default router
