/**
 * Stage 1 Discovery — Test Script
 *
 * Tests the full discovery pipeline end to end:
 *   1. Connects to Omkar on VPS
 *   2. Searches for HVAC businesses in Dallas
 *   3. Saves results to Supabase
 *   4. Prints stats
 *
 * Run with: npm run test:discovery
 */

import 'dotenv/config'
import { discoverBusinesses } from './omkarClient.js'
import { saveDiscoveredBusinesses, getDiscoveryStats } from '../db/discoveryRepository.js'

console.log('─────────────────────────────────────────')
console.log('Signal Engine — Stage 1 Discovery Test')
console.log('─────────────────────────────────────────')
console.log('Vertical: hvac')
console.log('City:     Dallas, TX')
console.log('Max:      10 results')
console.log('─────────────────────────────────────────\n')

try {
  // Step 1: Discover businesses via Omkar
  const businesses = await discoverBusinesses({
    vertical:   'hvac',
    city:       'US__TEXAS__DALLAS',
    maxResults: 10,
  })

  console.log('\n─────────────────────────────────────────')
  console.log(`Businesses found: ${businesses.length}`)
  console.log('─────────────────────────────────────────')

  if (businesses.length > 0) {
    console.log('\nSample business:')
    const sample = businesses[0]
    console.log(`  Name:    ${sample.name}`)
    console.log(`  Website: ${sample.website || 'none'}`)
    console.log(`  Phone:   ${sample.phone || 'none'}`)
    console.log(`  Rating:  ${sample.google_rating || 'none'}`)
    console.log(`  Reviews: ${sample.review_count}`)
    console.log(`  Ads:     ${sample.is_spending_on_ads}`)
    console.log(`  Source:  ${sample.source}`)
  }

  // Step 2: Save to Supabase
  console.log('\nSaving to database...')
  const saveStats = await saveDiscoveredBusinesses(businesses)
  console.log(`  Created:    ${saveStats.created}`)
  console.log(`  Duplicates: ${saveStats.duplicates}`)
  console.log(`  Errors:     ${saveStats.errors}`)

  // Step 3: Verify in database
  console.log('\nVerifying database...')
  const stats = await getDiscoveryStats()
  console.log(`  Total businesses: ${stats.total}`)
  console.log(`  By status:`, stats.byStatus)
  console.log(`  By vertical:`, stats.byVertical)

  console.log('\n✓ Stage 1 test complete — pipeline is working')

} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  console.error(err.stack)
  process.exit(1)
}
