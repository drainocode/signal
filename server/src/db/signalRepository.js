/**
 * Signal Repository
 *
 * Handles all database operations for Stage 4 signal monitoring.
 * Saves signal events and manages signal history for trend detection.
 */

import { supabase } from './supabaseClient.js'

// ── Save a signal event ───────────────────────────────────────────────────

export const saveSignalEvent = async ({
  businessId,
  signalType,
  signalCategory,
  signalSource,
  signalContent,
  signalData = {},
  severity = 'medium',
  impactScore = null,
}) => {
  const { error } = await supabase
    .from('signal_events')
    .insert({
      business_id:     businessId,
      signal_type:     signalType,
      signal_category: signalCategory,
      signal_source:   signalSource,
      signal_content:  signalContent,
      signal_data:     signalData,
      severity,
      impact_score:    impactScore,
      detected_at:     new Date().toISOString(),
      signal_date:     new Date().toISOString().split('T')[0],
    })

  if (error) {
    console.error(`[SignalRepo] Failed to save signal for business ${businessId}:`, error.message)
    return false
  }
  return true
}

// ── Save multiple signal events ───────────────────────────────────────────

export const saveSignalEvents = async (events) => {
  if (!events || events.length === 0) return { saved: 0, errors: 0 }

  const rows = events.map(e => ({
    business_id:     e.businessId,
    signal_type:     e.signalType,
    signal_category: e.signalCategory,
    signal_source:   e.signalSource,
    signal_content:  e.signalContent,
    signal_data:     e.signalData || {},
    severity:        e.severity || 'medium',
    impact_score:    e.impactScore || null,
    detected_at:     new Date().toISOString(),
    signal_date:     new Date().toISOString().split('T')[0],
  }))

  const { error } = await supabase
    .from('signal_events')
    .insert(rows)

  if (error) {
    console.error(`[SignalRepo] Batch save failed:`, error.message)
    return { saved: 0, errors: rows.length }
  }

  return { saved: rows.length, errors: 0 }
}

// ── Get recent signals for a business ────────────────────────────────────

export const getRecentSignals = async (businessId, days = 30) => {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  const { data, error } = await supabase
    .from('signal_events')
    .select('*')
    .eq('business_id', businessId)
    .gte('detected_at', cutoff.toISOString())
    .order('detected_at', { ascending: false })

  if (error) throw new Error(`[SignalRepo] Failed to get signals: ${error.message}`)
  return data || []
}

// ── Get last signal of a specific type for a business ─────────────────────

export const getLastSignal = async (businessId, signalType) => {
  const { data, error } = await supabase
    .from('signal_events')
    .select('*')
    .eq('business_id', businessId)
    .eq('signal_type', signalType)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`[SignalRepo] Failed to get last signal: ${error.message}`)
  return data
}

// ── Get businesses ready for signal monitoring ────────────────────────────

export const getBusinessesForMonitoring = async (limit = 100) => {
  const { data, error } = await supabase
    .from('businesses')
    .select(`
      *,
      enrichment_data (
        tech_stack,
        has_google_ads,
        has_meta_ads,
        review_count,
        review_response_rate,
        social_links
      )
    `)
    .in('pipeline_status', ['enriched', 'scored'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`[SignalRepo] Failed to fetch businesses: ${error.message}`)
  return data || []
}

// ── Get signal feed for dashboard ────────────────────────────────────────

export const getSignalFeed = async ({ limit = 50, vertical = null, days = 7 } = {}) => {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  let query = supabase
    .from('signal_events')
    .select(`
      *,
      business:businesses (
        id, name, city, state, vertical,
        google_rating, review_count, website
      )
    `)
    .gte('detected_at', cutoff.toISOString())
    .order('detected_at', { ascending: false })
    .limit(limit)

  if (vertical) {
    query = query.eq('businesses.vertical', vertical)
  }

  const { data, error } = await query
  if (error) throw new Error(`[SignalRepo] Feed query failed: ${error.message}`)
  return data || []
}

// ── Get signal stats ──────────────────────────────────────────────────────

export const getSignalStats = async () => {
  const { data, error } = await supabase
    .from('signal_events')
    .select('signal_type, signal_category, severity')

  if (error) throw new Error(`[SignalRepo] Stats query failed: ${error.message}`)

  const stats = {
    total:      data.length,
    byType:     {},
    byCategory: {},
    bySeverity: {},
  }

  for (const row of data) {
    stats.byType[row.signal_type]         = (stats.byType[row.signal_type]         || 0) + 1
    stats.byCategory[row.signal_category] = (stats.byCategory[row.signal_category] || 0) + 1
    stats.bySeverity[row.severity]        = (stats.bySeverity[row.severity]        || 0) + 1
  }

  return stats
}
