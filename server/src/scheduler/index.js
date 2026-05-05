/**
 * Signal Intelligence Engine — Scheduler
 *
 * Cron jobs that run the full pipeline automatically on Railway.
 * Uses node-cron for scheduling.
 *
 * Schedule:
 *   Weekly Sunday 2am UTC  — Full discovery sweep (new businesses)
 *   Weekly Sunday 4am UTC  — Qualification of newly discovered businesses
 *   Weekly Sunday 6am UTC  — Enrichment of newly qualified businesses
 *   Daily   1am UTC        — Signal monitoring (hiring, ads, reviews, execs)
 *   Daily   2am UTC        — Scoring refresh after signal monitoring
 *
 * All jobs run sequentially with delays to avoid hammering Omkar VPS
 * and external APIs simultaneously.
 *
 * Jobs are designed to be idempotent — running them twice has no
 * negative effect (deduplication handles repeated discoveries,
 * upserts handle repeated enrichment and scoring).
 */

import cron from 'node-cron'
import { runDiscovery }       from '../discovery/index.js'
import { runQualification }   from '../qualification/index.js'
import { runEnrichment }      from '../enrichment/index.js'
import { runSignalMonitoring } from '../signals/index.js'
import { runScoring }         from '../scoring/index.js'

// ── Track running state ───────────────────────────────────────────────────

const state = {
  discoveryRunning:    false,
  qualificationRunning: false,
  enrichmentRunning:   false,
  signalRunning:       false,
  scoringRunning:      false,
  lastRun: {
    discovery:    null,
    qualification: null,
    enrichment:   null,
    signals:      null,
    scoring:      null,
  },
}

// ── Job runner with error handling ────────────────────────────────────────

const runJob = async (name, stateKey, fn, config = {}) => {
  if (state[stateKey]) {
    console.log(`[Scheduler] ${name} already running — skipping`)
    return
  }

  state[stateKey] = true
  const startTime = Date.now()
  console.log(`\n[Scheduler] ─────────────────────────────────`)
  console.log(`[Scheduler] Starting: ${name}`)
  console.log(`[Scheduler] Time: ${new Date().toISOString()}`)
  console.log(`[Scheduler] ─────────────────────────────────`)

  try {
    const result = await fn(config)
    state.lastRun[stateKey.replace('Running', '')] = new Date().toISOString()
    const duration = Math.round((Date.now() - startTime) / 1000)
    console.log(`[Scheduler] ✓ ${name} completed in ${duration}s`)
    console.log(`[Scheduler] Result:`, JSON.stringify(result, null, 2))
  } catch (err) {
    console.error(`[Scheduler] ✗ ${name} failed:`, err.message)
    console.error(err.stack)
  } finally {
    state[stateKey] = false
  }
}

// ── Weekly: Full discovery sweep ──────────────────────────────────────────
// Runs Sunday at 2am UTC
// Discovers new businesses across configured verticals and regions

cron.schedule('0 2 * * 0', async () => {
  await runJob(
    'Weekly Discovery',
    'discoveryRunning',
    runDiscovery,
    {
      verticals:   ['hvac', 'dental'],
      regions:     ['texas', 'southeast'],
      maxResultsPerSearch: 50,
    }
  )
}, { timezone: 'UTC' })

// ── Weekly: Qualification of new discoveries ──────────────────────────────
// Runs Sunday at 4am UTC (2 hours after discovery)

cron.schedule('0 4 * * 0', async () => {
  await runJob(
    'Weekly Qualification',
    'qualificationRunning',
    runQualification,
    { limit: 500 }
  )
}, { timezone: 'UTC' })

// ── Weekly: Enrichment of newly qualified businesses ──────────────────────
// Runs Sunday at 6am UTC (2 hours after qualification)

cron.schedule('0 6 * * 0', async () => {
  await runJob(
    'Weekly Enrichment',
    'enrichmentRunning',
    runEnrichment,
    { limit: 100 }
  )
}, { timezone: 'UTC' })

// ── Daily: Signal monitoring ──────────────────────────────────────────────
// Runs every day at 1am UTC
// Checks hiring, ads, reviews, and exec changes for all enriched businesses

cron.schedule('0 1 * * *', async () => {
  await runJob(
    'Daily Signal Monitoring',
    'signalRunning',
    runSignalMonitoring,
    { limit: 200, monitors: 'weekly' }
  )
}, { timezone: 'UTC' })

// ── Daily: Scoring refresh ────────────────────────────────────────────────
// Runs every day at 2am UTC (1 hour after signal monitoring)
// Recomputes scores with latest signal data

cron.schedule('0 2 * * *', async () => {
  await runJob(
    'Daily Scoring Refresh',
    'scoringRunning',
    runScoring,
    { limit: 200 }
  )
}, { timezone: 'UTC' })

// ── Monthly: Executive monitoring ────────────────────────────────────────
// Runs first day of each month at 3am UTC
// Checks for leadership changes — less frequent since exec changes are rare

cron.schedule('0 3 1 * *', async () => {
  await runJob(
    'Monthly Executive Monitoring',
    'signalRunning',
    runSignalMonitoring,
    { limit: 200, monitors: 'monthly' }
  )
}, { timezone: 'UTC' })

// ── Status endpoint data ──────────────────────────────────────────────────

export const getSchedulerStatus = () => ({
  jobs: {
    discovery:    { running: state.discoveryRunning,    lastRun: state.lastRun.discovery,    schedule: 'Sunday 2am UTC' },
    qualification: { running: state.qualificationRunning, lastRun: state.lastRun.qualification, schedule: 'Sunday 4am UTC' },
    enrichment:   { running: state.enrichmentRunning,   lastRun: state.lastRun.enrichment,   schedule: 'Sunday 6am UTC' },
    signals:      { running: state.signalRunning,       lastRun: state.lastRun.signals,      schedule: 'Daily 1am UTC' },
    scoring:      { running: state.scoringRunning,      lastRun: state.lastRun.scoring,      schedule: 'Daily 2am UTC' },
  },
})

console.log('[Scheduler] All cron jobs registered')
console.log('[Scheduler] Schedule:')
console.log('  Discovery:    Sunday 2am UTC (weekly)')
console.log('  Qualification: Sunday 4am UTC (weekly)')
console.log('  Enrichment:   Sunday 6am UTC (weekly)')
console.log('  Signals:      Daily 1am UTC')
console.log('  Scoring:      Daily 2am UTC')
console.log('  Exec monitor: 1st of month 3am UTC')
