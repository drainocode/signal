/**
 * Signal Intelligence Engine — API Server
 *
 * Express server that serves pre-computed intelligence data
 * to the Signal dashboard frontend.
 *
 * No external API calls at query time — all data is pre-computed
 * and stored in Supabase. Only exception: POST /outreach/draft
 * which calls Claude Haiku to generate personalised outreach.
 *
 * Start with: npm start
 * Dev with:   npm run dev
 */

import 'dotenv/config'
import express        from 'express'
import cors           from 'cors'
import companiesRouter  from './routes/companies.js'
import signalsRouter    from './routes/signals.js'
import verticalsRouter  from './routes/verticals.js'
import outreachRouter   from './routes/outreach.js'
import statsRouter      from './routes/stats.js'

const app  = express()
const PORT = process.env.PORT || 3000

// ── Middleware ────────────────────────────────────────────────────────────

app.use(cors())
app.use(express.json())

// Request logging
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`)
  next()
})

// ── Routes ────────────────────────────────────────────────────────────────

app.use('/api/companies',  companiesRouter)
app.use('/api/signals',    signalsRouter)
app.use('/api/verticals',  verticalsRouter)
app.use('/api/outreach',   outreachRouter)
app.use('/api/stats',      statsRouter)

// ── Health check ──────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── 404 handler ───────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// ── Error handler ─────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[API] Error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[API] Signal Engine running on port ${PORT}`)
})

export default app
