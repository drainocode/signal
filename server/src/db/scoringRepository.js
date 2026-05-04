/**
 * Scoring Repository
 *
 * Handles all database operations for Stage 5 scoring.
 * Saves readiness scores and benchmark data to Supabase.
 */

import { supabase } from './supabaseClient.js'

// ── Save a readiness score ────────────────────────────────────────────────

export const saveReadinessScore = async (businessId, scoreData) => {
  const {
    readiness_score,
    tech_gap_score,
    hiring_signal_score,
    digital_presence_score,
    review_health_score,
    operational_score,
    benchmark_percentile,
    benchmark_vertical,
    benchmark_region,
    benchmark_company_count,
    score_rationale,
    score_breakdown,
  } = scoreData

  const { error } = await supabase
    .from('readiness_scores')
    .upsert({
      business_id:             businessId,
      readiness_score,
      tech_gap_score,
      hiring_signal_score,
      digital_presence_score,
      review_health_score,
      operational_score,
      benchmark_percentile:    benchmark_percentile    || null,
      benchmark_vertical:      benchmark_vertical      || null,
      benchmark_region:        benchmark_region        || null,
      benchmark_company_count: benchmark_company_count || null,
      score_rationale:         score_rationale         || null,
      score_version:           1,
      scored_at:               new Date().toISOString(),
    }, {
      onConflict: 'business_id',
    })

  if (error) throw new Error(`[ScoringRepo] Save failed: ${error.message}`)

  // Update business pipeline status
  await supabase
    .from('businesses')
    .update({ pipeline_status: 'scored' })
    .eq('id', businessId)
}

// ── Get all scores for benchmarking ──────────────────────────────────────

export const getScoresForBenchmark = async (vertical, region) => {
  let query = supabase
    .from('readiness_scores')
    .select('business_id, readiness_score, benchmark_vertical, benchmark_region')

  if (vertical) query = query.eq('benchmark_vertical', vertical)
  if (region)   query = query.eq('benchmark_region', region)

  const { data, error } = await query
  if (error) throw new Error(`[ScoringRepo] Benchmark fetch failed: ${error.message}`)
  return data || []
}

// ── Get businesses ready for scoring ─────────────────────────────────────

export const getBusinessesForScoring = async (limit = 100) => {
  const { data, error } = await supabase
    .from('businesses')
    .select(`
      id, name, website, vertical, city, state, country,
      google_rating, review_count, pipeline_status
    `)
    .in('pipeline_status', ['enriched', 'scored'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`[ScoringRepo] Fetch failed: ${error.message}`)

  // Fetch enrichment, signals, and qualification for each business
  const enriched = await Promise.all(
    (data || []).map(async (business) => {
      const [enrichmentRes, signalsRes, qualificationRes] = await Promise.all([
        supabase
          .from('enrichment_data')
          .select('*')
          .eq('business_id', business.id)
          .maybeSingle(),
        supabase
          .from('signal_events')
          .select('*')
          .eq('business_id', business.id),
        supabase
          .from('qualification_results')
          .select('*')
          .eq('business_id', business.id)
          .maybeSingle(),
      ])

      return {
        ...business,
        enrichment:    enrichmentRes.data    || null,
        signals:       signalsRes.data       || [],
        qualification: qualificationRes.data || null,
      }
    })
  )

  return enriched
}

// ── Get scoring stats ─────────────────────────────────────────────────────

export const getScoringStats = async () => {
  const { data, error } = await supabase
    .from('readiness_scores')
    .select('readiness_score, benchmark_vertical, benchmark_percentile, score_rationale')

  if (error) throw new Error(`[ScoringRepo] Stats failed: ${error.message}`)

  const stats = {
    total:       data.length,
    avgScore:    0,
    byVertical:  {},
    topTargets:  [],
  }

  if (data.length > 0) {
    stats.avgScore = Math.round(
      (data.reduce((sum, r) => sum + (r.readiness_score || 0), 0) / data.length) * 10
    ) / 10

    for (const row of data) {
      const v = row.benchmark_vertical || 'unknown'
      if (!stats.byVertical[v]) stats.byVertical[v] = []
      stats.byVertical[v].push(row.readiness_score)
    }

    stats.topTargets = data
      .sort((a, b) => (b.readiness_score || 0) - (a.readiness_score || 0))
      .slice(0, 5)
      .map(r => ({ score: r.readiness_score, rationale: r.score_rationale }))
  }

  return stats
}
