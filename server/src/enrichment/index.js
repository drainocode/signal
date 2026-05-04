/**
 * Stage 3: Enrichment Orchestrator
 *
 * Builds a complete operational profile for each qualified business.
 * Runs all enrichment sources in parallel where possible.
 *
 * Pipeline per business:
 *   1. Fetch website content (homepage + about + contact pages)
 *   2. Detect tech stack from HTML (ads, vertical software, booking)
 *   3. Test form presence and auto-reply configuration
 *   4. Omkar enrichment API (contacts, emails, reviews) — async, runs in parallel
 *   5. Save all results to Supabase
 */

import { fetchWebsiteEnrichment }                       from './websiteEnricher.js'
import { detectTechStack }                              from './techStackDetector.js'
import { testFormPresence }                             from './formTester.js'
import { enrichBusinessViaOmkar }                       from './omkarEnrichment.js'
import { saveEnrichmentResult, getBusinessesForEnrichment, getEnrichmentStats } from '../db/enrichmentRepository.js'

// ── Run enrichment for all qualified businesses ───────────────────────────

export const runEnrichment = async ({ limit = 50 } = {}) => {
  console.log('[Enrichment] Starting Stage 3...')

  const businesses = await getBusinessesForEnrichment(limit)
  console.log(`[Enrichment] ${businesses.length} qualified businesses to enrich`)

  if (businesses.length === 0) return { enriched: 0, failed: 0 }

  const stats = { enriched: 0, failed: 0, errors: [] }

  for (const business of businesses) {
    try {
      await enrichBusiness(business)
      stats.enriched++
      // Delay between businesses to respect rate limits
      await delay(3000)
    } catch (err) {
      console.error(`[Enrichment] Failed for "${business.name}":`, err.message)
      stats.failed++
      stats.errors.push({ business: business.name, error: err.message })
    }
  }

  console.log(`[Enrichment] Complete — enriched: ${stats.enriched}, failed: ${stats.failed}`)
  return stats
}

// ── Enrich a single business ──────────────────────────────────────────────

export const enrichBusiness = async (business) => {
  const { name, website, vertical } = business
  console.log(`\n[Enrichment] Processing: "${name}"`)

  // Run website fetch and Omkar enrichment in parallel
  const [websiteResult, omkarResult] = await Promise.allSettled([
    fetchWebsiteEnrichment(website),
    enrichBusinessViaOmkar(business),
  ])

  const website_data = websiteResult.status === 'fulfilled'
    ? websiteResult.value
    : { success: false, html: '', text: '', emails: [], phones: [], address: null }

  const omkar_data = omkarResult.status === 'fulfilled'
    ? omkarResult.value
    : null

  // Detect tech stack from website HTML
  const techStack = detectTechStack(website_data.html, vertical)

  // Test form presence (uses already-fetched HTML)
  const formResult = await testFormPresence(website, website_data.html)

  // Merge emails — combine from website scraping and Omkar
  const allEmails = [
    ...(website_data.emails || []),
    ...(omkar_data?.emails  || []),
  ]
  const uniqueEmails = [...new Set(allEmails.filter(Boolean))]

  // Merge social links
  const socialLinks = omkar_data?.social_links || {}

  // Build final enrichment record
  const enrichmentData = {
    // Website data
    emails:       uniqueEmails,
    phones:       website_data.phones  || [],
    address:      website_data.address || omkar_data?.address || null,
    website_text: website_data.text    || null,

    // Tech stack detection
    ads:                  techStack.ads,
    vertical_software:    techStack.vertical_software,
    missing_software:     techStack.missing_software,
    has_booking:          techStack.has_booking,
    has_chat:             techStack.has_chat,
    tech_gap_score:       techStack.tech_gap_score,
    tech_gap_description: techStack.tech_gap_description,

    // Form test
    has_contact_form: formResult.has_contact_form,
    form_auto_reply:  formResult.form_auto_reply,
    form_service:     formResult.form_service,

    // Social
    social_links: socialLinks,

    // From Omkar
    google_rating:        omkar_data?.google_rating        || business.google_rating,
    review_count:         omkar_data?.review_count         || business.review_count,
    review_response_rate: omkar_data?.review_response_rate || null,
    review_sample_size:   omkar_data?.review_sample_size   || 0,
    recent_reviews:       omkar_data?.recent_reviews       || [],
    contacts:             omkar_data?.contacts             || [],

    // Raw Omkar data
    raw_omkar_data: omkar_data?.raw_omkar_data || null,
  }

  // Log what we found
  console.log(`[Enrichment] "${name}" results:`)
  console.log(`  Website:     ${website_data.success ? 'fetched' : 'failed'}`)
  console.log(`  Emails:      ${uniqueEmails.length}`)
  console.log(`  Tech gaps:   ${techStack.missing_software.join(', ') || 'none'}`)
  console.log(`  Google ads:  ${techStack.ads.google_ads}`)
  console.log(`  Meta ads:    ${techStack.ads.meta_ads}`)
  console.log(`  Has form:    ${formResult.has_contact_form}`)
  console.log(`  Auto reply:  ${formResult.form_auto_reply}`)
  console.log(`  Contacts:    ${omkar_data?.contacts?.length || 0}`)
  console.log(`  Review rate: ${omkar_data?.review_response_rate ?? 'unknown'}%`)

  // Save to database
  await saveEnrichmentResult(business.id, enrichmentData)
  console.log(`[Enrichment] ✓ "${name}" saved`)
}

const delay = (ms) => new Promise(r => setTimeout(r, ms))
