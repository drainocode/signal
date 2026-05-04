/**
 * Stats Routes
 *
 * GET /api/stats — dashboard summary statistics
 */

import { Router }   from 'express'
import { supabase } from '../db/supabaseClient.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const [businessRes, signalRes, scoreRes, contactRes] = await Promise.all([
      supabase.from('businesses').select('pipeline_status, vertical', { count: 'exact' }),
      supabase.from('signal_events').select('signal_type, signal_category, severity', { count: 'exact' }),
      supabase.from('readiness_scores').select('readiness_score, benchmark_vertical'),
      supabase.from('contacts').select('id', { count: 'exact' }),
    ])

    const businesses = businessRes.data || []
    const signals    = signalRes.data    || []
    const scores     = scoreRes.data     || []
    const contacts   = contactRes.count  || 0

    // Business pipeline breakdown
    const pipeline = {}
    for (const b of businesses) {
      pipeline[b.pipeline_status] = (pipeline[b.pipeline_status] || 0) + 1
    }

    // Score distribution
    const scored        = scores.filter(s => s.readiness_score !== null)
    const avgScore      = scored.length > 0
      ? Math.round((scored.reduce((sum, s) => sum + s.readiness_score, 0) / scored.length) * 10) / 10
      : null
    const highPriority  = scored.filter(s => s.readiness_score >= 7).length
    const primeTargets  = scored.filter(s => s.readiness_score >= 8).length

    // Signal summary (last 7 days)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const { data: recentSignals } = await supabase
      .from('signal_events')
      .select('signal_type')
      .gte('detected_at', cutoff.toISOString())

    res.json({
      pipeline,
      totals: {
        discovered:   businesses.length,
        qualified:    pipeline['qualified']  || 0,
        enriched:     pipeline['enriched']   || 0,
        scored:       pipeline['scored']     || 0,
        contacts:     contacts,
        signals_total: signals.length,
        signals_7days: recentSignals?.length || 0,
      },
      scores: {
        average:       avgScore,
        high_priority: highPriority,
        prime_targets: primeTargets,
      },
      signals_breakdown: {
        by_type:     countBy(signals, 'signal_type'),
        by_category: countBy(signals, 'signal_category'),
        by_severity: countBy(signals, 'severity'),
      },
    })

  } catch (err) {
    console.error('[API] GET /stats error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

const countBy = (arr, key) => {
  const counts = {}
  for (const item of arr) {
    const val = item[key] || 'unknown'
    counts[val] = (counts[val] || 0) + 1
  }
  return counts
}

export default router
