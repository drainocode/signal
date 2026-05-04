/**
 * Stage 5 Scoring — Test Script
 * Run with: npm run test:scoring
 */

import 'dotenv/config'
import { runScoring }      from './index.js'
import { getScoringStats } from '../db/scoringRepository.js'

console.log('─────────────────────────────────────────')
console.log('Signal Engine — Stage 5 Readiness Scoring')
console.log('─────────────────────────────────────────\n')

try {
  const stats = await runScoring({ limit: 20 })

  console.log('\n─────────────────────────────────────────')
  console.log('Scoring Results:')
  console.log('─────────────────────────────────────────')
  console.log(`  Scored:  ${stats.scored}`)
  console.log(`  Errors:  ${stats.errors}`)

  const dbStats = await getScoringStats()
  console.log(`\nDatabase scoring stats:`)
  console.log(`  Total scored:   ${dbStats.total}`)
  console.log(`  Average score:  ${dbStats.avgScore}/10`)
  console.log(`\nTop 5 PE targets:`)
  for (const t of dbStats.topTargets) {
    console.log(`  ${t.score}/10 — ${t.rationale}`)
  }

  console.log('\n✓ Stage 5 scoring complete')

} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  console.error(err.stack)
  process.exit(1)
}
