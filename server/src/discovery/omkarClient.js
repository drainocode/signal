/**
 * Omkar Google Maps Client
 *
 * Wrapper around the Omkar Google Maps Extractor API
 * running on VPS at 203.161.61.231:8000
 *
 * Used exclusively for Stage 1 discovery — finding LMM
 * businesses per vertical per city. Not used for enrichment.
 */

import Api from 'botasaurus-desktop-api'

const omkar = new Api({
  apiUrl: process.env.OMKAR_API_URL || 'http://203.161.61.231:8000',
  enableCache: false,
})

// ── Vertical search terms for LMM PE targets ──────────────────────────────

export const VERTICAL_SEARCH_TERMS = {
  hvac: [
    'HVAC company',
    'heating and cooling company',
    'air conditioning contractor',
    'HVAC contractor',
  ],
  dental: [
    'dental practice',
    'dental clinic',
    'dentist office',
    'family dentistry',
  ],
  physiotherapy: [
    'physical therapy clinic',
    'physiotherapy clinic',
    'physical therapist',
    'sports rehabilitation clinic',
  ],
  pest_control: [
    'pest control company',
    'exterminator',
    'pest management company',
  ],
  plumbing: [
    'plumbing company',
    'plumbing contractor',
    'plumber',
  ],
  landscaping: [
    'landscaping company',
    'lawn care company',
    'landscape contractor',
  ],
  optometry: [
    'optometry clinic',
    'eye care clinic',
    'optometrist',
  ],
  veterinary: [
    'veterinary clinic',
    'animal hospital',
    'vet clinic',
  ],
}

// ── US Cities for LMM discovery ───────────────────────────────────────────

export const TARGET_CITIES = {
  southeast: [
    'US__GEORGIA__ATLANTA',
    'US__NORTH_CAROLINA__CHARLOTTE',
    'US__TENNESSEE__NASHVILLE',
    'US__FLORIDA__TAMPA',
    'US__FLORIDA__ORLANDO',
    'US__ALABAMA__BIRMINGHAM',
    'US__NORTH_CAROLINA__RALEIGH',
    'US__TENNESSEE__MEMPHIS',
  ],
  texas: [
    'US__TEXAS__DALLAS',
    'US__TEXAS__HOUSTON',
    'US__TEXAS__SAN_ANTONIO',
    'US__TEXAS__AUSTIN',
    'US__TEXAS__FORT_WORTH',
  ],
  midwest: [
    'US__ILLINOIS__CHICAGO',
    'US__OHIO__COLUMBUS',
    'US__OHIO__CLEVELAND',
    'US__MICHIGAN__DETROIT',
    'US__INDIANA__INDIANAPOLIS',
    'US__OHIO__CINCINNATI',
    'US__MISSOURI__KANSAS_CITY',
    'US__MISSOURI__ST_LOUIS',
  ],
  southwest: [
    'US__ARIZONA__PHOENIX',
    'US__NEVADA__LAS_VEGAS',
    'US__COLORADO__DENVER',
    'US__NEW_MEXICO__ALBUQUERQUE',
  ],
  northeast: [
    'US__PENNSYLVANIA__PHILADELPHIA',
    'US__MASSACHUSETTS__BOSTON',
    'US__MARYLAND__BALTIMORE',
    'US__PENNSYLVANIA__PITTSBURGH',
  ],
}

// ── Main discovery function ───────────────────────────────────────────────

export const discoverBusinesses = async ({ vertical, city, maxResults = 50 }) => {
  const searchTerms = VERTICAL_SEARCH_TERMS[vertical]
  if (!searchTerms) {
    console.error(`[OmkarClient] Unknown vertical: ${vertical}`)
    return []
  }

  const allResults = []
  const seen = new Set()

  for (const businessType of searchTerms) {
    try {
      console.log(`[OmkarClient] Searching: "${businessType}" in ${city}`)

      // createAsyncTask returns an ARRAY of tasks
      // Index 0 = "All Task" (parent), Index 1+ = individual city tasks
      // We poll the All Task (index 0) for overall completion
      const tasks = await omkar.createAsyncTask({
        scraperName: 'google_maps_scraper',
        data: {
          business_types: [businessType],
          search_method: 'city',
          cities: [city],
          countries: [],
          states: [],
          search_links: [],          // Empty — prevents default restaurant URL
          extraction_method: 'fast',
          max_results: maxResults,
          enable_website_contacts:  false,
          enable_emails_social:     false,
          enable_sales_summary:     false,
          enable_phone_info:        false,
          enable_leads:             false,
          enable_reviews_extraction: false,
          enable_photos_extraction: false,
          enrichment_filters:       ['not_permanently_closed'],
          randomize_cities:         false,
          include_places_outside_city: true,
          lang:                     null,
        },
      })

      // Get the All Task id from the array
      const allTask = Array.isArray(tasks)
        ? tasks.find(t => t.is_all_task) || tasks[0]
        : tasks

      const taskId = allTask?.id

      if (!taskId) {
        console.error(`[OmkarClient] Could not get task ID from response`)
        continue
      }

      console.log(`[OmkarClient] Task created: id=${taskId}, status=${allTask.status}`)

      // Poll for completion
      const results = await pollTaskResults(taskId)

      for (const result of results) {
        if (!result.name) continue

        const key = `${result.name.toLowerCase().trim()}-${city}`
        if (seen.has(key)) continue
        seen.add(key)

        allResults.push(normaliseResult(result, vertical, city))
      }

      console.log(`[OmkarClient] Found ${results.length} results for "${businessType}" in ${city}`)

      await delay(3000)

    } catch (err) {
      console.error(`[OmkarClient] Error searching "${businessType}" in ${city}:`, err.message)
    }
  }

  console.log(`[OmkarClient] Total: ${allResults.length} unique businesses in ${city} for ${vertical}`)
  return allResults
}

// ── Poll for task completion ───────────────────────────────────────────────

const pollTaskResults = async (taskId, maxWaitMs = 300000) => {
  const pollInterval = 5000
  const startTime = Date.now()

  console.log(`[OmkarClient] Polling task ${taskId}...`)

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const task = await omkar.getTask(taskId)
      const status = task?.status || task?.[0]?.status

      console.log(`[OmkarClient] Task ${taskId} status: ${status}`)

      if (status === 'completed') {
        const response = await omkar.getTaskResults({ taskId })
        // Results may be nested under .results or be the array directly
        const results = response?.results || response || []
        console.log(`[OmkarClient] Task ${taskId} completed — ${results.length} results`)
        return results
      }

      if (status === 'failed') {
        console.error(`[OmkarClient] Task ${taskId} failed`)
        return []
      }

      await delay(pollInterval)

    } catch (err) {
      console.error(`[OmkarClient] Poll error for task ${taskId}:`, err.message)
      await delay(pollInterval)
    }
  }

  console.error(`[OmkarClient] Task ${taskId} timed out after ${maxWaitMs / 1000}s`)
  return []
}

// ── Normalise Omkar result to our schema ──────────────────────────────────

const normaliseResult = (result, vertical, omkarCity) => {
  const parts = omkarCity.split('__')
  const state = parts[1]?.replace(/_/g, ' ') || null
  const city  = parts[2]?.replace(/_/g, ' ') || null

  return {
    name:               result.name?.trim() || null,
    website:            result.website || null,
    phone:              result.phone_number || result.phone || null,
    address:            result.address || null,
    city:               city || result.city || null,
    state:              state || null,
    country:            'US',
    vertical,
    google_place_id:    result.place_id || null,
    google_rating:      result.rating || null,
    review_count:       result.reviews || result.review_count || 0,
    google_maps_url:    result.link || result.url || null,
    categories:         result.categories || [],
    is_spending_on_ads: result.is_spending_on_ads || false,
    source:             'omkar_google_maps',
    discovery_date:     new Date().toISOString().split('T')[0],
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

const delay = (ms) => new Promise(r => setTimeout(r, ms))
