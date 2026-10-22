import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { scoreEvaluation } from '../aser/index.js'

const router = Router()

// POST /api/evaluations/sync -- same contract as /api/sync for the
// pre-assessment: { evaluations: [...] } -> { accepted: [uuid], rejected: [{uuid, reason}] }.
// The phone deletes nothing until its uuid comes back in `accepted`, and a
// resend of an already-stored uuid is accepted again (idempotent), so a
// dropped connection mid-sync can never lose or duplicate a sitting.
router.post('/evaluations/sync', requireAuth, async (req, res) => {
  const { evaluations } = req.body || {}
  if (!Array.isArray(evaluations) || evaluations.length === 0) {
    return res.status(400).json({ error: 'evaluations must be a non-empty array' })
  }

  const client = await pool.connect()
  const accepted = []
  const rejected = []

  try {
    await client.query('BEGIN')

    for (const e of evaluations) {
      if (!e.uuid || !e.studentId || !e.teacherId || !e.schoolId) {
        rejected.push({ uuid: e.uuid || null, reason: 'Missing uuid, studentId, teacherId or schoolId' })
        continue
      }

      const sampleNo = Number(e.sampleNo)
      const scores = scoreEvaluation(e.toolVersion, sampleNo, e.responses)
      if (!scores || !(sampleNo >= 1 && sampleNo <= 4)) {
        rejected.push({ uuid: e.uuid, reason: `Unknown tool version "${e.toolVersion}" or sample ${e.sampleNo}` })
        continue
      }

      // The student must belong to the school the submission claims.
      const { rows: [student] } = await client.query(
        'SELECT 1 FROM students WHERE id = $1 AND school_id = $2', [e.studentId, e.schoolId]
      )
      if (!student) {
        rejected.push({ uuid: e.uuid, reason: 'Student not found at this school' })
        continue
      }

      await client.query('SAVEPOINT one_record')
      try {
      await client.query(
        `INSERT INTO evaluations
           (uuid, student_id, teacher_id, school_id, tool_version, sample_no,
            english_level, urdu_level, math_level, responses,
            device_id, started_at, completed_at, latitude, longitude, location_accuracy_m)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (uuid) DO NOTHING`,
        [
          e.uuid, e.studentId, e.teacherId, e.schoolId, e.toolVersion, sampleNo,
          scores.english.level, scores.urdu.level, scores.math.level, JSON.stringify(e.responses || {}),
          e.deviceId || null, e.startedAt || null, e.completedAt || null,
          e.latitude ?? null, e.longitude ?? null, e.locationAccuracy ?? null
        ]
      )
      await client.query('RELEASE SAVEPOINT one_record')
      accepted.push(e.uuid)
      } catch (err) {
        // Only this record is undone; the rest of the batch still saves.
        await client.query('ROLLBACK TO SAVEPOINT one_record')
        console.error(`Evaluation sync rejected ${e.uuid}:`, err.message)
        rejected.push({ uuid: e.uuid, reason: 'This record could not be saved' })
      }
    }

    await client.query('COMMIT')
    res.json({ accepted, rejected })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Evaluation sync failed:', err.message)
    res.status(500).json({ error: 'Sync failed, the phone will retry automatically', accepted: [], rejected: [] })
  } finally {
    client.release()
  }
})

export default router
