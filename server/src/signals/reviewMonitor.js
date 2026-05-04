/**
 * Review Monitor
 *
 * Weekly check for review count changes and response rate trends.
 * Compares current review count against last stored value.
 *
 * Signal types emitted:
 *   - review_velocity_high: gaining reviews faster than average (healthy growth)
 *   - review_velocity_drop: gaining reviews slower than before (concerning)
 *   - review_response_poor: owner not responding to reviews (management gap)
 *   - review_response_improved: owner started responding more (positive change)
 */

import Api from 'botasaurus-desktop-api'
import { getLastSignal } from '../db/signalRepository.js'

const omkar = new Api({
  apiUrl:      process.env.OMKAR_API_URL || 'http://203.161.61.231:8000',
  enableCache: false,
})

// ── Check review changes for a business ──────────────────────────────────

export const checkReviewChanges = async (business, enrichmentData) => {
  const { id: businessId, name, google_place_id, city, state } = business
  const signals = []

  // Get current review data via Omkar (lightweight - no enrichment add-ons)
  const currentData = await fetchCurrentReviewData(business)
  if (!currentData) return signals

  const { currentCount, currentRating, responseRate } = currentData

  // Get previous review count from enrichment data
  const previousCount = enrichmentData?.review_count || business.review_count || 0
  const previousResponseRate = enrichmentData?.review_response_rate || null

  // ── Review velocity signals ───────────────────────────────────────────

  if (previousCount > 0 && currentCount > previousCount) {
    const weeklyGain = currentCount - previousCount
    const weeklyRate = ((weeklyGain / previousCount) * 100).toFixed(1)

    // High velocity — gaining more than 2% per week
    if (weeklyGain >= 5 || parseFloat(weeklyRate) >= 2) {
      signals.push({
        businessId,
        signalType:     'review_velocity_high',
        signalCategory: 'reviews',
        signalSource:   'google_maps',
        signalContent:  `Gained ${weeklyGain} new reviews this week (${weeklyRate}% growth) — strong customer activity`,
        signalData:     { currentCount, previousCount, weeklyGain, weeklyRate },
        severity:       'low',
        impactScore:    3,
      })
    }
  }

  if (previousCount > 50 && currentCount < previousCount) {
    signals.push({
      businessId,
      signalType:     'review_count_dropped',
      signalCategory: 'reviews',
      signalSource:   'google_maps',
      signalContent:  `Review count dropped from ${previousCount} to ${currentCount} — possible review removal`,
      signalData:     { currentCount, previousCount },
      severity:       'medium',
      impactScore:    6,
    })
  }

  // ── Review response rate signals ──────────────────────────────────────

  if (responseRate !== null) {
    // Poor response rate — not responding to customers
    if (responseRate < 20) {
      signals.push({
        businessId,
        signalType:     'review_response_poor',
        signalCategory: 'reviews',
        signalSource:   'google_maps',
        signalContent:  `Only responding to ${responseRate}% of Google reviews — significant customer management gap`,
        signalData:     { responseRate, currentCount },
        severity:       'high',
        impactScore:    7,
      })
    }

    // Response rate improved significantly
    if (previousResponseRate !== null && responseRate > previousResponseRate + 20) {
      signals.push({
        businessId,
        signalType:     'review_response_improved',
        signalCategory: 'reviews',
        signalSource:   'google_maps',
        signalContent:  `Review response rate improved from ${previousResponseRate}% to ${responseRate}% — business becoming more customer-focused`,
        signalData:     { responseRate, previousResponseRate },
        severity:       'low',
        impactScore:    2,
      })
    }
  }

  return signals
}

// ── Fetch current review data from Omkar ─────────────────────────────────

const fetchCurrentReviewData = async (business) => {
  const { name, google_place_id, city, state } = business

  try {
    const searchLink = google_place_id
      ? `https://www.google.com/maps/place/?q=place_id:${google_place_id}`
      : null

    const tasks = await omkar.createAsyncTask({
      scraperName: 'google_maps_scraper',
      data: {
        business_types:            [name],
        search_method:             searchLink ? 'links' : 'city',
        search_links:              searchLink ? [searchLink] : [],
        cities:                    searchLink ? [] : [formatOmkarCity(city, state)],
        countries:                 [],
        states:                    [],
        extraction_method:         'fast',
        max_results:               1,
        // Only enable reviews — no other enrichment needed here
        enable_reviews_extraction: true,
        max_reviews:               10,
        reviews_sort:              'newest',
        // Disable all paid enrichment
        enable_website_contacts:   false,
        enable_emails_social:      false,
        enable_leads:              false,
        enable_sales_summary:      false,
        enable_phone_info:         false,
        enable_photos_extraction:  false,
        enrichment_filters:        ['not_permanently_closed'],
        api_key:                   process.env.OMKAR_API_KEY || '',
        product_description:       'PE intelligence monitoring',
        lang:                      null,
      },
    })

    const allTask = Array.isArray(tasks)
      ? tasks.find(t => t.is_all_task) || tasks[0]
      : tasks

    if (!allTask?.id) return null

    const results = await pollTaskResults(allTask.id)
    if (!results || results.length === 0) return null

    const result = results[0]

    // Calculate response rate from reviews
    const reviews = result.detailed_reviews || []
    const withReply = reviews.filter(r => r.response_from_owner_text !== null && r.response_from_owner_text !== undefined).length
    const responseRate = reviews.length > 0
      ? Math.round((withReply / reviews.length) * 100)
      : null

    return {
      currentCount:  typeof result.reviews === 'number' ? result.reviews : null,
      currentRating: result.rating || null,
      responseRate,
    }

  } catch (err) {
    console.warn(`[ReviewMonitor] Failed to fetch review data for "${name}":`, err.message)
    return null
  }
}

// ── Poll for task completion ───────────────────────────────────────────────

const pollTaskResults = async (taskId, maxWaitMs = 180000) => {
  const pollInterval = 5000
  const startTime    = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const task   = await omkar.getTask(taskId)
      const status = task?.status

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

// ── Helpers ───────────────────────────────────────────────────────────────

const formatOmkarCity = (city, state) => {
  if (!city) return ''
  const c = city.toUpperCase().replace(/\s+/g, '_')
  const s = (state || '').toUpperCase().replace(/\s+/g, '_')
  return `US__${s}__${c}`
}

const delay = (ms) => new Promise(r => setTimeout(r, ms))
