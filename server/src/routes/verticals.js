/**
 * Verticals Routes
 *
 * GET /api/verticals/:vertical/benchmark — benchmark data for a vertical
 */

import { Router }   from 'express'
import { supabase } from '../db/supabaseClient.js'
import { buildBenchmarkStats } from '../scoring/benchmarkEngine.js'

const router = Router()

const first = (val) => Array.isArray(val) ? val[0] : val

router.get('/:vertical/benchmark', async (req, res) => {
  try {
    const { vertical }    = req.params
    const { state, city } = req.query

    let query = supabase
      .from('businesses')
      .select(`
        id, name, city, state, vertical,
        google_rating, review_count,
        readiness_scores (
          readiness_score,
          tech_gap_score,
          hiring_signal_score,
          digital_presence_score,
          review_health_score,
          operational_score,
          benchmark_percentile,
          score_rationale,
          scored_at
        ),
        qualification_results (
          estimated_employee_range,
          owner_operated_likelihood
        )
      `)
      .eq('vertical', vertical)
      .in('pipeline_status', ['scored', 'enriched'])

    if (state) query = query.eq('state', state)
    if (city)  query = query.ilike('city', `%${city}%`)

    const { data: rows, error: queryError } = await query

    if (queryError) throw queryError

    const businesses = (rows || []).filter(b => first(b.readiness_scores)?.readiness_score != null)

    if (businesses.length === 0) {
      return res.json({
        vertical,
        company_count: 0,
        message: 'No scored companies found for this vertical and region',
      })
    }

    const scores     = businesses.map(b => first(b.readiness_scores).readiness_score)
    const benchStats = buildBenchmarkStats(scores)

    const ranked = businesses
      .map(b => {
        const rs = first(b.readiness_scores)
        const qr = first(b.qualification_results)
        return {
          id:                   b.id,
          name:                 b.name,
          city:                 b.city,
          state:                b.state,
          score:                rs?.readiness_score,
          benchmark_percentile: rs?.benchmark_percentile,
          score_rationale:      rs?.score_rationale,
          tech_gap:             rs?.tech_gap_score,
          hiring:               rs?.hiring_signal_score,
          digital:              rs?.digital_presence_score,
          review_health:        rs?.review_health_score,
          operations:           rs?.operational_score,
          employee_range:       qr?.estimated_employee_range,
          owner_operated:       qr?.owner_operated_likelihood,
        }
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))

    const topTargets = ranked.filter(b => (b.score || 0) >= 7)

    res.json({
      vertical,
      company_count:   businesses.length,
      benchmark_stats: benchStats,
      top_targets:     topTargets,
      all_companies:   ranked,
    })

  } catch (err) {
    console.error('[API] GET /verticals/:vertical/benchmark error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
