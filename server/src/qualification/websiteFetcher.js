/**
 * Website Fetcher
 *
 * Fetches homepage and about page content for qualification context.
 * Used in Stage 2 Layer 2 to give Haiku real evidence before classification.
 *
 * Strategy:
 *   1. Try direct HTTP fetch (free, fast)
 *   2. Parse HTML with regex (no heavy dependencies needed here)
 *   3. Extract key qualification signals from text
 *
 * Deliberately lightweight — this runs on every qualified business
 * in Stage 2, so speed and cost matter. Deep enrichment is Stage 3.
 */

const FETCH_TIMEOUT_MS = 8000
const MAX_CONTENT_CHARS = 3000

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

// ── Pages to try fetching ─────────────────────────────────────────────────

const ABOUT_PAGE_PATHS = [
  '/about',
  '/about-us',
  '/about_us',
  '/our-story',
  '/our-company',
  '/who-we-are',
  '/company',
]

// ── Main fetch function ───────────────────────────────────────────────────

/**
 * Fetch website content for qualification purposes.
 * Returns combined text from homepage and about page.
 *
 * @param {string} websiteUrl - Business website URL
 * @returns {Promise<Object>} Fetched content and extracted signals
 */
export const fetchWebsiteForQualification = async (websiteUrl) => {
  if (!websiteUrl) {
    return { success: false, content: '', signals: [] }
  }

  const domain = extractDomain(websiteUrl)
  if (!domain) {
    return { success: false, content: '', signals: [] }
  }

  const pages = []

  // Fetch homepage
  const homepage = await fetchPage(`https://${domain}`)
  if (homepage) {
    pages.push({ url: `https://${domain}`, content: homepage })
  }

  // Try about pages — stop at first success
  for (const path of ABOUT_PAGE_PATHS) {
    const about = await fetchPage(`https://${domain}${path}`)
    if (about && about.length > 200) {
      pages.push({ url: `https://${domain}${path}`, content: about })
      break
    }
  }

  if (pages.length === 0) {
    return { success: false, content: '', signals: [] }
  }

  // Combine content from all pages
  const combined = pages
    .map(p => p.content)
    .join('\n\n')
    .slice(0, MAX_CONTENT_CHARS)

  // Extract qualification signals from text
  const signals = extractQualificationSignals(combined)

  return {
    success: true,
    content: combined,
    signals,
    pagesFound: pages.map(p => p.url),
  }
}

// ── Extract qualification signals from website text ───────────────────────

const extractQualificationSignals = (text) => {
  const lower = text.toLowerCase()
  const signals = []

  // Owner-operated indicators
  if (/family[- ]owned/i.test(text))           signals.push('family_owned_mentioned')
  if (/founded in \d{4}/i.test(text))          signals.push('founding_year_mentioned')
  if (/established in \d{4}/i.test(text))      signals.push('established_year_mentioned')
  if (/since \d{4}/i.test(text))               signals.push('operating_since_mentioned')
  if (/locally owned/i.test(text))             signals.push('locally_owned_mentioned')
  if (/owner[- ]operated/i.test(text))         signals.push('owner_operated_mentioned')
  if (/independently owned/i.test(text))       signals.push('independently_owned_mentioned')

  // Franchise indicators
  if (/franchise/i.test(text))                 signals.push('franchise_mentioned')
  if (/independently owned.*franchise/i.test(text)) signals.push('franchise_unit_mentioned')
  if (/corporate/i.test(text))                 signals.push('corporate_mentioned')

  // Scale indicators — suggest too large
  if (/nationwide/i.test(text))                signals.push('nationwide_mentioned')
  if (/across.*states/i.test(text))            signals.push('multi_state_mentioned')
  if (/\d+\s+locations/i.test(text)) {
    const match = text.match(/(\d+)\s+locations/i)
    if (match) {
      const locationCount = parseInt(match[1])
      if (locationCount > 10) signals.push('many_locations_mentioned')
      else if (locationCount > 1) signals.push('multiple_locations_mentioned')
    }
  }

  // PE/investor indicators
  if (/private equity/i.test(text))            signals.push('pe_mentioned')
  if (/portfolio company/i.test(text))         signals.push('portfolio_mentioned')
  if (/backed by/i.test(text))                 signals.push('backed_by_mentioned')
  if (/acquired by/i.test(text))               signals.push('acquired_mentioned')

  // Size indicators
  if (/\d+\+?\s+employees/i.test(text)) {
    const match = text.match(/(\d+)\+?\s+employees/i)
    if (match) {
      const count = parseInt(match[1])
      if (count > 500) signals.push('large_employee_count')
      else if (count >= 10) signals.push('lmm_employee_count')
      else signals.push('small_employee_count')
    }
  }

  return signals
}

// ── HTTP fetch with timeout ───────────────────────────────────────────────

const fetchPage = async (url) => {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':      USER_AGENT,
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) return null

    const html = await response.text()
    return extractTextFromHtml(html)

  } catch {
    return null
  }
}

// ── Extract clean text from HTML ──────────────────────────────────────────

const extractTextFromHtml = (html) => {
  // Remove script and style tags completely
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text || null
}

// ── Extract domain from URL ───────────────────────────────────────────────

const extractDomain = (url) => {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
