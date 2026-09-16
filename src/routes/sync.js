import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/sync', requireAuth, async (req, res) => {
  const { assessments } = req.body || {}
  if (!Array.isArray(assessments) || assessments.length === 0) {
    return res.status(400).json({ error: 'assessments must be a non-empty array' })
  }

  const client = await pool.connect()
  const accepted = []
  const rejected = []

  try {
    await client.query('BEGIN')

    for (const a of assessments) {
      if (!a.uuid || !a.studentId || !a.teacherId || !a.schoolId) continue

      // THE LOCK: once a student has any assessment on record, no other
      // submission for that student is ever accepted -- checked here,
      // not just in the app UI, because two different teachers on two
      // different offline devices could both complete an assessment for
      // the same student before either one syncs. Whichever reaches the
      // server first wins; the second is rejected here, server-side,
      // where it can't be raced around.
      //
      // Excluding this exact uuid keeps retries safe: resending the same
      // already-accepted assessment (e.g. after a dropped connection)
      // must not be treated as a duplicate of itself.
      const existingForStudent = await client.query(
        'SELECT uuid FROM assessments WHERE student_id = $1 AND uuid != $2 LIMIT 1',
        [a.studentId, a.uuid]
      )
      if (existingForStudent.rows.length > 0) {
        rejected.push({ uuid: a.uuid, reason: 'This student already has an assessment on record' })
        continue
      }

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
      // in this submission never erases a value saved by an earlier one.
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
    res.json({ accepted, rejected })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Sync failed:', err.message)
    res.status(500).json({ error: 'Sync failed, the phone will retry automatically', accepted: [], rejected: [] })
  } finally {
    client.release()
  }
})

export default router
