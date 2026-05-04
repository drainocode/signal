/**
 * Qualification Repository
 *
 * Handles all database operations for Stage 2 qualification.
 * Saves qualification decisions and updates business pipeline status.
 */

import { supabase } from './supabaseClient.js'

// ── Save qualification results ────────────────────────────────────────────

export const saveQualificationResults = async (results) => {
  const stats = { saved: 0, errors: 0 }

  for (const result of results) {
    try {
      await saveQualificationResult(result)
      stats.saved++
    } catch (err) {
      console.error(`[QualificationRepo] Error saving result for "${result.business_name}":`, err.message)
      stats.errors++
    }
  }

  return stats
}

// ── Save a single qualification result ───────────────────────────────────

const saveQualificationResult = async (result) => {
  const {
    business_id,
    is_qualified,
    disqualification_reason,
    qualification_score,
    signals,
    review_volume_signal,
    website_quality_signal,
    location_count,
    is_franchise,
    is_pe_backed,
  } = result

  // Upsert qualification result
  const { error: qualError } = await supabase
    .from('qualification_results')
    .upsert({
      business_id,
      is_qualified,
      disqualification_reason:  disqualification_reason || null,
      qualification_score,
      review_volume_signal,
      website_quality_signal,
      location_count:           location_count || 1,
      is_franchise:             is_franchise || false,
      is_pe_backed:             is_pe_backed || false,
      qualified_at:             new Date().toISOString(),
    }, {
      onConflict: 'business_id',
    })

  if (qualError) throw new Error(qualError.message)

  // Update pipeline status on the business record
  const newStatus = is_qualified ? 'qualified' : 'disqualified'
  const { error: bizError } = await supabase
    .from('businesses')
    .update({ pipeline_status: newStatus })
    .eq('id', business_id)

  if (bizError) throw new Error(bizError.message)
}

// ── Get qualified businesses for Stage 3 ─────────────────────────────────

export const getQualifiedBusinesses = async (limit = 200) => {
  const { data, error } = await supabase
    .from('businesses')
    .select(`
      *,
      qualification_results (
        qualification_score,
        review_volume_signal,
        website_quality_signal
      )
    `)
    .eq('pipeline_status', 'qualified')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`[QualificationRepo] Failed to fetch qualified: ${error.message}`)
  return data || []
}

// ── Get qualification stats ───────────────────────────────────────────────

export const getQualificationStats = async () => {
  const { data, error } = await supabase
    .from('qualification_results')
    .select('is_qualified, disqualification_reason, qualification_score')

  if (error) throw new Error(`[QualificationRepo] Stats query failed: ${error.message}`)

  const stats = {
    total:        data.length,
    qualified:    0,
    disqualified: 0,
    avgScore:     0,
    reasons:      {},
  }

  let totalScore = 0
  for (const row of data) {
    if (row.is_qualified) {
      stats.qualified++
    } else {
      stats.disqualified++
      const reason = row.disqualification_reason || 'unknown'
      stats.reasons[reason] = (stats.reasons[reason] || 0) + 1
    }
    totalScore += row.qualification_score || 0
  }

  stats.avgScore = data.length > 0
    ? Math.round(totalScore / data.length)
    : 0

  return stats
}
