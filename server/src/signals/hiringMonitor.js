/**
 * Hiring Monitor — Combined Agent 1 + Agent 2
 *
 * Two complementary agents run in parallel for maximum coverage:
 *
 * Agent 1 — Company Website Careers Scanner
 *   Visits the business's own website, finds their careers/jobs page,
 *   extracts job titles from HTML, classifies with Haiku.
 *   Best for: businesses that post jobs on their own site.
 *
 * Agent 2 — External Job Board Scanner
 *   Searches Indeed and Glassdoor via SearXNG for company-specific postings.
 *   Fetches full job descriptions via Jina.ai (free, handles JS rendering).
 *   Classifies with Haiku using actual JD content not just titles.
 *   Best for: businesses that post directly to Indeed/Glassdoor.
 *
 * Results from both agents are deduplicated by normalised role title.
 * Agent 1 scores: high confidence (careers page)
 * Agent 2 scores: 9 for full JD fetch, 6 for snippet-only fallback
 *
 * Signal types emitted:
 *   - hiring_manual_role: admin/scheduling/billing/coordination role
 *   - hiring_growth_role: management/senior role indicating expansion
 */

import Anthropic from '@anthropic-ai/sdk'
import { searxngMultiSearch } from './searxngClient.js'

const anthropic    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const FETCH_TIMEOUT = 10000
const JINA_TIMEOUT  = 15000

// ═══════════════════════════════════════════════════════════════════════════
// AGENT 1 — Company Website Careers Scanner
// Adapted from jobSignalAgent1.js
// ═══════════════════════════════════════════════════════════════════════════

// ── Careers page paths ────────────────────────────────────────────────────

const CAREERS_KEYWORDS = [
  'careers', 'jobs', 'vacancies', 'hiring', 'join-us', 'join-our-team',
  'work-with-us', 'employment', 'opportunities', 'open-positions',
  'open-roles', 'now-hiring', 'job-openings', 'positions', 'apply',
]

// ── Find careers page links from homepage HTML ────────────────────────────

const findCareersLinks = (html, baseUrl) => {
  const baseDomain = extractDomain(baseUrl)
  const seen       = new Set()
  const candidates = []

  const matches = [...html.matchAll(/href=["']([^"'#\s]+)["'][^>]*>([^<]{0,60})</gi)]

  for (const m of matches) {
    const href = m[1].trim()
    const text = (m[2] || '').toLowerCase().trim()
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue

    try {
      const absolute = new URL(href, baseUrl).href
      const urlLower = absolute.toLowerCase()
      const key      = urlLower.replace(/\/$/, '')

      if (seen.has(key)) continue
      if (extractDomain(absolute) !== baseDomain) continue
      seen.add(key)

      let score = 0
      for (const kw of CAREERS_KEYWORDS) {
        if (urlLower.includes(kw)) score += 2
        if (text.includes(kw))     score += 1
      }

      if (score > 0) candidates.push({ url: absolute, score })
    } catch {}
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(c => c.url)
}

// ── Extract job titles from careers page HTML ─────────────────────────────

const extractJobTitlesFromHtml = (html) => {
  const titles = new Set()

  // Strategy 1: JSON-LD JobPosting schema
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const m of jsonLdMatches) {
    try {
      const data  = JSON.parse(m[1])
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (item['@type'] === 'JobPosting' && item.title) {
          titles.add(item.title.trim())
        }
      }
    } catch {}
  }

  if (titles.size > 0) return [...titles]

  // Strategy 2: Common job listing HTML patterns
  const patterns = [
    /<h[1-4][^>]*class="[^"]*(?:job[_-]?title|position[_-]?title|role[_-]?title)[^"]*"[^>]*>([^<]{5,100})</gi,
    /<(?:div|span|p|li)[^>]*class="[^"]*(?:job[_-]?title|position|role|opening|vacancy)[^"]*"[^>]*>([^<]{5,100})</gi,
    /data-(?:testid|test)=["'](?:job|position)[_-]?title["'][^>]*>([^<]{5,100})</gi,
  ]

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)]
    for (const m of matches) {
      const title = m[1].replace(/<[^>]+>/g, '').trim()
      if (title.length >= 5 && title.length <= 80) titles.add(title)
    }
  }

  // Strategy 3: Text around Apply buttons
  const applyContexts = [...html.matchAll(/([A-Z][a-zA-Z\s&\/\-]{8,60})\s*(?:<[^>]+>\s*){0,5}(?:Apply Now|Apply|View Job)/gi)]
  for (const m of applyContexts) {
    const title = m[1].replace(/<[^>]+>/g, '').trim()
    if (title.length >= 8 && title.length <= 60 && !title.toLowerCase().includes('cookie')) {
      titles.add(title)
    }
  }

  return [...titles].slice(0, 30)
}

// ── Haiku classification for website job titles ───────────────────────────

const classifyTitlesWithHaiku = async (titles, businessName, vertical) => {
  if (!titles.length) return []

  const titleList = titles.map((t, i) => `${i + 1}. "${t}"`).join('\n')

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role:    'user',
        content: `You are evaluating job postings for "${businessName}", a business in the "${vertical}" industry.

Job titles found on their careers page:
${titleList}

For each title that qualifies, write a consultant_summary: 2 sentences explaining what this hiring activity reveals about their current operational pain and automation opportunity. Written for a PE acquisition analyst.

Disqualify: physical/trades roles requiring tools or van, purely technical IT, senior leadership (CEO/Director/Partner), sales hunters.

Return ONLY this JSON array:
[
  {
    "index": 1,
    "title": "exact title",
    "qualifies": true,
    "role_type": "manual_role" or "growth_role",
    "consultant_summary": "..."
  },
  {
    "index": 2,
    "title": "exact title",
    "qualifies": false,
    "reason": "physical role"
  }
]

manual_role = scheduling, dispatching, admin, billing, data entry, coordination, reception, bookkeeping
growth_role = manager, director, VP, COO, CFO — indicates business expansion`
      }],
    })

    const text       = response.content[0]?.text?.trim() || ''
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) return []

    const result = JSON.parse(arrayMatch[0])
    return result.filter(r => r.qualifies && r.consultant_summary).map(r => ({
      businessId:     null, // set by caller
      signalType:     r.role_type === 'growth_role' ? 'hiring_growth_role' : 'hiring_manual_role',
      signalCategory: 'hiring',
      signalSource:   'company_careers_page',
      signalContent:  r.consultant_summary,
      signalData:     { title: r.title, vertical },
      severity:       r.role_type === 'growth_role' ? 'medium' : 'high',
      impactScore:    r.role_type === 'growth_role' ? 5 : 9,
      rawTitle:       r.title,
    }))

  } catch (err) {
    console.warn(`[HiringMonitor-A1] Haiku classification failed:`, err.message)
    return []
  }
}

// ── Run Agent 1 ───────────────────────────────────────────────────────────

const runAgent1 = async (business) => {
  const { name, website, vertical } = business
  if (!website) return []

  console.log(`[HiringMonitor-A1] Scanning website careers page: "${name}"`)

  // Fetch homepage
  let homeHtml = await fetchDirect(website)
  if (!homeHtml || homeHtml.length < 300) {
    homeHtml = await fetchViaJina(website)
  }
  if (!homeHtml) return []

  // Find careers page links
  const careersLinks = findCareersLinks(homeHtml, website)
  if (!careersLinks.length) {
    console.log(`[HiringMonitor-A1] No careers page found for "${name}"`)
    return []
  }

  console.log(`[HiringMonitor-A1] Found ${careersLinks.length} careers page candidates`)

  // Fetch careers pages and extract titles
  let allTitles = []
  for (const url of careersLinks) {
    await delay(800)
    let html = await fetchDirect(url)
    if (!html || html.length < 200) html = await fetchViaJina(url)
    if (!html) continue

    const titles = extractJobTitlesFromHtml(html)
    console.log(`[HiringMonitor-A1] "${name}" — ${titles.length} titles from ${url}`)
    allTitles.push(...titles)
  }

  allTitles = [...new Set(allTitles.map(t => t.trim()))].filter(t => t.length >= 5)

  if (!allTitles.length) {
    console.log(`[HiringMonitor-A1] No job titles extracted for "${name}"`)
    return []
  }

  console.log(`[HiringMonitor-A1] "${name}" — ${allTitles.length} unique titles — classifying`)
  return await classifyTitlesWithHaiku(allTitles, name, vertical || '')
}


// ═══════════════════════════════════════════════════════════════════════════
// AGENT 2 — External Job Board Scanner
// Adapted from jobSignalAgent2.js
// ═══════════════════════════════════════════════════════════════════════════

// ── Non-job URL patterns to skip ──────────────────────────────────────────

const NON_JOB_URL_PATTERNS = [
  '/cmp/', '/salary/', '/companies/', '/reviews/', '/about/',
  'glassdoor.com/overview', 'glassdoor.com/Reviews', 'glassdoor.com/Salary',
  'glassdoor.com/Jobs', 'glassdoor.com/Overview',
  'linkedin.com/company/', 'linkedin.com/jobs/search',
  '/jobs-at-', '/working-at-',
]

// ── Build SearXNG queries ─────────────────────────────────────────────────

const buildJobQueries = (business) => {
  const { name, city, state, country } = business

  let shortName = name
  if (name.includes(' - ')) shortName = name.split(' - ')[0].trim()
  else if (name.includes(', ')) shortName = name.split(', ')[0].trim()
  if (shortName.length > 45) shortName = shortName.slice(0, 45).trim()

  const indeedDomain    = country === 'UK' ? 'uk.indeed.com' : 'indeed.com'
  const glassdoorDomain = country === 'UK' ? 'glassdoor.co.uk' : 'glassdoor.com'

  return [
    `"${shortName}" site:${indeedDomain}/viewjob`,
    `"${shortName}" site:${glassdoorDomain}`,
    `"${shortName}" hiring coordinator OR dispatcher OR administrator OR scheduler OR receptionist`,
  ]
}

// ── Parse search results into Indeed and non-Indeed buckets ──────────────

const parseSearchResults = (results) => {
  const indeedResults    = []
  const nonIndeedResults = []

  for (const result of results) {
    const url     = result.url || ''
    const snippet = result.snippet || ''

    if (NON_JOB_URL_PATTERNS.some(p => url.toLowerCase().includes(p.toLowerCase()))) continue
    if (!snippet || snippet.length < 20) continue

    const source = url.includes('indeed.com')  ? 'indeed.com' :
                   url.includes('glassdoor')   ? 'glassdoor.com' :
                   url.includes('linkedin.com') ? 'linkedin.com/jobs' : 'job_board'

    let posting_age_days = null
    const ageMatch = `${result.title} ${snippet}`.match(/(\d+)\s*(day|week|month|hour)s?\s*ago/i)
    if (ageMatch) {
      const num  = parseInt(ageMatch[1])
      const unit = ageMatch[2].toLowerCase()
      posting_age_days = unit === 'hour' ? 0 : unit === 'day' ? num : unit === 'week' ? num * 7 : num * 30
    }

    const parsed = { source, url, page_title: result.title || '', snippet, posting_age_days }

    if (source === 'indeed.com') {
      const jobId = extractIndeedJobId(url)
      if (jobId) indeedResults.push({ ...parsed, job_id: jobId })
    } else {
      nonIndeedResults.push(parsed)
    }
  }

  return { indeedResults, nonIndeedResults }
}

// ── Qualify a job using full JD text via Haiku ────────────────────────────

const qualifyJobWithJD = async (jobTitle, jdText, source, businessName, vertical, score = 9) => {
  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role:    'user',
        content: `You are evaluating a job posting for "${businessName}", a ${vertical} business.

Job title: "${jobTitle}"
Job description: "${jdText.slice(0, 800)}"

Does this role represent work that AI automation could eliminate or significantly reduce?
Focus on: scheduling, dispatching, coordination, administration, data entry, invoicing, billing, reception, customer communication, booking.
Disqualify: physical on-site labour, purely technical IT, senior leadership, sales hunters.

Return ONLY this JSON array:
[
  {
    "role_qualifies": true,
    "extracted_title": "${jobTitle}",
    "role_type": "manual_role" or "growth_role",
    "consultant_summary": "2 sentences using specific details from the JD for a PE acquisition analyst"
  }
]
OR if does not qualify:
[{"role_qualifies": false, "reason": "..."}]`
      }],
    })

    const text       = response.content[0]?.text?.trim() || ''
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) return null

    const result = JSON.parse(arrayMatch[0])
    if (!result?.[0]?.role_qualifies) return null

    const normalizedSource = source.includes('indeed') ? 'indeed.com' :
                             source.includes('glassdoor') ? 'glassdoor.com' :
                             source.includes('linkedin') ? 'linkedin.com/jobs' : source

    return {
      businessId:     null,
      signalType:     result[0].role_type === 'growth_role' ? 'hiring_growth_role' : 'hiring_manual_role',
      signalCategory: 'hiring',
      signalSource:   normalizedSource,
      signalContent:  result[0].consultant_summary,
      signalData:     { title: result[0].extracted_title, vertical },
      severity:       result[0].role_type === 'growth_role' ? 'medium' : 'high',
      impactScore:    score,
      rawTitle:       result[0].extracted_title || jobTitle,
    }

  } catch (err) {
    console.warn(`[HiringMonitor-A2] Haiku qualification failed:`, err.message)
    return null
  }
}

// ── Snippet-only fallback qualification ───────────────────────────────────

const qualifySnippetOnly = async (snippets, businessName, vertical) => {
  if (!snippets.length) return []

  const snippetList = snippets.slice(0, 6).map((s, i) =>
    `${i + 1}. Source: ${s.source}\n   Title: "${s.page_title}"\n   Snippet: "${s.snippet}"`
  ).join('\n\n')

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role:    'user',
        content: `You are evaluating job board results for "${businessName}" in the "${vertical}" industry.

${snippetList}

For each result that is clearly from "${businessName}" AND describes an automation-replaceable role, qualify it.

Return ONLY this JSON array:
[
  {
    "index": 1,
    "employer_match": true,
    "role_qualifies": true,
    "extracted_title": "job title",
    "role_type": "manual_role" or "growth_role",
    "source": "source name",
    "consultant_summary": "2 sentences for PE acquisition analyst"
  }
]`
      }],
    })

    const text       = response.content[0]?.text?.trim() || ''
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) return []

    const result = JSON.parse(arrayMatch[0])
    return result
      .filter(r => r.employer_match && r.role_qualifies && r.consultant_summary)
      .map(r => ({
        businessId:     null,
        signalType:     r.role_type === 'growth_role' ? 'hiring_growth_role' : 'hiring_manual_role',
        signalCategory: 'hiring',
        signalSource:   r.source?.toLowerCase().includes('indeed') ? 'indeed.com' : 'glassdoor.com',
        signalContent:  r.consultant_summary,
        signalData:     { title: r.extracted_title, vertical },
        severity:       'medium',
        impactScore:    6, // Capped lower — snippet only, less confident
        rawTitle:       r.extracted_title || '',
      }))

  } catch {
    return []
  }
}

// ── Run Agent 2 ───────────────────────────────────────────────────────────

const runAgent2 = async (business) => {
  const { name, vertical } = business

  console.log(`[HiringMonitor-A2] Searching job boards: "${name}"`)

  const queries       = buildJobQueries(business)
  const searchResults = await searxngMultiSearch(queries, {
    maxResults:   5,
    delayBetween: 1500,
  })

  if (!searchResults || searchResults._searxngError || !Array.isArray(searchResults) || searchResults.length === 0) {
    console.log(`[HiringMonitor-A2] No search results for "${name}"`)
    return []
  }

  console.log(`[HiringMonitor-A2] "${name}" — ${searchResults.length} raw results`)

  const { indeedResults, nonIndeedResults } = parseSearchResults(searchResults)
  console.log(`[HiringMonitor-A2] "${name}" — ${indeedResults.length} Indeed | ${nonIndeedResults.length} other`)

  const allSignals = []

  // Path A: Indeed jobs — fetch full JD via Jina
  for (const result of indeedResults) {
    if (result.posting_age_days !== null && result.posting_age_days > 90) continue

    const jobUrl = `https://www.indeed.com/viewjob?jk=${result.job_id}`
    await delay(800)

    const jdText = await fetchViaJina(jobUrl)
    if (jdText) {
      const jobTitle = extractTitleFromPageTitle(result.page_title) || 'coordinator role'
      const signal   = await qualifyJobWithJD(jobTitle, jdText, 'indeed.com', name, vertical || '', 9)
      if (signal) {
        allSignals.push(signal)
        console.log(`[HiringMonitor-A2] ✓ Indeed signal: "${signal.rawTitle}"`)
      }
    }

    await delay(500)
  }

  // Path B: Non-Indeed — fetch full JD via Jina
  for (const result of nonIndeedResults.slice(0, 4)) {
    if (result.posting_age_days !== null && result.posting_age_days > 90) continue

    await delay(800)
    const jdText = await fetchViaJina(result.url)
    if (jdText) {
      const jobTitle = extractTitleFromPageTitle(result.page_title) || 'coordinator role'
      const signal   = await qualifyJobWithJD(jobTitle, jdText, result.source, name, vertical || '', 7)
      if (signal) {
        allSignals.push(signal)
        console.log(`[HiringMonitor-A2] ✓ ${result.source} signal: "${signal.rawTitle}"`)
      }
    }
  }

  // Path C: Snippet-only fallback if Jina failed for everything
  if (allSignals.length === 0) {
    const snippetCandidates = [
      ...indeedResults,
      ...nonIndeedResults.filter(r => r.posting_age_days === null || r.posting_age_days <= 90),
    ].slice(0, 6)

    if (snippetCandidates.length > 0) {
      const snippetSignals = await qualifySnippetOnly(snippetCandidates, name, vertical || '')
      allSignals.push(...snippetSignals)
      if (snippetSignals.length > 0) {
        console.log(`[HiringMonitor-A2] ✓ ${snippetSignals.length} snippet-only signals`)
      }
    }
  }

  return allSignals
}


// ═══════════════════════════════════════════════════════════════════════════
// COMBINED ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

// ── Deduplicate signals by normalised role title ──────────────────────────

const deduplicateSignals = (signals) => {
  const seen   = new Set()
  const result = []

  const normalise = (title = '') =>
    title.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z\s]/g, '')

  for (const signal of signals) {
    const key = normalise(signal.rawTitle || signal.signalContent?.slice(0, 40) || '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(signal)
  }

  return result
}

// ── Main export ───────────────────────────────────────────────────────────

export const checkHiringActivity = async (business) => {
  const { id: businessId, name } = business

  // Run both agents sequentially to respect rate limits
  let agent1Signals = []
  let agent2Signals = []

  try {
    agent1Signals = await runAgent1(business)
  } catch (err) {
    console.warn(`[HiringMonitor] Agent 1 error for "${name}":`, err.message)
  }

  // Small pause between agents
  await delay(1500)

  try {
    agent2Signals = await runAgent2(business)
  } catch (err) {
    console.warn(`[HiringMonitor] Agent 2 error for "${name}":`, err.message)
  }

  console.log(`[HiringMonitor] "${name}" — A1: ${agent1Signals.length} | A2: ${agent2Signals.length}`)

  // Combine and deduplicate
  const combined    = [...agent1Signals, ...agent2Signals]
  const deduplicated = deduplicateSignals(combined)

  // Set businessId on all signals
  return deduplicated.map(s => ({ ...s, businessId }))
}


// ═══════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

// ── Fetch via direct HTTP ─────────────────────────────────────────────────

const fetchDirect = async (url) => {
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!response.ok) return null
    const html = await response.text()
    return html || null
  } catch {
    return null
  }
}

// ── Fetch via Jina.ai — handles JS rendering and bot detection ────────────

const fetchViaJina = async (url) => {
  try {
    const jinaUrl    = `https://r.jina.ai/${url}`
    const controller = new AbortController()
    setTimeout(() => controller.abort(), JINA_TIMEOUT)

    const response = await fetch(jinaUrl, {
      signal:  controller.signal,
      headers: { 'Accept': 'text/plain' },
    })

    if (!response.ok) return null
    const text = await response.text()
    return text?.length > 100 ? text.slice(0, 5000) : null
  } catch {
    return null
  }
}

// ── Extract job title from page title ─────────────────────────────────────

const extractTitleFromPageTitle = (pageTitle = '') => {
  // "Office Manager at Acme Corp - Indeed" → "Office Manager"
  const atMatch = pageTitle.match(/^([^|–\-@]{4,50}?)\s+at\s+/i)
  if (atMatch) return atMatch[1].trim()

  // "Office Manager - Acme Corp | Glassdoor" → "Office Manager"
  const dashMatch = pageTitle.match(/^([A-Z][^|–\-]{4,50}?)\s*[-–]\s*[A-Z]/i)
  if (dashMatch) return dashMatch[1].trim()

  return null
}

// ── Extract Indeed job ID from URL ────────────────────────────────────────

const extractIndeedJobId = (url = '') => {
  try {
    const jk = new URL(url).searchParams.get('jk')
    if (jk && /^[a-f0-9]{14,20}$/i.test(jk)) return jk
  } catch {}
  const match = url.match(/[?&]jk=([a-f0-9]{14,20})/i)
  return match ? match[1] : null
}

// ── Extract domain ────────────────────────────────────────────────────────

const extractDomain = (url) => {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch { return null }
}

const delay = (ms) => new Promise(r => setTimeout(r, ms))
