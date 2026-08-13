import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET
if (!SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to your .env (see .env.example).')
}

export function signToken(payload) {
  // 90 days: a teacher in a school with patchy signal shouldn't be
  // forced to re-authenticate (which needs connectivity) every few days.
  return jwt.sign(payload, SECRET, { expiresIn: '90d' })
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  // A plain <a href> / window.location download can't set a custom
  // Authorization header, so the Excel export link falls back to a
  // ?token= query param. Everything else still uses the header.
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null)
  if (!token) return res.status(401).json({ error: 'Missing token' })

  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Forbidden' })
    next()
  }
}
