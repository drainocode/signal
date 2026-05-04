/**
 * Exa Qualification Search
 *
 * Searches the web for signals that help determine if a business
 * is a genuine LMM acquisition target or should be disqualified.
 *
 * Specifically looks for:
 *   - PE portfolio mentions (already acquired)
 *   - Franchise disclosure pages
 *   - Corporate acquisition news
 *   - LinkedIn company page (employee count)
 *   - News articles about the business
 *
 * Uses Exa's semantic search + content retrieval.
 * Cost: ~$0.007 per search. We run 1-2 searches per business.
 */

import Exa from 'exa-js'

const exa = new Exa(process.env.EXA_API_KEY)

const TIMEOUT_MS = 15000

// ── Main qualification search ─────────────────────────────────────────────

/**
 * Search for qualification signals for a business.
 *
 * @param {Object} business - Business record from Stage 1
 * @returns {Promise<Object>} Search results and extracted signals
 */
export const searchForQualificationSignals = async (business) => {
  const { name, city, state, vertical } = business

  if (!name) return { success: false, signals: [], content: '' }

  const locationStr = [city, state].filter(Boolean).join(', ')
  const results = []

  // Search 1: Direct business search — finds PE portfolio pages,
  // news articles, franchise disclosures, LinkedIn
  try {
    const query = `"${name}" ${locationStr} ${vertical}`
    const response = await withTimeout(
      exa.searchAndContents(query, {
        numResults:  5,
        text:        true,
        highlights:  false,
      }),
      TIMEOUT_MS
    )

    if (response?.results) {
      results.push(...response.results)
    }
  } catch (err) {
    console.warn(`[ExaQual] Search failed for "${name}":`, err.message)
  }

  if (results.length === 0) {
    return { success: false, signals: [], content: '' }
  }

  // Extract signals from search results
  const signals = extractSignalsFromResults(results, name)

  // Build content summary for Haiku
  const content = results
    .slice(0, 3)
    .map(r => `Source: ${r.url}\n${(r.text || '').slice(0, 800)}`)
    .join('\n\n---\n\n')

  return {
    success:    true,
    signals,
    content:    content.slice(0, 3000),
    resultUrls: results.map(r => r.url),
  }
}

// ── Extract signals from Exa results ─────────────────────────────────────

const extractSignalsFromResults = (results, businessName) => {
  const signals = []
  const combinedText = results
    .map(r => `${r.url} ${r.title || ''} ${r.text || ''}`)
    .join(' ')
    .toLowerCase()

  const nameLower = businessName.toLowerCase()

  // PE backing signals
  if (/private equity|pe firm|portfolio company|backed by|acquired by|merger|acquisition/i.test(combinedText)) {
    signals.push('pe_or_acquisition_mention')
  }

  // Franchise signals in search results
  if (/franchise|franchisee|franchising/i.test(combinedText)) {
    signals.push('franchise_mention_in_results')
  }

  // LinkedIn found — contains employee count data
  const linkedInResult = results.find(r => r.url?.includes('linkedin.com/company'))
  if (linkedInResult) {
    signals.push('linkedin_found')
    const employeeMatch = (linkedInResult.text || '').match(/(\d+)[–-](\d+)\s+employees/i)
    if (employeeMatch) {
      const minEmployees = parseInt(employeeMatch[1])
      const maxEmployees = parseInt(employeeMatch[2])
      if (maxEmployees > 500)      signals.push('linkedin_large_company')
      else if (minEmployees >= 11) signals.push('linkedin_lmm_size')
      else                         signals.push('linkedin_small_company')
    }
  }

  // Corporate/chain signals
  if (/corporate headquarters|hq|headquartered in|national chain/i.test(combinedText)) {
    signals.push('corporate_hq_mention')
  }

  // Positive owner-operated signals
  if (/family.{0,20}owned|founder|owner.{0,20}operated|locally owned/i.test(combinedText)) {
    signals.push('owner_operated_in_results')
  }

  // Multi-location signals
  const locationMatch = combinedText.match(/(\d+)\s+locations/i)
  if (locationMatch) {
    const count = parseInt(locationMatch[1])
    if (count > 20)     signals.push('many_locations_in_results')
    else if (count > 3) signals.push('few_locations_in_results')
  }

  return signals
}

// ── Timeout wrapper ───────────────────────────────────────────────────────

const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  )
  return Promise.race([promise, timeout])
}
