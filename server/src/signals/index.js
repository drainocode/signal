/**
 * Stage 4: Signal Monitoring Orchestrator
 *
 * Runs all signal monitors on enriched businesses on a schedule.
 * Each monitor checks for changes and emits signal events.
 *
 * Schedule:
 *   Weekly:  hiring, review velocity, ad activity
 *   Monthly: executive changes, website diff, social activity
 *
 * The orchestrator decides which monitors to run based on
 * when each business was last checked.
 */

import { checkHiringActivity }    from './hiringMonitor.js'
import { checkReviewChanges }     from './reviewMonitor.js'
import { checkAdChanges }         from './adMonitor.js'
import { checkExecutiveChanges }  from './executiveMonitor.js'
import { saveSignalEvents, getBusinessesForMonitoring, getSignalStats } from '../db/signalRepository.js'

// ── Run all signal monitors ───────────────────────────────────────────────

export const runSignalMonitoring = async ({ limit = 50, monitors = 'all' } = {}) => {
  console.log('[SignalMonitor] Starting Stage 4...')

  const businesses = await getBusinessesForMonitoring(limit)
  console.log(`[SignalMonitor] ${businesses.length} businesses to monitor`)

  if (businesses.length === 0) return { signals: 0, businesses: 0 }

  const stats = { businesses: businesses.length, signals: 0, errors: 0 }

  for (const business of businesses) {
    try {
      const enrichmentData = business.enrichment_data?.[0] || null
      const businessSignals = []

      console.log(`\n[SignalMonitor] Checking: "${business.name}"`)

      // Weekly monitors
      if (monitors === 'all' || monitors === 'weekly') {

        // Hiring signals
        try {
          const hiringSignals = await checkHiringActivity(business)
          businessSignals.push(...hiringSignals)
          console.log(`  Hiring:   ${hiringSignals.length} signals`)
        } catch (err) {
          console.warn(`  Hiring failed: ${err.message}`)
        }

        // Ad activity changes
        if (enrichmentData) {
          try {
            const adSignals = await checkAdChanges(business, enrichmentData)
            businessSignals.push(...adSignals)
            console.log(`  Ads:      ${adSignals.length} signals`)
          } catch (err) {
            console.warn(`  Ads failed: ${err.message}`)
          }
        }

        // Review changes
        if (enrichmentData) {
          try {
            const reviewSignals = await checkReviewChanges(business, enrichmentData)
            businessSignals.push(...reviewSignals)
            console.log(`  Reviews:  ${reviewSignals.length} signals`)
          } catch (err) {
            console.warn(`  Reviews failed: ${err.message}`)
          }
        }
      }

      // Monthly monitors
      if (monitors === 'all' || monitors === 'monthly') {

        // Executive changes
        try {
          const execSignals = await checkExecutiveChanges(business)
          businessSignals.push(...execSignals)
          console.log(`  Execs:    ${execSignals.length} signals`)
        } catch (err) {
          console.warn(`  Exec monitor failed: ${err.message}`)
        }
      }

      // Save all signals for this business
      if (businessSignals.length > 0) {
        const saveResult = await saveSignalEvents(businessSignals)
        stats.signals += saveResult.saved
        console.log(`  Saved:    ${saveResult.saved} signals`)
      }

      await delay(3000)

    } catch (err) {
      console.error(`[SignalMonitor] Error for "${business.name}":`, err.message)
      stats.errors++
    }
  }

  console.log(`\n[SignalMonitor] Complete — ${stats.signals} signals across ${stats.businesses} businesses`)
  return stats
}

const delay = (ms) => new Promise(r => setTimeout(r, ms))
