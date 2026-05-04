/**
 * Stage 2 Layer 1 — Rule-Based Pre-Filter
 *
 * Only applies rules that are OBVIOUS and HIGH CONFIDENCE.
 * The goal is to cheaply eliminate clear non-targets before
 * spending API credits on Layer 2 AI classification.
 *
 * Rules here must be near-certain disqualifications — not guesses.
 * When in doubt, pass to Layer 2 rather than disqualify here.
 *
 * Layer 1 catches:
 *   - Known national franchise brands by exact name match
 *   - Businesses with zero reviews (not trading or brand new)
 *   - Businesses with extreme review counts (clearly large corporate)
 *   - Businesses with no name (data quality issue)
 *
 * Layer 1 does NOT catch:
 *   - "Inc." or "LLC" in name — these mean nothing about size
 *   - "National" or "American" in name — could be local business
 *   - Low review counts below arbitrary thresholds
 *   - Any name pattern that could apply to a legitimate LMM business
 */

// ── Known national franchise brands ──────────────────────────────────────
// ONLY include brands that are definitively national franchise systems.
// These are exact brand names — not partial matches, not guesses.
// A business must be one of these specific brands to be disqualified here.

const CONFIRMED_FRANCHISE_BRANDS = new Set([
  // HVAC franchises
  'aire serv',
  'one hour heating & air conditioning',
  'one hour air conditioning & heating',
  'comfort systems usa',
  'service experts heating & air conditioning',
  'service experts',
  'airtron heating & air conditioning',
  'airtron',
  'ars rescue rooter',
  'ars/rescue rooter',
  'four seasons heating and air conditioning',
  'lee company',
  'morris jenkins',

  // Dental franchises
  'aspen dental',
  'heartland dental',
  'pacific dental services',
  'bright now dental',
  'western dental',
  'affordable dentures & implants',
  'comfort dental',
  'clear choice',
  'smile brands',
  'dental care alliance',

  // Pest control franchises
  'terminix',
  'orkin',
  'rentokil',
  'truly nolen',
  'aptive environmental',
  'ehrlich pest control',

  // Plumbing franchises
  'roto-rooter',
  'roto rooter',
  'mr. rooter plumbing',
  'mr rooter',
  'bluefrog plumbing + drain',
  'bluefrog plumbing and drain',
  'mr. plumber',
  'rescue rooter',

  // Landscaping franchises
  'trugreen',
  'tru green',
  'lawn doctor',
  'spring-green lawn care',
  'u.s. lawns',
  'us lawns',

  // Optometry franchises
  'lenscrafters',
  'pearle vision',
  "america's best contacts & eyeglasses",
  'americas best',
  'vision works',
  'visionworks',
  'national vision',
  'for eyes',

  // Vet franchises
  'banfield pet hospital',
  'vca animal hospitals',
  'vca',
  'bluepearl pet hospital',
  'bluepearl',
  'national veterinary associates',
  'thrive pet healthcare',
  'petco',
])

// ── Carrier/manufacturer service centers ─────────────────────────────────
// These are manufacturer-owned service divisions, not independent businesses

const MANUFACTURER_BRANDS = new Set([
  'carrier enterprise',
  'ce (carrier enterprise)',
  'lennox',
  'trane technologies',
  'york',
  'daikin',
  'rheem',
  'goodman',
])

// ── Hard disqualification thresholds ─────────────────────────────────────
// Only values that are clearly outside LMM range with high confidence

const THRESHOLDS = {
  // Zero reviews = not trading, brand new, or unclaimed listing
  // We cannot assess a business with no social proof at all
  absoluteMinReviews: 3,

  // Above this = almost certainly a large corporate chain or franchise
  // 5000+ reviews for a single-location service business is implausible
  absoluteMaxReviews: 5000,
}

// ── Layer 1 Filter ────────────────────────────────────────────────────────

/**
 * Apply only high-confidence rule-based disqualifications.
 * Returns { pass, reason, confidence } where:
 *   pass = true  → proceed to Layer 2 AI classification
 *   pass = false → definitively disqualified, skip Layer 2
 */
export const applyRuleFilter = (business) => {
  const { name, review_count, google_rating, categories } = business
  const nameLower = (name || '').toLowerCase().trim()

  // ── Rule 1: No name — data quality issue ─────────────────────────────
  if (!name || nameLower.length < 2) {
    return fail('no_name', 'Business has no name — data quality issue', 100)
  }

  // ── Rule 2: Exact franchise brand match ───────────────────────────────
  // Check if the business name IS one of the confirmed franchise brands
  // Uses startsWith to catch "Airtron Heating & Air Conditioning" from "airtron"
  const isFranchise = [...CONFIRMED_FRANCHISE_BRANDS].some(brand =>
    nameLower === brand || nameLower.startsWith(brand + ' ') || nameLower.includes(' ' + brand)
  )
  if (isFranchise) {
    return fail('confirmed_franchise', `"${name}" is a confirmed national franchise brand`, 99)
  }

  // ── Rule 3: Manufacturer brand ────────────────────────────────────────
  const isManufacturer = [...MANUFACTURER_BRANDS].some(brand =>
    nameLower === brand || nameLower.startsWith(brand)
  )
  if (isManufacturer) {
    return fail('manufacturer_brand', `"${name}" is a manufacturer service division`, 99)
  }

  // ── Rule 4: Absolutely zero reviews ──────────────────────────────────
  // Not "low reviews" — literally 0-3 reviews means we cannot assess this business
  if (review_count !== null && review_count !== undefined && review_count <= THRESHOLDS.absoluteMinReviews) {
    return fail('no_reviews', `Only ${review_count} reviews — cannot assess business`, 90)
  }

  // ── Rule 5: Extreme review count ─────────────────────────────────────
  // 5000+ reviews for a service business in one city = corporate chain
  // This threshold is conservative — we only reject the truly obvious cases
  if (review_count > THRESHOLDS.absoluteMaxReviews) {
    return fail('clearly_corporate', `${review_count} reviews far exceeds any LMM service business`, 95)
  }

  // ── All rules passed — send to Layer 2 ───────────────────────────────
  return { pass: true, reason: null, confidence: null }
}

// ── Helper ────────────────────────────────────────────────────────────────

const fail = (reason, explanation, confidence) => ({
  pass:        false,
  reason,
  explanation,
  confidence,
})
