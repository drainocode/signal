/**
 * Stage 4 Signal Monitoring — Test Script
 *
 * Tests all signal monitors on enriched businesses.
 * Run with: npm run test:signals
 */

import 'dotenv/config'
import { runSignalMonitoring }  from './index.js'
import { getSignalStats }       from '../db/signalRepository.js'

console.log('─────────────────────────────────────────')
console.log('Signal Engine — Stage 4 Signal Monitoring Test')
console.log('─────────────────────────────────────────\n')

try {
  // Run all monitors on first 3 enriched businesses
  console.log('Running signal monitors...')
  console.log('(This checks hiring, ads, reviews, and exec changes)\n')

  const stats = await runSignalMonitoring({ limit: 20, monitors: 'all' })

  console.log('\n─────────────────────────────────────────')
  console.log('Signal Monitoring Results:')
  console.log('─────────────────────────────────────────')
  console.log(`  Businesses monitored: ${stats.businesses}`)
  console.log(`  Signals detected:     ${stats.signals}`)
  console.log(`  Errors:               ${stats.errors}`)

  // Show database stats
  console.log('\nDatabase signal stats:')
  const dbStats = await getSignalStats()
  console.log(`  Total signals:   ${dbStats.total}`)
  console.log(`  By type:`, dbStats.byType)
  console.log(`  By category:`, dbStats.byCategory)
  console.log(`  By severity:`, dbStats.bySeverity)

  console.log('\n✓ Stage 4 signal monitoring test complete')

} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  console.error(err.stack)
  process.exit(1)
}
