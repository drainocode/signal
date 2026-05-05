/**
 * Stage 3 Enrichment — Test Script
 *
 * Tests enrichment on the first 3 qualified businesses.
 * Run with: npm run test:enrichment
 */

import 'dotenv/config'
import { enrichBusiness }                              from './index.js'
import { getBusinessesForEnrichment, getEnrichmentStats } from '../db/enrichmentRepository.js'

console.log('─────────────────────────────────────────')
console.log('Signal Engine — Stage 3 Enrichment Test')
console.log('─────────────────────────────────────────\n')

try {
  // Load qualified businesses
  console.log('Loading qualified businesses...')
  const businesses = await getBusinessesForEnrichment(20) // Test with 20 only
  console.log(`Loaded ${businesses.length} businesses for enrichment\n`)

  if (businesses.length === 0) {
    console.log('No qualified businesses found. Run Stages 1 and 2 first.')
    process.exit(0)
  }

  // Enrich each business
  for (const business of businesses) {
    console.log(`\n${'─'.repeat(50)}`)
    await enrichBusiness(business)
  }

  // Show database stats
  console.log('\n─────────────────────────────────────────')
  console.log('Enrichment Stats:')
  console.log('─────────────────────────────────────────')
  const stats = await getEnrichmentStats()
  console.log(`  Total enriched:      ${stats.total}`)
  console.log(`  Tech gaps detected:  ${stats.techGapDetected}`)
  console.log(`  Has contact form:    ${stats.hasContactForm}`)
  console.log(`  Form auto-reply:     ${stats.formAutoReply}`)
  console.log(`  Running Google Ads:  ${stats.runningGoogleAds}`)
  console.log(`  Running Meta Ads:    ${stats.runningMetaAds}`)

  console.log('\n✓ Stage 3 enrichment test complete')

} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  console.error(err.stack)
  process.exit(1)
}
