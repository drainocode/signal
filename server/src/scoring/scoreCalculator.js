/**
 * Score Calculator
 *
 * Computes a readiness score (1.0 to 10.0) for each qualified business.
 * Higher score = more operationally weak = more PE acquisition upside.
 *
 * Scoring is purely algorithmic — same inputs always produce same score.
 * This ensures consistency and auditability for PE analysts.
 *
 * Five dimensions with weighted contribution:
 *   Tech Gap Score     30% — missing vertical software = manual operations
 *   Hiring Signals     25% — hiring manual roles = paying for what software does
 *   Digital Presence   20% — ads + form + booking = digital maturity
 *   Review Health      15% — response rate + velocity = customer management
 *   Operations Score   10% — form auto-reply + overall efficiency signals
 *
 * Each dimension produces a sub-score 0-10.
 * Final score = weighted sum of sub-scores.
 */

// ── Dimension weights ─────────────────────────────────────────────────────

const WEIGHTS = {
  techGap:       0.30,
  hiring:        0.25,
  digital:       0.20,
  reviewHealth:  0.15,
  operations:    0.10,
}

// ── Main scoring function ─────────────────────────────────────────────────

/**
 * Calculate readiness score for a business.
 *
 * @param {Object} business      - Business record from DB
 * @param {Object} enrichment    - Enrichment data record
 * @param {Array}  signalEvents  - All signal events for this business
 * @param {Object} qualification - Qualification result
 * @returns {Object} Scores per dimension and final weighted score
 */
export const calculateScore = (business, enrichment, signalEvents, qualification) => {
  const signals = signalEvents || []

  // ── Dimension 1: Tech Gap Score (30%) ────────────────────────────────
  // How operationally weak is the tech stack?
  // Source: enrichment_data.tech_stack + enrichment_data.tech_gap_detected

  const techGapScore = scoreTechGap(enrichment)

  // ── Dimension 2: Hiring Signals Score (25%) ──────────────────────────
  // Are they hiring manual roles that software could replace?
  // Source: signal_events where signal_type = hiring_manual_role/hiring_growth_role

  const hiringScore = scoreHiring(signals)

  // ── Dimension 3: Digital Presence Score (20%) ────────────────────────
  // How digitally mature is the business?
  // Source: enrichment_data ads, form, booking fields

  const digitalScore = scoreDigital(enrichment, business)

  // ── Dimension 4: Review Health Score (15%) ───────────────────────────
  // How well are they managing customer relationships?
  // Source: enrichment_data review_response_rate + review_count

  const reviewScore = scoreReviewHealth(enrichment, business)

  // ── Dimension 5: Operations Score (10%) ──────────────────────────────
  // Overall operational efficiency signals
  // Source: form auto-reply + signal events

  const operationsScore = scoreOperations(enrichment, signals)

  // ── Final weighted score ──────────────────────────────────────────────

  const finalScore =
    (techGapScore      * WEIGHTS.techGap)      +
    (hiringScore       * WEIGHTS.hiring)       +
    (digitalScore      * WEIGHTS.digital)      +
    (reviewScore       * WEIGHTS.reviewHealth) +
    (operationsScore   * WEIGHTS.operations)

  // Round to 1 decimal place, clamp between 1.0 and 10.0
  const readinessScore = Math.min(10.0, Math.max(1.0, Math.round(finalScore * 10) / 10))

  return {
    readiness_score:        readinessScore,
    tech_gap_score:         techGapScore,
    hiring_signal_score:    hiringScore,
    digital_presence_score: digitalScore,
    review_health_score:    reviewScore,
    operational_score:      operationsScore,
    score_breakdown: {
      techGap:     { score: techGapScore,    weight: WEIGHTS.techGap,      contribution: techGapScore * WEIGHTS.techGap },
      hiring:      { score: hiringScore,     weight: WEIGHTS.hiring,       contribution: hiringScore * WEIGHTS.hiring },
      digital:     { score: digitalScore,    weight: WEIGHTS.digital,      contribution: digitalScore * WEIGHTS.digital },
      reviews:     { score: reviewScore,     weight: WEIGHTS.reviewHealth, contribution: reviewScore * WEIGHTS.reviewHealth },
      operations:  { score: operationsScore, weight: WEIGHTS.operations,   contribution: operationsScore * WEIGHTS.operations },
    },
  }
}

// ── Dimension scorers ─────────────────────────────────────────────────────

const scoreTechGap = (enrichment) => {
  if (!enrichment) return 8.0 // No enrichment = assume maximum gap

  const techStack   = enrichment.tech_stack || {}
  const missing     = techStack.missing     || []
  const detected    = techStack.detected    || []
  const hasBooking  = techStack.has_booking || false
  const hasChat     = techStack.has_chat    || false

  // Start from maximum gap
  let score = 10.0

  // Each detected tool reduces the gap
  score -= detected.length * 1.5

  // Has booking system — reduces gap significantly
  if (hasBooking) score -= 2.0

  // Has chat widget — minor reduction
  if (hasChat) score -= 0.5

  // Still has many gaps — keep score high
  if (missing.length >= 3) score = Math.max(score, 7.0)
  if (missing.length === 2) score = Math.max(score, 5.0)
  if (missing.length === 1) score = Math.max(score, 3.0)
  if (missing.length === 0) score = Math.min(score, 2.0)

  return Math.min(10.0, Math.max(1.0, Math.round(score * 10) / 10))
}

const scoreHiring = (signals) => {
  const manualRoleSignals  = signals.filter(s => s.signal_type === 'hiring_manual_role')
  const growthRoleSignals  = signals.filter(s => s.signal_type === 'hiring_growth_role')

  if (manualRoleSignals.length === 0 && growthRoleSignals.length === 0) {
    // No hiring signals — could mean stable or just not hiring right now
    // Give a neutral-low score, not maximum
    return 4.0
  }

  let score = 4.0

  // Each manual role signal adds to score — they are paying for what software does
  score += manualRoleSignals.length * 2.0

  // Growth roles are a positive acquisition signal but less urgent
  score += growthRoleSignals.length * 0.5

  // High confidence signals (impact_score >= 8) weighted more
  const highConfidence = manualRoleSignals.filter(s => (s.impact_score || 0) >= 8)
  score += highConfidence.length * 0.5

  return Math.min(10.0, Math.max(1.0, Math.round(score * 10) / 10))
}

const scoreDigital = (enrichment, business) => {
  if (!enrichment) return 8.0 // No enrichment = assume poor digital presence

  const hasGoogleAds  = enrichment.has_google_ads || false
  const hasMetaAds    = enrichment.has_meta_ads    || false
  const hasForm       = enrichment.has_contact_form || false
  const hasWebsite    = !!(business?.website)
  const techStack     = enrichment.tech_stack || {}
  const hasBooking    = techStack.has_booking  || false
  const hasReviewPlat = techStack.has_review_platform || false

  // Score from PE perspective — HIGHER score means MORE gaps/upside
  // A business with no digital presence has more upside for PE to add value
  let score = 8.0

  // Running ads = investing in growth = less digital gap
  if (hasGoogleAds) score -= 2.0
  if (hasMetaAds)   score -= 1.5

  // Has contact form = basic digital capture = less gap
  if (hasForm)    score -= 1.5

  // Has online booking = significant digital maturity = less gap
  if (hasBooking) score -= 2.0

  // Has review management platform = reputation awareness = less gap
  if (hasReviewPlat) score -= 0.5

  // No website at all = maximum digital gap
  if (!hasWebsite) score = 10.0

  return Math.min(10.0, Math.max(1.0, Math.round(score * 10) / 10))
}

const scoreReviewHealth = (enrichment, business) => {
  const reviewResponseRate = enrichment?.review_response_rate ?? null
  const reviewCount        = enrichment?.review_count || business?.review_count || 0

  let score = 5.0 // Neutral default when unknown

  // Review response rate — key indicator of customer management
  if (reviewResponseRate !== null) {
    if (reviewResponseRate < 10)       score = 9.0  // Almost no responses — major gap
    else if (reviewResponseRate < 30)  score = 8.0  // Very poor response rate
    else if (reviewResponseRate < 50)  score = 6.5  // Below average
    else if (reviewResponseRate < 70)  score = 5.0  // Average
    else if (reviewResponseRate < 85)  score = 3.5  // Good
    else                               score = 2.0  // Excellent — minimal gap
  }

  // Review count context — established business with poor response = bigger issue
  if (reviewCount > 200 && reviewResponseRate !== null && reviewResponseRate < 30) {
    score = Math.min(10.0, score + 1.0) // Amplify signal for larger businesses
  }

  // Very low review count = cannot assess customer management
  if (reviewCount < 20) score = Math.max(score, 5.0)

  return Math.min(10.0, Math.max(1.0, Math.round(score * 10) / 10))
}

const scoreOperations = (enrichment, signals) => {
  let score = 5.0

  // No form auto-reply = losing leads = operational gap
  if (enrichment?.has_contact_form && !enrichment?.form_auto_reply) {
    score += 2.0 // Has form but not configured to auto-reply — easy fix with high impact
  }

  if (enrichment?.has_contact_form === false) {
    score += 1.0 // No form at all — worse than having one without auto-reply
  }

  // Ad activity change signals — started or stopped advertising
  const adSignals = signals.filter(s =>
    s.signal_type === 'ad_activity_started' || s.signal_type === 'ad_activity_stopped'
  )
  if (adSignals.length > 0) score += 0.5

  // Executive changes — potential transaction readiness
  const execSignals = signals.filter(s => s.signal_category === 'leadership')
  if (execSignals.length > 0) score += 1.0

  return Math.min(10.0, Math.max(1.0, Math.round(score * 10) / 10))
}
