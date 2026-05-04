/**
 * Stage 2 Qualification — Test Script (Two-Layer System)
 *
 * Tests both layers:
 *   Layer 1 — Rule filter catches obvious disqualifications
 *   Layer 2 — Website fetch + Exa search + Claude Haiku for the rest
 *
 * Run with: npm run test:qualification
 */

import 'dotenv/config'
import { qualifyBatch }                                    from './index.js'
import { saveQualificationResults, getQualificationStats } from '../db/qualificationRepository.js'
import { getUnqualifiedBusinesses }                        from '../db/discoveryRepository.js'

console.log('─────────────────────────────────────────')
console.log('Signal Engine — Stage 2 Qualification Test')
console.log('Two-Layer System: Rules + AI')
console.log('─────────────────────────────────────────\n')

try {
  // Load discovered businesses
  console.log('Loading businesses from database...')
  const businesses = await getUnqualifiedBusinesses(100)
  console.log(`Loaded ${businesses.length} businesses\n`)

  if (businesses.length === 0) {
    console.log('No businesses to qualify. Run Stage 1 first.')
    process.exit(0)
  }

  // Run two-layer qualification
  console.log('Running two-layer qualification...')
  console.log('(Layer 2 fetches websites and searches Exa — this takes 1-2 minutes)\n')

  const { results, stats } = await qualifyBatch(businesses)

  // Print summary
  console.log('\n─────────────────────────────────────────')
  console.log('Qualification Summary')
  console.log('─────────────────────────────────────────')
  console.log(`Total:           ${stats.total}`)
  console.log(`Qualified:       ${stats.qualified}`)
  console.log(`Disqualified:    ${stats.disqualified}`)
  console.log(`Pass rate:       ${Math.round((stats.qualified / stats.total) * 100)}%`)
  console.log(`Layer 1 caught:  ${stats.layer1Caught}`)
  console.log(`Layer 2 caught:  ${stats.layer2Caught}`)
  console.log(`Errors:          ${stats.errors}`)

  if (Object.keys(stats.reasons).length > 0) {
    console.log('\nDisqualification reasons:')
    for (const [reason, count] of Object.entries(stats.reasons)) {
      console.log(`  ${reason}: ${count}`)
    }
  }

  // Print qualified businesses with AI verdict
  const qualified = results.filter(r => r.is_qualified)
  console.log('\n─────────────────────────────────────────')
  console.log(`Qualified LMM Targets (${qualified.length}):`)
  console.log('─────────────────────────────────────────')
  for (const r of qualified) {
    console.log(`\n✓ ${r.business_name}`)
    console.log(`  Confidence:   ${r.qualification_score}%`)
    console.log(`  Layer:        ${r.layer}`)
    console.log(`  Employees:    ${r.estimated_employee_range || 'unknown'}`)
    console.log(`  Owner-op:     ${r.owner_operated_likelihood || 'unknown'}`)
    console.log(`  Key evidence: ${r.key_evidence || 'none'}`)
    console.log(`  Reason:       ${r.explanation || 'passed rules'}`)
  }

  // Print disqualified businesses
  const disqualified = results.filter(r => !r.is_qualified)
  console.log('\n─────────────────────────────────────────')
  console.log(`Disqualified (${disqualified.length}):`)
  console.log('─────────────────────────────────────────')
  for (const r of disqualified) {
    console.log(`✗ ${r.business_name}`)
    console.log(`  Reason: ${r.disqualification_reason} — ${r.explanation}`)
    console.log(`  Layer:  ${r.layer}`)
  }

  // Save to database
  console.log('\nSaving results to database...')
  const saveStats = await saveQualificationResults(results)
  console.log(`  Saved:  ${saveStats.saved}`)
  console.log(`  Errors: ${saveStats.errors}`)

  // Verify
  console.log('\nDatabase verification...')
  const dbStats = await getQualificationStats()
  console.log(`  Qualified:    ${dbStats.qualified}`)
  console.log(`  Disqualified: ${dbStats.disqualified}`)
  console.log(`  Avg score:    ${dbStats.avgScore}%`)

  console.log('\n✓ Stage 2 two-layer qualification complete')

} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  console.error(err.stack)
  process.exit(1)
}
