import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import authRoutes from './routes/auth.js'
import syncRoutes from './routes/sync.js'
import adminRoutes from './routes/admin.js'

const app = express()

app.use(cors()) // teacher phones and the admin dashboard both call this API cross-origin
app.use(express.json({ limit: '10mb' })) // a synced batch can carry many assessments at once

app.get('/health', (req, res) => res.json({ ok: true }))

app.use('/api', authRoutes)
app.use('/api', syncRoutes)
app.use('/api', adminRoutes)

// Centralized error handler so an unexpected exception in any route
// returns clean JSON instead of crashing the request with an HTML stack
// trace -- matters here since the client is a phone silently retrying,
// not a developer reading logs.
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`TAKMIL Pre-Assessment API listening on :${port}`))
