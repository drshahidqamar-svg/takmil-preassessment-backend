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

      // "Section I: Basic Information" from the paper form -- collected by
      // the teacher at the same sitting as the assessment. Scoped to
      // (studentId AND schoolId) so a teacher can only ever update a
      // student at their own school. COALESCE means a blank/omitted field
      // in this submission never erases a value saved by an earlier one --
      // important since the same student can't be re-uploaded through
      // this path, only enriched.
      const info = a.studentBasicInfo
      if (info && Object.keys(info).length > 0) {
        await client.query(
          `UPDATE students SET
             father_name = COALESCE($1, father_name),
             date_of_birth = COALESCE($2, date_of_birth),
             mother_tongue = COALESCE($3, mother_tongue),
             disability = COALESCE($4, disability),
             reason_out_of_school = COALESCE($5, reason_out_of_school),
             religion = COALESCE($6, religion),
             village_place = COALESCE($7, village_place),
             date_of_joining = COALESCE($8, date_of_joining)
           WHERE id = $9 AND school_id = $10`,
          [
            info.fatherName || null, info.dateOfBirth || null, info.motherTongue || null,
            info.disability || null, info.reasonOutOfSchool || null, info.religion || null,
            info.villagePlace || null, info.dateOfJoining || null,
            a.studentId, a.schoolId
          ]
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
