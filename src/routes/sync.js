import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// POST /api/sync  { assessments: [ { uuid, studentId, teacherId, schoolId,
//                                     startedAt, completedAt, latitude, longitude,
//                                     locationAccuracy, responses: { code: answer } }, ... ] }
//
// Accepts everything a phone queued while offline, in one request. Every
// assessment carries a uuid that was generated ON THE PHONE, not here --
// so `ON CONFLICT (uuid) DO NOTHING` means resending the same batch after
// a dropped connection can never create duplicate rows. The response
// tells the client exactly which uuids landed, so it can safely clear
// only those from its local queue.
//
// latitude/longitude are optional -- a phone with location permission
// denied still submits normally, just without coordinates. That absence
// itself becomes a data point (see the "no_location" integrity flag).
router.post('/sync', requireAuth, async (req, res) => {
  const { assessments } = req.body || {}
  if (!Array.isArray(assessments) || assessments.length === 0) {
    return res.status(400).json({ error: 'assessments must be a non-empty array' })
  }

  const client = await pool.connect()
  const accepted = []

  try {
    await client.query('BEGIN')

    for (const a of assessments) {
      if (!a.uuid || !a.studentId || !a.teacherId || !a.schoolId) continue

      const result = await client.query(
        `INSERT INTO assessments
           (uuid, student_id, teacher_id, school_id, device_id, started_at, completed_at,
            latitude, longitude, location_accuracy_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (uuid) DO NOTHING
         RETURNING uuid`,
        [
          a.uuid, a.studentId, a.teacherId, a.schoolId, a.deviceId || null,
          a.startedAt || null, a.completedAt || null,
          a.latitude ?? null, a.longitude ?? null, a.locationAccuracy ?? null
        ]
      )

      // Whether this insert was fresh or a no-op retry, make sure every
      // response for it is present -- upsert on the (assessment, question)
      // pair so a partial retry can't create duplicate answers either.
      const responses = a.responses || {}
      for (const [questionCode, answer] of Object.entries(responses)) {
        await client.query(
          `INSERT INTO responses (assessment_uuid, question_code, answer, answered_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (assessment_uuid, question_code) DO UPDATE SET answer = EXCLUDED.answer`,
          [a.uuid, questionCode, answer]
        )
      }

      accepted.push(a.uuid)
    }

    await client.query('COMMIT')
    res.json({ accepted })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Sync failed:', err.message)
    res.status(500).json({ error: 'Sync failed, the phone will retry automatically', accepted: [] })
  } finally {
    client.release()
  }
})

export default router
