/**
 * Signals Routes
 *
 * GET /api/signals/feed — global signal feed across all companies
 */

import { Router }   from 'express'
import { supabase } from '../db/supabaseClient.js'

const router = Router()

// ── GET /api/signals/feed ─────────────────────────────────────────────────
// Daily signal feed filtered by mandate criteria
// Query params: vertical, state, min_score, days, category, limit

router.get('/feed', async (req, res) => {
  try {
    const {
      vertical,
      state,
      min_score = 0,
      days      = 7,
      category,
      severity,
      limit     = 50,
    } = req.query

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - parseInt(days))

    const { data, error } = await supabase
      .from('signal_events')
      .select(`
        id, signal_type, signal_category, signal_source,
        signal_content, severity, impact_score, detected_at,
        business:businesses (
          id, name, city, state, vertical,
          google_rating, review_count, website,
          readiness_scores ( readiness_score, benchmark_percentile )
        )
      `)
      .gte('detected_at', cutoff.toISOString())
      .order('detected_at', { ascending: false })
      .limit(parseInt(limit))

    if (error) throw error

    // Filter in JS based on business properties
    let signals = (data || []).filter(s => {
      const biz   = s.business
      if (!biz) return false
      if (vertical && biz.vertical !== vertical) return false
      if (state && biz.state !== state) return false
      if (category && s.signal_category !== category) return false
      if (severity && s.severity !== severity) return false

      const score = biz.readiness_scores?.[0]?.readiness_score
      if (score !== null && score !== undefined && score < parseFloat(min_score)) return false

      return true
    })

    const feed = signals.map(s => ({
      id:           s.id,
      type:         s.signal_type,
      category:     s.signal_category,
      source:       s.signal_source,
      content:      s.signal_content,
      severity:     s.severity,
      impact_score: s.impact_score,
      detected_at:  s.detected_at,
      company: s.business ? {
        id:           s.business.id,
        name:         s.business.name,
        city:         s.business.city,
        state:        s.business.state,
        vertical:     s.business.vertical,
        score:        s.business.readiness_scores?.[0]?.readiness_score,
        percentile:   s.business.readiness_scores?.[0]?.benchmark_percentile,
      } : null,
    }))

    res.json({ signals: feed, count: feed.length })

  } catch (err) {
    console.error('[API] GET /signals/feed error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
