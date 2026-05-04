/**
 * Website Enricher
 *
 * Fetches full website content for Stage 3 enrichment.
 * More thorough than the Stage 2 qualification fetch —
 * here we extract emails, phones, addresses, and pass
 * HTML to the tech stack detector.
 *
 * Three-tier fallback:
 *   1. Direct HTTP fetch (free, fast)
 *   2. Retry with different headers
 *   3. Skip (log failure, continue pipeline)
 *
 * We deliberately keep Puppeteer out of Stage 3 to avoid
 * Railway compute costs at scale. Direct fetch covers ~80%
 * of business websites which are static or server-rendered.
 */

const FETCH_TIMEOUT_MS  = 10000
const MAX_CONTENT_CHARS = 8000

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
]

const PAGES_TO_FETCH = ['/', '/about', '/about-us', '/contact', '/contact-us']

// ── Main enrichment fetch ─────────────────────────────────────────────────

export const fetchWebsiteEnrichment = async (websiteUrl) => {
  if (!websiteUrl) {
    return { success: false, html: '', text: '', emails: [], phones: [], address: null }
  }

  const domain = extractDomain(websiteUrl)
  if (!domain) {
    return { success: false, html: '', text: '', emails: [], phones: [], address: null }
  }

  const fetchedPages = []

  // Fetch each page
  for (const path of PAGES_TO_FETCH) {
    const url    = `https://${domain}${path}`
    const result = await fetchPage(url)
    if (result) {
      fetchedPages.push({ url, html: result.html, text: result.text })
    }
    // Small delay between page fetches
    await delay(500)
  }

  if (fetchedPages.length === 0) {
    // Try HTTP if HTTPS failed
    const httpResult = await fetchPage(`http://${domain}/`)
    if (httpResult) {
      fetchedPages.push({ url: `http://${domain}/`, ...httpResult })
    }
  }

  if (fetchedPages.length === 0) {
    return { success: false, html: '', text: '', emails: [], phones: [], address: null }
  }

  // Combine HTML from all pages for tech stack detection
  const combinedHtml = fetchedPages.map(p => p.html).join('\n')
  const combinedText = fetchedPages.map(p => p.text).join('\n').slice(0, MAX_CONTENT_CHARS)

  // Extract contact information from combined content
  const emails  = extractEmails(combinedHtml)
  const phones  = extractPhones(combinedText)
  const address = extractAddress(combinedHtml)

  return {
    success:      true,
    html:         combinedHtml,
    text:         combinedText,
    emails,
    phones,
    address,
    pages_fetched: fetchedPages.map(p => p.url),
  }
}

// ── Fetch a single page ───────────────────────────────────────────────────

const fetchPage = async (url, attempt = 0) => {
  try {
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent':      USER_AGENTS[attempt % USER_AGENTS.length],
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    if (!response.ok) return null

    const html = await response.text()
    if (!html || html.length < 100) return null

    const text = extractTextFromHtml(html)
    return { html, text }

  } catch {
    // If first attempt failed try with different user agent
    if (attempt === 0) return fetchPage(url, 1)
    return null
  }
}

// ── Extract emails ────────────────────────────────────────────────────────

const extractEmails = (html) => {
  const emails = new Set()

  const IGNORED_EMAILS = /^(noreply|no-reply|donotreply|webmaster|postmaster|mailer|example|test@)/i
  const IGNORED_EXTS   = /\.(png|jpg|gif|svg|css|js|ico)$/i
  const IGNORED_DOMAINS = /@(sentry|wixpress|example|localhost)/i

  // From mailto links
  const mailtoMatches = [...html.matchAll(/href=["']mailto:([^"'?\s]+)/gi)]
  for (const m of mailtoMatches) {
    const email = m[1].toLowerCase().split('?')[0]
    if (isValidEmail(email) && !IGNORED_EMAILS.test(email) && !IGNORED_EXTS.test(email) && !IGNORED_DOMAINS.test(email)) {
      emails.add(email)
    }
  }

  // From visible text
  const textContent = extractTextFromHtml(html)
  const emailMatches = textContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
  for (const email of emailMatches) {
    const lower = email.toLowerCase()
    if (isValidEmail(lower) && !IGNORED_EMAILS.test(lower) && !IGNORED_EXTS.test(lower) && !IGNORED_DOMAINS.test(lower)) {
      const localPart = lower.split('@')[0]
      if (localPart.length <= 40) emails.add(lower)
    }
  }

  return [...emails].slice(0, 5)
}

// ── Extract phones ────────────────────────────────────────────────────────

const extractPhones = (text) => {
  const phones = new Set()

  // From tel: links
  const telMatches = [...text.matchAll(/tel:([+\d\s\-().]{7,20})/gi)]
  for (const m of telMatches) {
    const phone = m[1].trim()
    if (phone.replace(/\D/g, '').length >= 7) phones.add(phone)
  }

  // US phone patterns from text
  const phoneRegex = /(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g
  const phoneMatches = text.match(phoneRegex) || []
  for (const phone of phoneMatches) {
    phones.add(phone.trim())
  }

  return [...phones].slice(0, 3)
}

// ── Extract address ───────────────────────────────────────────────────────

const extractAddress = (html) => {
  // Try structured data first
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const m of jsonLdMatches) {
    try {
      const data = JSON.parse(m[1])
      const addr = data.address || data.location?.address
      if (addr && typeof addr === 'object') {
        const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean)
        if (parts.length >= 2) return parts.join(', ')
      }
    } catch {}
  }

  // Try address HTML tag
  const addressMatch = html.match(/<address[^>]*>([\s\S]*?)<\/address>/i)
  if (addressMatch) {
    const text = extractTextFromHtml(addressMatch[1]).slice(0, 200)
    if (text.length > 10) return text
  }

  return null
}

// ── Extract clean text from HTML ──────────────────────────────────────────

const extractTextFromHtml = (html) => {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Helpers ───────────────────────────────────────────────────────────────

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

const extractDomain = (url) => {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const delay = (ms) => new Promise(r => setTimeout(r, ms))
