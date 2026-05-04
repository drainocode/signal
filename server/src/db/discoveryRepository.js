/**
 * Discovery Repository
 *
 * Handles all database operations for Stage 1 discovery.
 * Saves discovered businesses to Supabase with deduplication.
 *
 * Deduplication strategy (in order):
 *   1. google_place_id match — most reliable
 *   2. Exact name + city + country match
 *   3. Website domain match
 */

import { supabase } from './supabaseClient.js'

// ── Save a batch of discovered businesses ─────────────────────────────────

export const saveDiscoveredBusinesses = async (businesses) => {
  const stats = { created: 0, duplicates: 0, errors: 0 }

  for (const business of businesses) {
    try {
      const result = await saveBusiness(business)
      if      (result === 'created')   stats.created++
      else if (result === 'duplicate') stats.duplicates++
    } catch (err) {
      console.error(`[DiscoveryRepo] Error saving "${business.name}":`, err.message)
      stats.errors++
    }
  }

  return stats
}

// ── Save a single business ────────────────────────────────────────────────

const saveBusiness = async (business) => {
  const {
    name,
    website,
    phone,
    address,
    city,
    state,
    country,
    vertical,
    categories,
    source,
    discovery_date,
    google_place_id,
    google_maps_url,
    google_rating,
    review_count,
    is_spending_on_ads,
  } = business

  if (!name || name.trim().length < 2) return 'skipped'

  // ── Check for existing record ─────────────────────────────────────────

  // 1. Match by google_place_id — most reliable dedup key
  if (google_place_id) {
    const { data: existing } = await supabase
      .from('businesses')
      .select('id, google_place_id')
      .eq('google_place_id', google_place_id)
      .maybeSingle()

    if (existing) {
      await updateExisting(existing.id, { google_rating, review_count, is_spending_on_ads })
      return 'duplicate'
    }
  }

  // 2. Match by exact name + city + country
  const { data: nameMatch } = await supabase
    .from('businesses')
    .select('id')
    .ilike('name', name.trim())
    .ilike('city', city?.trim() || '')
    .eq('country', country || 'US')
    .maybeSingle()

  if (nameMatch) {
    await updateExisting(nameMatch.id, { google_place_id, google_rating, review_count, is_spending_on_ads })
    return 'duplicate'
  }

  // 3. Match by website domain
  if (website) {
    const domain = extractDomain(website)
    if (domain) {
      const { data: domainMatch } = await supabase
        .from('businesses')
        .select('id')
        .ilike('website', `%${domain}%`)
        .maybeSingle()

      if (domainMatch) {
        await updateExisting(domainMatch.id, { google_place_id, google_rating, review_count, is_spending_on_ads })
        return 'duplicate'
      }
    }
  }

  // ── Insert new record ─────────────────────────────────────────────────

  const { error } = await supabase
    .from('businesses')
    .insert({
      name:               name.trim(),
      website:            website || null,
      phone:              phone || null,
      address:            address || null,
      city:               city?.trim() || null,
      state:              state || null,
      country:            country || 'US',
      vertical,
      categories:         categories || [],
      source:             source || 'omkar_google_maps',
      discovery_date:     discovery_date || new Date().toISOString().split('T')[0],
      google_place_id:    google_place_id || null,
      google_maps_url:    google_maps_url || null,
      google_rating:      google_rating || null,
      review_count:       review_count || 0,
      is_spending_on_ads: is_spending_on_ads || false,
      pipeline_status:    'discovered',
    })

  if (error) {
    // Handle race condition on unique constraint
    if (error.code === '23505') return 'duplicate'
    throw new Error(error.message)
  }

  return 'created'
}

// ── Update existing record with new data ──────────────────────────────────
// Only updates fields that have improved data — never overwrites with null

const updateExisting = async (id, updates) => {
  const patch = {}

  if (updates.google_place_id) patch.google_place_id    = updates.google_place_id
  if (updates.google_rating)   patch.google_rating       = updates.google_rating
  if (updates.review_count)    patch.review_count        = updates.review_count
  if (updates.is_spending_on_ads !== undefined) patch.is_spending_on_ads = updates.is_spending_on_ads

  if (Object.keys(patch).length === 0) return

  await supabase
    .from('businesses')
    .update(patch)
    .eq('id', id)
}

// ── Fetch businesses for qualification ───────────────────────────────────
// Returns businesses that have not been qualified yet

export const getUnqualifiedBusinesses = async (limit = 500) => {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('pipeline_status', 'discovered')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`[DiscoveryRepo] Failed to fetch unqualified: ${error.message}`)
  return data || []
}

// ── Update pipeline status ────────────────────────────────────────────────

export const updatePipelineStatus = async (businessId, status) => {
  const { error } = await supabase
    .from('businesses')
    .update({ pipeline_status: status })
    .eq('id', businessId)

  if (error) throw new Error(`[DiscoveryRepo] Failed to update status: ${error.message}`)
}

// ── Get discovery stats ───────────────────────────────────────────────────

export const getDiscoveryStats = async () => {
  const { data, error } = await supabase
    .from('businesses')
    .select('pipeline_status, vertical, country')

  if (error) throw new Error(`[DiscoveryRepo] Stats query failed: ${error.message}`)

  const stats = {
    total: data.length,
    byStatus: {},
    byVertical: {},
  }

  for (const row of data) {
    stats.byStatus[row.pipeline_status]  = (stats.byStatus[row.pipeline_status]  || 0) + 1
    stats.byVertical[row.vertical]       = (stats.byVertical[row.vertical]       || 0) + 1
  }

  return stats
}

// ── Helpers ───────────────────────────────────────────────────────────────

const extractDomain = (url = '') => {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}
