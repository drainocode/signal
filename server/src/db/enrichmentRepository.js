/**
 * Enrichment Repository
 *
 * Handles all database operations for Stage 3 enrichment.
 * Saves full enrichment profiles and contacts to Supabase.
 */

import { supabase } from './supabaseClient.js'

// ── Save full enrichment result for a business ────────────────────────────

export const saveEnrichmentResult = async (businessId, enrichmentData) => {
  const {
    // Website data
    emails,
    phones,
    address,
    website_text,

    // Tech stack
    ads,
    vertical_software,
    missing_software,
    has_booking,
    has_chat,
    tech_gap_score,
    tech_gap_description,

    // Form test
    has_contact_form,
    form_auto_reply,
    form_service,

    // Social
    social_links,

    // Omkar enrichment
    google_rating,
    review_count,
    review_response_rate,
    review_sample_size,
    recent_reviews,

    // Contacts from Apollo
    contacts,

    // Raw data
    raw_omkar_data,
  } = enrichmentData

  // Upsert enrichment_data record
  const { error: enrichError } = await supabase
    .from('enrichment_data')
    .upsert({
      business_id:          businessId,
      contact_emails:       emails         || [],
      contact_phones:       phones         || [],
      website_address:      address        || null,
      website_content:      website_text   || null,

      tech_stack: {
        detected:         vertical_software || [],
        missing:          missing_software  || [],
        has_booking:      has_booking       || false,
        has_chat:         has_chat          || false,
        google_ads:       ads?.google_ads   || false,
        meta_ads:         ads?.meta_ads     || false,
      },
      tech_gap_detected:    (missing_software || []).length > 0,

      has_contact_form:     has_contact_form     || false,
      form_auto_reply:      form_auto_reply       || false,

      has_google_ads:       ads?.google_ads       || false,
      has_meta_ads:         ads?.meta_ads         || false,

      social_links:         social_links          || {},

      google_rating:        google_rating         || null,
      review_count:         review_count          || null,
      review_response_rate: review_response_rate  || null,
      recent_reviews:       recent_reviews        || [],

      raw_data: {
        tech_gap_score:       tech_gap_score,
        tech_gap_description: tech_gap_description,
        review_sample_size:   review_sample_size,
        form_service:         form_service,
        omkar:                raw_omkar_data || null,
      },

      enrichment_status: 'enriched',
      enriched_at:       new Date().toISOString(),
      last_enriched_at:  new Date().toISOString(),
    }, {
      onConflict: 'business_id',
    })

  if (enrichError) throw new Error(`[EnrichRepo] Enrichment save failed: ${enrichError.message}`)

  // Save contacts
  if (contacts && contacts.length > 0) {
    await saveContacts(businessId, contacts)
  }

  // Update business pipeline status
  await supabase
    .from('businesses')
    .update({ pipeline_status: 'enriched' })
    .eq('id', businessId)
}

// ── Save contacts ─────────────────────────────────────────────────────────

const saveContacts = async (businessId, contacts) => {
  for (const contact of contacts) {
    if (!contact.name) continue

    const { error } = await supabase
      .from('contacts')
      .upsert({
        business_id:      businessId,
        name:             contact.name,
        title:            contact.title        || null,
        email:            contact.email        || null,
        email_verified:   contact.email_verified || false,
        email_source:     contact.source       || 'apollo',
        phone:            contact.phone        || null,
        linkedin_url:     contact.linkedin_url || null,
        is_primary_contact: contacts.indexOf(contact) === 0,
        source:           contact.source       || 'apollo',
      }, {
        onConflict: 'business_id,name',
        ignoreDuplicates: false,
      })

    if (error && error.code !== '23505') {
      console.error(`[EnrichRepo] Contact save failed for "${contact.name}":`, error.message)
    }
  }
}

// ── Get businesses ready for enrichment ───────────────────────────────────

export const getBusinessesForEnrichment = async (limit = 50) => {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('pipeline_status', 'qualified')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`[EnrichRepo] Failed to fetch: ${error.message}`)
  return data || []
}

// ── Get enrichment stats ──────────────────────────────────────────────────

export const getEnrichmentStats = async () => {
  const { data, error } = await supabase
    .from('enrichment_data')
    .select('enrichment_status, tech_gap_detected, has_contact_form, form_auto_reply, has_google_ads, has_meta_ads')

  if (error) throw new Error(`[EnrichRepo] Stats query failed: ${error.message}`)

  const stats = {
    total:              data.length,
    techGapDetected:    data.filter(r => r.tech_gap_detected).length,
    hasContactForm:     data.filter(r => r.has_contact_form).length,
    formAutoReply:      data.filter(r => r.form_auto_reply).length,
    runningGoogleAds:   data.filter(r => r.has_google_ads).length,
    runningMetaAds:     data.filter(r => r.has_meta_ads).length,
  }

  return stats
}
