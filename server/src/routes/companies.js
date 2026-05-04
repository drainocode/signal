/**
 * Companies Routes
 *
 * GET /api/companies                    — market map with filters
 * GET /api/companies/:id                — full company profile
 * GET /api/companies/:id/signals        — signal history for one company
 * GET /api/companies/:id/contacts       — contacts for one company
 */

import { Router }   from 'express'
import { supabase } from '../db/supabaseClient.js'

const router = Router()

// ── Helper: Supabase sometimes returns joined tables as object or array ────

const first = (val) => Array.isArray(val) ? val[0] : val

// ── GET /api/companies ────────────────────────────────────────────────────
// Market map view — filtered, sorted, paginated
// Query params: vertical, state, city, min_score, max_score, page, limit, sort

router.get('/', async (req, res) => {
  try {
    const {
      vertical,
      state,
      city,
      min_score = 0,
      max_score = 10,
      page      = 1,
      limit     = 50,
      sort      = 'score_desc',
    } = req.query

    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabase
      .from('businesses')
      .select(`
        id, name, website, phone, address, city, state, country,
        vertical, google_rating, review_count, pipeline_status,
        created_at,
        readiness_scores (
          readiness_score,
          tech_gap_score,
          hiring_signal_score,
          digital_presence_score,
          review_health_score,
          operational_score,
          benchmark_percentile,
          benchmark_vertical,
          benchmark_region,
          score_rationale,
          scored_at
        ),
        qualification_results (
          is_qualified,
          qualification_score,
          is_franchise,
          is_pe_backed,
          owner_operated_likelihood,
          estimated_employee_range
        )
      `, { count: 'exact' })
      .in('pipeline_status', ['enriched', 'scored'])

    if (vertical) query = query.eq('vertical', vertical)
    if (state)    query = query.eq('state', state)
    if (city)     query = query.ilike('city', `%${city}%`)

    query = query.range(offset, offset + parseInt(limit) - 1)

    const { data, error, count } = await query
    if (error) throw error

    // Filter by score range
    let filtered = (data || []).filter(b => {
      const rs    = first(b.readiness_scores)
      const score = rs?.readiness_score
      if (score === null || score === undefined) return false
      return score >= parseFloat(min_score) && score <= parseFloat(max_score)
    })

    // Sort
    if (sort === 'score_desc') {
      filtered.sort((a, b) => {
        const sa = first(a.readiness_scores)?.readiness_score || 0
        const sb = first(b.readiness_scores)?.readiness_score || 0
        return sb - sa
      })
    } else if (sort === 'score_asc') {
      filtered.sort((a, b) => {
        const sa = first(a.readiness_scores)?.readiness_score || 0
        const sb = first(b.readiness_scores)?.readiness_score || 0
        return sa - sb
      })
    } else if (sort === 'percentile_desc') {
      filtered.sort((a, b) => {
        const pa = first(a.readiness_scores)?.benchmark_percentile || 0
        const pb = first(b.readiness_scores)?.benchmark_percentile || 0
        return pb - pa
      })
    }

    // Flatten for API response
    const companies = filtered.map(b => {
      const rs = first(b.readiness_scores)
      const qr = first(b.qualification_results)

      return {
        id:              b.id,
        name:            b.name,
        website:         b.website,
        phone:           b.phone,
        city:            b.city,
        state:           b.state,
        vertical:        b.vertical,
        google_rating:   b.google_rating,
        review_count:    b.review_count,
        pipeline_status: b.pipeline_status,
        score:           rs?.readiness_score || null,
        score_breakdown: {
          tech_gap:      rs?.tech_gap_score      || null,
          hiring:        rs?.hiring_signal_score || null,
          digital:       rs?.digital_presence_score || null,
          review_health: rs?.review_health_score || null,
          operations:    rs?.operational_score   || null,
        },
        benchmark_percentile:   rs?.benchmark_percentile || null,
        benchmark_region:       rs?.benchmark_region     || null,
        score_rationale:        rs?.score_rationale      || null,
        scored_at:              rs?.scored_at             || null,
        is_franchise:           qr?.is_franchise          || false,
        is_pe_backed:           qr?.is_pe_backed          || false,
        owner_operated:         qr?.owner_operated_likelihood || null,
        employee_range:         qr?.estimated_employee_range  || null,
      }
    })

    res.json({
      companies,
      pagination: {
        page:  parseInt(page),
        limit: parseInt(limit),
        total: count,
      },
    })

  } catch (err) {
    console.error('[API] GET /companies error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/companies/:id ────────────────────────────────────────────────
// Full company profile — all data in one call

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const [businessRes, enrichmentRes, scoreRes, qualRes, signalsRes, contactsRes] =
      await Promise.all([
        supabase.from('businesses').select('*').eq('id', id).single(),
        supabase.from('enrichment_data').select('*').eq('business_id', id).maybeSingle(),
        supabase.from('readiness_scores').select('*').eq('business_id', id).maybeSingle(),
        supabase.from('qualification_results').select('*').eq('business_id', id).maybeSingle(),
        supabase.from('signal_events').select('*').eq('business_id', id).order('detected_at', { ascending: false }).limit(20),
        supabase.from('contacts').select('*').eq('business_id', id).order('is_primary_contact', { ascending: false }),
      ])

    if (businessRes.error) throw businessRes.error
    if (!businessRes.data) return res.status(404).json({ error: 'Company not found' })

    const business   = businessRes.data
    const enrichment = enrichmentRes.data
    const score      = scoreRes.data
    const qual       = qualRes.data
    const signals    = signalsRes.data || []
    const contacts   = contactsRes.data || []

    res.json({
      id:              business.id,
      name:            business.name,
      website:         business.website,
      phone:           business.phone,
      address:         business.address,
      city:            business.city,
      state:           business.state,
      country:         business.country,
      vertical:        business.vertical,
      google_rating:   business.google_rating,
      review_count:    business.review_count,
      google_maps_url: business.google_maps_url,
      pipeline_status: business.pipeline_status,
      discovery_date:  business.discovery_date,

      score: score ? {
        readiness_score:         score.readiness_score,
        tech_gap_score:          score.tech_gap_score,
        hiring_signal_score:     score.hiring_signal_score,
        digital_presence_score:  score.digital_presence_score,
        review_health_score:     score.review_health_score,
        operational_score:       score.operational_score,
        benchmark_percentile:    score.benchmark_percentile,
        benchmark_region:        score.benchmark_region,
        benchmark_company_count: score.benchmark_company_count,
        score_rationale:         score.score_rationale,
        scored_at:               score.scored_at,
      } : null,

      qualification: qual ? {
        is_qualified:              qual.is_qualified,
        qualification_score:       qual.qualification_score,
        is_franchise:              qual.is_franchise,
        is_pe_backed:              qual.is_pe_backed,
        owner_operated_likelihood: qual.owner_operated_likelihood,
        estimated_employee_range:  qual.estimated_employee_range,
      } : null,

      enrichment: enrichment ? {
        emails:               enrichment.contact_emails,
        phones:               enrichment.contact_phones,
        social_links:         enrichment.social_links,
        tech_stack:           enrichment.tech_stack,
        tech_gap_detected:    enrichment.tech_gap_detected,
        has_contact_form:     enrichment.has_contact_form,
        form_auto_reply:      enrichment.form_auto_reply,
        has_google_ads:       enrichment.has_google_ads,
        has_meta_ads:         enrichment.has_meta_ads,
        review_response_rate: enrichment.review_response_rate,
        recent_reviews:       enrichment.recent_reviews,
        enriched_at:          enrichment.enriched_at,
      } : null,

      signals: signals.map(s => ({
        id:           s.id,
        type:         s.signal_type,
        category:     s.signal_category,
        source:       s.signal_source,
        content:      s.signal_content,
        severity:     s.severity,
        impact_score: s.impact_score,
        detected_at:  s.detected_at,
      })),

      contacts: contacts.map(c => ({
        id:             c.id,
        name:           c.name,
        title:          c.title,
        email:          c.email,
        email_verified: c.email_verified,
        phone:          c.phone,
        linkedin_url:   c.linkedin_url,
        is_primary:     c.is_primary_contact,
      })),
    })

  } catch (err) {
    console.error('[API] GET /companies/:id error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/companies/:id/signals ────────────────────────────────────────

router.get('/:id/signals', async (req, res) => {
  try {
    const { id }              = req.params
    const { days = 90, category } = req.query

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - parseInt(days))

    let query = supabase
      .from('signal_events')
      .select('*')
      .eq('business_id', id)
      .gte('detected_at', cutoff.toISOString())
      .order('detected_at', { ascending: false })

    if (category) query = query.eq('signal_category', category)

    const { data, error } = await query
    if (error) throw error

    res.json({ signals: data || [] })

  } catch (err) {
    console.error('[API] GET /companies/:id/signals error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/companies/:id/contacts ──────────────────────────────────────

router.get('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('business_id', id)
      .order('is_primary_contact', { ascending: false })

    if (error) throw error
    res.json({ contacts: data || [] })

  } catch (err) {
    console.error('[API] GET /companies/:id/contacts error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
