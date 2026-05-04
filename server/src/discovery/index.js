/**
 * Stage 1: Discovery Orchestrator
 *
 * Coordinates all discovery sources:
 *   Primary:   Omkar Google Maps (physical service businesses)
 *   Secondary: Puppeteer directory scraper (state boards, BBB, associations)
 *   Tertiary:  Exa semantic search (professional services like CPA, consulting)
 *
 * Runs on a weekly schedule via the scheduler.
 * Results are stored in Supabase and passed to Stage 2 qualification.
 *
 * Scope is controlled by vertical + region config — never runs everything
 * at once to avoid runaway costs.
 */

import { discoverBusinesses, TARGET_CITIES, VERTICAL_SEARCH_TERMS } from './omkarClient.js'
import { saveDiscoveredBusinesses } from '../db/discoveryRepository.js'

// ── Default run config ────────────────────────────────────────────────────
// Controls scope of each weekly sweep.
// Start narrow — two verticals, one region — then expand as system proves out.

const DEFAULT_CONFIG = {
  verticals: ['hvac', 'dental'],
  regions: ['texas'],       // Start with Texas — high density of LMM targets
  maxResultsPerSearch: 50,  // Per search term per city
  delayBetweenCities: 10000, // 10s between cities to be respectful
  delayBetweenVerticals: 30000, // 30s between verticals
}

// ── Run state ─────────────────────────────────────────────────────────────

let isRunning = false

// ── Main discovery run ────────────────────────────────────────────────────

export const runDiscovery = async (config = {}) => {
  if (isRunning) {
    console.log('[Discovery] Already running — skipping this trigger')
    return
  }

  isRunning = true
  const startTime = Date.now()

  const {
    verticals,
    regions,
    maxResultsPerSearch,
    delayBetweenCities,
    delayBetweenVerticals,
  } = { ...DEFAULT_CONFIG, ...config }

  console.log(`
[Discovery] ─────────────────────────────────────────
[Discovery] Stage 1 starting
[Discovery] Verticals: ${verticals.join(', ')}
[Discovery] Regions:   ${regions.join(', ')}
[Discovery] ─────────────────────────────────────────
  `)

  const totalStats = {
    discovered: 0,
    saved: 0,
    duplicates: 0,
    errors: 0,
  }

  try {
    for (const vertical of verticals) {
      console.log(`[Discovery] Starting vertical: ${vertical}`)

      for (const region of regions) {
        const cities = TARGET_CITIES[region]
        if (!cities || cities.length === 0) {
          console.warn(`[Discovery] No cities found for region: ${region}`)
          continue
        }

        console.log(`[Discovery] Region: ${region} — ${cities.length} cities`)

        for (const city of cities) {
          try {
            // Primary source: Omkar Google Maps
            const businesses = await discoverBusinesses({
              vertical,
              city,
              maxResults: maxResultsPerSearch,
            })

            totalStats.discovered += businesses.length

            if (businesses.length > 0) {
              // Save to database — deduplication happens inside
              const saveStats = await saveDiscoveredBusinesses(businesses)
              totalStats.saved += saveStats.created
              totalStats.duplicates += saveStats.duplicates
              totalStats.errors += saveStats.errors

              console.log(`[Discovery] ${city}/${vertical}: ${businesses.length} found → ${saveStats.created} new, ${saveStats.duplicates} dupes`)
            }

            await delay(delayBetweenCities)

          } catch (err) {
            console.error(`[Discovery] Error on ${city}/${vertical}:`, err.message)
            totalStats.errors++
          }
        }
      }

      await delay(delayBetweenVerticals)
    }

  } finally {
    isRunning = false
  }

  const duration = Math.round((Date.now() - startTime) / 1000 / 60)

  console.log(`
[Discovery] ─────────────────────────────────────────
[Discovery] Run complete in ${duration} minutes
[Discovery] Discovered: ${totalStats.discovered}
[Discovery] Saved:      ${totalStats.saved}
[Discovery] Duplicates: ${totalStats.duplicates}
[Discovery] Errors:     ${totalStats.errors}
[Discovery] ─────────────────────────────────────────
  `)

  return totalStats
}

// ── Test run — single vertical, single city ───────────────────────────────
// Use this to verify discovery is working before running full sweep.
// Example: runDiscoveryTest({ vertical: 'hvac', city: 'US__TEXAS__DALLAS' })

export const runDiscoveryTest = async ({
  vertical = 'hvac',
  city = 'US__TEXAS__DALLAS',
  maxResults = 10,
} = {}) => {
  console.log(`[Discovery] Test run: ${vertical} in ${city}`)

  const businesses = await discoverBusinesses({ vertical, city, maxResults })

  console.log(`[Discovery] Test complete — ${businesses.length} businesses found`)
  console.log('[Discovery] Sample result:', JSON.stringify(businesses[0], null, 2))

  return businesses
}

// ── Helpers ───────────────────────────────────────────────────────────────

const delay = (ms) => new Promise(r => setTimeout(r, ms))
