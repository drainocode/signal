/**
 * Stage 5: Readiness Scoring Orchestrator
 *
 * Computes readiness scores for all enriched businesses.
 *
 * Flow per business:
 *   1. Load enrichment data, signal events, qualification result
 *   2. Calculate algorithmic score across 5 dimensions
 *   3. Calculate benchmark percentile vs peers in same vertical/region
 *   4. Generate one-sentence score rationale via Claude Haiku
 *   5. Save to readiness_scores table
 *
 * Runs after Stage 4 signal monitoring completes.
 * Re-runs weekly after each signal monitoring run to keep scores current.
 */

import Anthropic from '@anthropic-ai/sdk'
import { calculateScore }                        from './scoreCalculator.js'
import { calculatePercentile, buildBenchmarkStats, buildBenchmarkNarrative, classifyTier } from './benchmarkEngine.js'
import { saveReadinessScore, getBusinessesForScoring, getScoresForBenchmark, getScoringStats } from '../db/scoringRepository.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Run scoring for all enriched businesses ───────────────────────────────

export const runScoring = async ({ limit = 100 } = {}) => {
  console.log('[Scoring] Starting Stage 5...')

  const businesses = await getBusinessesForScoring(limit)
  console.log(`[Scoring] ${businesses.length} businesses to score`)

  if (businesses.length === 0) return { scored: 0, errors: 0 }

  const stats = { scored: 0, errors: 0 }

  // Score all businesses first (algorithmic — fast)
  const scoredBusinesses = []
  for (const business of businesses) {
    try {
      const scores = calculateScore(
        business,
        business.enrichment,
        business.signals,
        business.qualification,
      )
      scoredBusinesses.push({ business, scores })
    } catch (err) {
      console.error(`[Scoring] Score calculation failed for "${business.name}":`, err.message)
      stats.errors++
    }
  }

  // Calculate benchmarks across the scored group
  const allScores = scoredBusinesses.map(s => s.scores.readiness_score)

  // Save each score with benchmark and Haiku rationale
  for (const { business, scores } of scoredBusinesses) {
    try {
      // Benchmark percentile within vertical + region peer group
      const peerScores = scoredBusinesses
        .filter(s =>
          s.business.vertical === business.vertical &&
          s.business.state    === business.state &&
          s.business.id       !== business.id
        )
        .map(s => s.scores.readiness_score)

      // Include self in peer group for percentile calculation
      const fullPeerGroup = [...peerScores, scores.readiness_score]
      const percentile    = calculatePercentile(scores.readiness_score, fullPeerGroup)
      const benchStats    = buildBenchmarkStats(fullPeerGroup)
      const tier          = classifyTier(percentile)

      // Generate Haiku rationale
      const rationale = await generateRationale(business, scores, percentile, tier)

      // Save to database
      await saveReadinessScore(business.id, {
        ...scores,
        benchmark_percentile:    percentile,
        benchmark_vertical:      business.vertical,
        benchmark_region:        business.state || business.city,
        benchmark_company_count: fullPeerGroup.length,
        score_rationale:         rationale,
      })

      console.log(`[Scoring] ✓ "${business.name}" — ${scores.readiness_score}/10 (${percentile ?? 'n/a'}th percentile) — ${tier}`)
      console.log(`  Rationale: ${rationale}`)

      stats.scored++

    } catch (err) {
      console.error(`[Scoring] Failed to save score for "${business.name}":`, err.message)
      stats.errors++
    }
  }

  console.log(`\n[Scoring] Complete — scored: ${stats.scored}, errors: ${stats.errors}`)
  return stats
}

// ── Generate Haiku score rationale ───────────────────────────────────────

const generateRationale = async (business, scores, percentile, tier) => {
  const {
    readiness_score,
    tech_gap_score,
    hiring_signal_score,
    digital_presence_score,
    review_health_score,
    operational_score,
    score_breakdown,
  } = scores

  // Find the dominant scoring factor
  const dimensions = [
    { name: 'tech stack gaps',       score: tech_gap_score,         weight: 0.30 },
    { name: 'manual hiring activity', score: hiring_signal_score,    weight: 0.25 },
    { name: 'digital presence gaps', score: digital_presence_score,  weight: 0.20 },
    { name: 'review management gaps', score: review_health_score,    weight: 0.15 },
    { name: 'operational gaps',       score: operational_score,      weight: 0.10 },
  ]

  const topFactor = dimensions.sort((a, b) =>
    (b.score * b.weight) - (a.score * a.weight)
  )[0]

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role:    'user',
        content: `You are a PE acquisition analyst writing a one-sentence score rationale.

Business: ${business.name}
Vertical: ${business.vertical}
Location: ${business.city || ''}, ${business.state || ''}
Readiness Score: ${readiness_score}/10
Percentile: ${percentile !== null ? `${percentile}th` : 'unranked'} among ${business.vertical} peers
Tier: ${tier}

Score breakdown (IMPORTANT: higher score = LARGER gap = MORE PE upside, not better performance):
- Tech gap: ${tech_gap_score}/10 — ${tech_gap_score >= 7 ? 'missing critical vertical software' : tech_gap_score >= 5 ? 'partial tech stack' : 'reasonably equipped'}
- Hiring signals: ${hiring_signal_score}/10 — ${hiring_signal_score >= 7 ? 'actively hiring manual roles software could replace' : hiring_signal_score >= 5 ? 'some manual hiring detected' : 'no manual hiring signals'}
- Digital presence: ${digital_presence_score}/10 — ${digital_presence_score >= 7 ? 'weak digital presence, no ads or booking system' : digital_presence_score >= 5 ? 'partial digital presence' : 'strong digital presence already'}
- Review health: ${review_health_score}/10 — ${review_health_score >= 7 ? 'poor review response rate, customer management gap' : review_health_score >= 5 ? 'average review management' : 'actively managing customer reviews'}
- Operations: ${operational_score}/10 — ${operational_score >= 7 ? 'missing auto-reply and operational tools' : 'operational systems reasonably configured'}

Primary gap driver: ${topFactor.name} (${topFactor.score}/10)

Write ONE sentence for a PE analyst explaining why this business scored ${readiness_score}/10 and what that means for acquisition interest. Be specific. Reference the primary driver. Do not use generic phrases like "shows potential".

Return only the sentence, no JSON, no preamble.`
      }],
    })

    return response.content[0]?.text?.trim() || buildFallbackRationale(business, scores, topFactor)

  } catch {
    return buildFallbackRationale(business, scores, topFactor)
  }
}

// ── Fallback rationale if Haiku fails ────────────────────────────────────

const buildFallbackRationale = (business, scores, topFactor) => {
  const { readiness_score } = scores
  const tier = readiness_score >= 7 ? 'high-priority' : readiness_score >= 5 ? 'moderate' : 'lower-priority'
  return `${business.name} scores ${readiness_score}/10 — a ${tier} acquisition target driven primarily by ${topFactor.name} (${topFactor.score}/10).`
}
