import { Router } from 'express'
import { query } from '../db.js'
import { verifyPassword } from '../utils/password.js'
import { signToken } from '../middleware/auth.js'

const router = Router()

// POST /api/login  { username, password }
//
// This is the ONE endpoint the app calls while it still might be on a
// weak connection at the school gate before heading out into the field --
// everything else the teacher does after this is served from the
// roster this returns, cached locally on the phone.
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }

  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.password_hash, u.school_id, s.name AS school_name
     FROM users u
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.username = $1`,
    [username]
  )
  const user = rows[0]

  // Same error for "no such user" and "wrong password" -- don't leak
  // which one it was.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password' })
  }

  if (user.role !== 'teacher') {
    return res.status(403).json({ error: 'This login is for teachers. Admins should use the admin dashboard.' })
  }

  const { rows: students } = await query(
    `SELECT id, school_id AS "schoolId", first_name AS "firstName", last_name AS "lastName",
            age, date_of_birth AS "dateOfBirth", gender,
            father_name AS "fatherName", mother_tongue AS "motherTongue",
            disability, reason_out_of_school AS "reasonOutOfSchool",
            religion, village_place AS "villagePlace", date_of_joining AS "dateOfJoining"
     FROM students
     WHERE school_id = $1
     ORDER BY last_name`,
    [user.school_id]
  )

  const { rows: questions } = await query(
    `SELECT code, domain, label, display_order AS "displayOrder"
     FROM questions
     ORDER BY display_order`
  )

  const token = signToken({ userId: user.id, role: user.role, schoolId: user.school_id })

  res.json({
    token,
    teacherId: user.id,
    teacherName: user.name,
    schoolId: user.school_id,
    schoolName: user.school_name,
    students,
    questions // lets the app fetch the question bank instead of hardcoding it
  })
})

export default router
