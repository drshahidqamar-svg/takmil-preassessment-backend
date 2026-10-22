import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import authRoutes from './routes/auth.js'
import syncRoutes from './routes/sync.js'
import adminRoutes from './routes/admin.js'
import evaluationRoutes from './routes/evaluations.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))

app.use('/api', authRoutes)
app.use('/api', syncRoutes)
// Must be mounted BEFORE adminRoutes: the admin router applies an
// admin-only guard to every request that reaches it, which would 403 the
// teacher's evaluation sync.
app.use('/api', evaluationRoutes)
app.use('/api', adminRoutes)

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`TAKMIL Pre-Assessment API listening on :${port}`))
