/**
 * Benchmark Engine
 *
 * Compares each business against peers in the same vertical and region.
 * Produces a percentile rank — where does this business sit among its peers?
 *
 * Higher percentile = more PE-attractive (more operational weakness = more upside)
 *
 * Example output for a PE analyst dashboard:
 *   "Kirkland Heating & Air is in the 78th percentile for operational weakness
 *    among HVAC businesses in Texas — more attractive than 78% of peers."
 *
 * Benchmark groups are defined by vertical + region.
 * Minimum group size of 3 businesses needed for meaningful benchmarking.
 */

// ── Calculate percentile rank within a peer group ─────────────────────────

/**
 * Given a business score and an array of all peer scores,
 * calculate what percentile this score falls in.
 * Higher percentile = higher score = more PE upside.
 *
 * @param {number} score      - This business's readiness score
 * @param {number[]} peerScores - All peer scores in same vertical + region
 * @returns {number} Percentile 0-100
 */
export const calculatePercentile = (score, peerScores) => {
  if (!peerScores || peerScores.length === 0) return null
  if (peerScores.length < 3) return null // Not enough peers for meaningful benchmark

  const below = peerScores.filter(s => s < score).length
  const percentile = Math.round((below / peerScores.length) * 100)
  return percentile
}

// ── Build benchmark stats for a peer group ────────────────────────────────

/**
 * Calculate summary statistics for a peer group.
 * Used to display context on the benchmark report screen.
 *
 * @param {number[]} scores - All scores in the peer group
 * @returns {Object} Stats: min, max, median, average, count
 */
export const buildBenchmarkStats = (scores) => {
  if (!scores || scores.length === 0) return null

  const sorted  = [...scores].sort((a, b) => a - b)
  const count   = sorted.length
  const min     = sorted[0]
  const max     = sorted[count - 1]
  const average = Math.round((scores.reduce((a, b) => a + b, 0) / count) * 10) / 10
  const median  = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)]

  return {
    count,
    min,
    max,
    average,
    median: Math.round(median * 10) / 10,
    top25Threshold:  sorted[Math.floor(count * 0.75)] || max,
    bottom25Threshold: sorted[Math.floor(count * 0.25)] || min,
  }
}

// ── Classify business tier based on percentile ────────────────────────────

/**
 * Assign a tier label for quick PE analyst reference.
 *
 * @param {number} percentile - 0-100
 * @returns {string} Tier label
 */
export const classifyTier = (percentile) => {
  if (percentile === null) return 'unranked'
  if (percentile >= 80)   return 'prime_target'     // Top 20% — highest PE upside
  if (percentile >= 60)   return 'strong_candidate' // Top 40%
  if (percentile >= 40)   return 'moderate_target'  // Middle
  if (percentile >= 20)   return 'lower_priority'   // Bottom 40%
  return 'not_recommended'                           // Bottom 20% — too mature or too small
}

// ── Generate benchmark narrative ─────────────────────────────────────────

/**
 * Build a human-readable benchmark statement for the dashboard.
 *
 * @param {string} businessName
 * @param {number} percentile
 * @param {string} vertical
 * @param {string} region
 * @param {Object} stats - Peer group stats
 * @returns {string}
 */
export const buildBenchmarkNarrative = (businessName, percentile, vertical, region, stats) => {
  if (percentile === null || !stats) {
    return `Insufficient peer data to benchmark ${businessName} — fewer than 3 comparable businesses in ${vertical} / ${region}.`
  }

  const tier = classifyTier(percentile)

  const tierPhrases = {
    prime_target:      'is among the most operationally underdeveloped',
    strong_candidate:  'shows significant operational gaps',
    moderate_target:   'shows moderate operational gaps',
    lower_priority:    'is relatively well-operated',
    not_recommended:   'is among the most operationally mature',
    unranked:          'cannot be benchmarked',
  }

  const phrase   = tierPhrases[tier] || 'has average operational maturity'
  const vertical_label = vertical.replace(/_/g, ' ')

  return `${businessName} ${phrase} among ${stats.count} ${vertical_label} businesses in ${region} — more attractive than ${percentile}% of peers (avg peer score: ${stats.average}/10).`
}
