/**
 * Omkar Enrichment
 *
 * Calls Omkar API for qualified businesses to get:
 *   - Social links and emails from website
 *   - Apollo decision maker contacts
 *   - Review extraction (20 most recent with owner reply status)
 *
 * This is a SEPARATE call from Stage 1 discovery.
 * Stage 1 disabled enrichment to keep discovery cheap.
 * Stage 3 enables it only for the small number of qualified businesses.
 *
 * Cost estimate for 16 businesses:
 *   Social/emails:  16 × $0.002 = $0.03
 *   Apollo contact: 16 × $0.02  = $0.32
 *   Reviews:        included in base scraping
 *   Total: ~$0.35 for full enrichment of 16 businesses
 */

import Api from 'botasaurus-desktop-api'

const omkar = new Api({
  apiUrl:      process.env.OMKAR_API_URL || 'http://203.161.61.231:8000',
  enableCache: false,
})

// ── Enrich a single qualified business via Omkar ──────────────────────────

export const enrichBusinessViaOmkar = async (business) => {
  const { name, city, state, google_place_id, website } = business

  if (!name) return null

  const cityStr = city ? `${city}, ${state || ''}`.trim() : ''

  console.log(`[OmkarEnrich] Enriching: "${name}" in ${cityStr}`)

  try {
    // Use place_id if available for accurate lookup, otherwise search by name + city
    const searchLink = google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${google_place_id}`
      : null

    const tasks = await omkar.createAsyncTask({
      scraperName: 'google_maps_scraper',
      data: {
        business_types:   [name],
        search_method:    searchLink ? 'links' : 'city',
        search_links:     searchLink ? [searchLink] : [],
        cities:           searchLink ? [] : [formatOmkarCity(city, state)],
        countries:        [],
        states:           [],
        extraction_method: 'fast',
        max_results:      1,

        // Enable enrichment add-ons for Stage 3
        api_key: process.env.OMKAR_API_KEY || '',
        product_description: 'PE acquisition intelligence platform identifying owner-operated LMM businesses',
        enable_website_contacts:   true,   // $0.002 — gets emails + social links
        enable_emails_social:      true,
        recommended_emails_count:  '1',    // Get top 1 recommended email
        verify_recommended_emails: true,   // Verify deliverability
        email_verification_service: 'millionverifier',

        enable_leads:              true,   // $0.02 — Apollo decision maker
        leads_max_per_place:       '2',    // Get up to 2 contacts
        leads_seniorities:         ['owner', 'founder', 'c_suite', 'vp', 'director'],
        leads_person_titles:       '',
        leads_contact_email_status: ['verified'],
        leads_person_locations:    '',

        // Review extraction for response rate calculation
        enable_reviews_extraction: true,
        max_reviews:               20,
        reviews_sort:              'newest',
        reviews_query:             '',

        // Disable unused add-ons
        enable_sales_summary:      false,
        enable_phone_info:         false,
        enable_photos_extraction:  false,

        enrichment_filters:        ['not_permanently_closed'],
        randomize_cities:          false,
        include_places_outside_city: true,
        lang:                      null,
      },
    })

    // Get task ID
    const allTask = Array.isArray(tasks)
      ? tasks.find(t => t.is_all_task) || tasks[0]
      : tasks

    const taskId = allTask?.id
    if (!taskId) {
      console.error(`[OmkarEnrich] No task ID for "${name}"`)
      return null
    }

    // Poll for completion
    const results = await pollTaskResults(taskId)
    if (!results || results.length === 0) {
      console.log(`[OmkarEnrich] No results for "${name}"`)
      return null
    }

    const result = results[0]
    return parseEnrichmentResult(result, business)

  } catch (err) {
    console.error(`[OmkarEnrich] Failed for "${name}":`, err.message)
    return null
  }
}

// ── Parse Omkar enrichment result ─────────────────────────────────────────

const parseEnrichmentResult = (result, business) => {
  // Extract emails
  const emails = []
  if (result.emails)               emails.push(...(Array.isArray(result.emails) ? result.emails : [result.emails]))
  if (result.recommended_emails)   emails.push(...(Array.isArray(result.recommended_emails) ? result.recommended_emails : [result.recommended_emails]))
  if (result.email)                emails.push(result.email)

  // Extract social links
  const socialLinks = {
    facebook:  result.facebook  || result.facebook_url  || null,
    instagram: result.instagram || result.instagram_url || null,
    linkedin:  result.linkedin  || result.linkedin_url  || null,
    twitter:   result.twitter   || result.twitter_url   || null,
    youtube:   result.youtube   || result.youtube_url   || null,
  }

  // Extract Apollo leads/contacts
  const contacts = []
  if (result.leads && Array.isArray(result.leads)) {
    for (const lead of result.leads) {
      contacts.push({
        name:        lead.name        || lead.full_name  || null,
        title:       lead.title       || lead.job_title  || null,
        email:       lead.email       || lead.work_email || null,
        linkedin_url: lead.linkedin   || lead.linkedin_url || null,
        phone:       lead.phone       || null,
        source:      'apollo',
        email_verified: lead.email_status === 'verified',
      })
    }
  }

  // Extract and analyse reviews for response rate
  const reviews = result.detailed_reviews || result.featured_reviews || []
  const reviewAnalysis = analyseReviews(reviews)

  return {
    // Basic data
    phone:          result.phone_number || result.phone || business.phone || null,
    website:        result.website      || business.website || null,
    google_rating:  result.rating       || business.google_rating || null,
    review_count: typeof result.reviews === 'number' ? result.reviews : business.review_count || 0,

    // Enrichment data
    emails:         [...new Set(emails.filter(Boolean))],
    social_links:   socialLinks,
    contacts,

    // Review analysis
    review_response_rate:  reviewAnalysis.responseRate,
    review_sample_size:    reviewAnalysis.sampleSize,
    recent_reviews:        reviewAnalysis.recentReviews,

    // Raw data for reference
    raw_omkar_data: result,
  }
}

// ── Analyse reviews for response rate ────────────────────────────────────

const analyseReviews = (reviews) => {
  if (!reviews || reviews.length === 0) {
    return { responseRate: null, sampleSize: 0, recentReviews: [] }
  }

  const reviewArray = Array.isArray(reviews) ? reviews : []
  const sampleSize  = reviewArray.length

  // Count reviews that have an owner reply
  const withReply = reviewArray.filter(r =>
    r.response_from_owner_text !== null && r.response_from_owner_text !== undefined
  ).length

  const responseRate = sampleSize > 0
    ? Math.round((withReply / sampleSize) * 100)
    : null

  // Extract recent review summaries
  const recentReviews = reviewArray.slice(0, 5).map(r => ({
    rating:    r.rating       || null,
    text:      (r.review_text || '').slice(0, 200),
    date:      r.published_at_date || r.published_at || null,
    has_reply: r.response_from_owner_text !== null && r.response_from_owner_text !== undefined,
  }))

  return { responseRate, sampleSize, recentReviews }
}

// ── Poll for task completion ───────────────────────────────────────────────

const pollTaskResults = async (taskId, maxWaitMs = 300000) => {
  const pollInterval = 5000
  const startTime    = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const task   = await omkar.getTask(taskId)
      const status = task?.status || task?.[0]?.status

      if (status === 'completed') {
        const response = await omkar.getTaskResults({ taskId })
        return response?.results || response || []
      }

      if (status === 'failed') return []

      await delay(pollInterval)
    } catch {
      await delay(pollInterval)
    }
  }

  return []
}

// ── Format city for Omkar ─────────────────────────────────────────────────

const formatOmkarCity = (city, state) => {
  if (!city) return ''
  const cityFormatted  = city.toUpperCase().replace(/\s+/g, '_')
  const stateFormatted = (state || '').toUpperCase().replace(/\s+/g, '_')
  return `US__${stateFormatted}__${cityFormatted}`
}

const delay = (ms) => new Promise(r => setTimeout(r, ms))
