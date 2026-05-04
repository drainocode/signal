/**
 * SearXNG Client — v2
 *
 * Changes from v1:
 *   - Uses SEARXNG_INTERNAL_URL (Railway internal network) when available,
 *     falls back to SEARXNG_BASE_URL. Internal is ~5ms vs ~800ms public.
 *   - Redis caching: 30-minute TTL on results. Same query from different
 *     businesses hits cache instead of external engines.
 *   - Error type differentiation: distinguishes SEARXNG_DOWN from NO_RESULTS.
 *     Orchestrator can skip stamping dm_attempted_at on infrastructure failures.
 *   - Reduced timeout: 10s per attempt (was 15s). Fail fast, let other engines
 *     in the aggregation carry the weight.
 *   - Reduced retries: 1 (was 2). With 4 engines aggregating, one retry is enough.
 */

import { createClient } from 'redis'

// ── URL resolution ────────────────────────────────────────────────────────
// Prefer internal Railway hostname — bypasses public reverse proxy and
// Railway's public-facing rate limiter. ~160x faster than public URL.
// Set SEARXNG_INTERNAL_URL=http://searxng.railway.internal:8080 on your
// backend Railway service. SEARXNG_BASE_URL remains as public fallback.

const SEARXNG_BASE = process.env.SEARXNG_BASE_URL
  || process.env.SEARXNG_INTERNAL_URL
  || 'http://localhost:8080'

// ── Redis client ──────────────────────────────────────────────────────────
// Lazy-initialised. Gracefully disabled if REDIS_URL not set.
// Uses Railway's internal Redis URL — set REDIS_URL on backend service.

let redisClient = null
let redisReady  = false

const getRedis = async () => {
  if (redisClient && redisReady) return redisClient
  if (redisClient && !redisReady) return null // connection in progress or failed

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return null

  try {
    redisClient = createClient({ url: redisUrl })
    redisClient.on('error', (err) => {
      // Log but don't crash — search works without cache
      console.warn('[SearXNG-Redis] Connection error:', err.message)
      redisReady = false
    })
    redisClient.on('ready', () => {
      redisReady = true
      console.log('[SearXNG-Redis] Connected')
    })
    await redisClient.connect()
    return redisClient
  } catch (err) {
    console.warn('[SearXNG-Redis] Failed to connect — caching disabled:', err.message)
    redisClient = null
    return null
  }
}

// ── Cache key ─────────────────────────────────────────────────────────────

const cacheKey = (query, language) => {
  // Normalise: lowercase, collapse whitespace, strip punctuation noise
  const norm = query.toLowerCase().trim().replace(/\s+/g, ' ')
  return `searxng:v2:${language}:${norm}`
}

const CACHE_TTL_SECONDS = 60 * 30 // 30 minutes

// ── Skip domains ──────────────────────────────────────────────────────────

const SKIP_DOMAINS = [
  'spokeo.com', 'peoplefinder.com', 'beenverified.com',
  'intelius.com', 'radaris.com', 'truepeoplesearch.com',
  'manta.com', 'dandb.com', 'bizapedia.com',
  'youtube.com', 'pinterest.com', 'tiktok.com',
]

const shouldSkipDomain = (url) => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return SKIP_DOMAINS.some(d => hostname.includes(d))
  } catch {
    return false
  }
}

const extractDomain = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ── Brave Search API fallback ─────────────────────────────────────────────
// Last resort only — called when SearXNG returns zero results after engine
// retry. Uses free tier (1,000 queries/month, resets monthly).
// Set BRAVE_SEARCH_API_KEY on Railway backend service env vars.
//
// Rate limit guard: max 50 Brave calls per pipeline run tracked in-memory.
// Prevents runaway spend if SearXNG goes down for an extended period.

let braveCallsThisRun = 0
const BRAVE_MAX_CALLS_PER_RUN = 150

export const resetBraveCallCounter = () => { braveCallsThisRun = 0 }

const braveSearch = async (query, maxResults = 8) => {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return []

  if (braveCallsThisRun >= BRAVE_MAX_CALLS_PER_RUN) {
    console.warn(`[Brave] Rate limit guard: ${braveCallsThisRun} calls reached — skipping "${query}"`)
    return []
  }

  try {
    braveCallsThisRun++
    const params = new URLSearchParams({ q: query, count: String(maxResults) })
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept':               'application/json',
        'Accept-Encoding':      'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.warn(`[Brave] HTTP ${res.status} for "${query}"`)
      return []
    }

    const data = await res.json()
    const raw  = data?.web?.results || []

    const results = raw
      .filter(r => r.url && r.title && !shouldSkipDomain(r.url))
      .slice(0, maxResults)
      .map(r => ({
        title:   r.title?.trim()       || '',
        url:     r.url?.trim()         || '',
        snippet: r.description?.trim() || '',
        engine:  'brave_api',
        domain:  extractDomain(r.url),
      }))

    console.log(`[Brave] "${query}" → ${results.length} results (call #${braveCallsThisRun})`)
    return results

  } catch (err) {
    console.warn(`[Brave] Error for "${query}":`, err.message)
    return []
  }
}

// ── SearXNG engine retry ──────────────────────────────────────────────────
// When SearXNG returns 0 results with engines: '' (engine dropout),
// retry the same query forcing google alone before touching paid API.

const searxngSearchWithEngineOverride = async (query, engine, options = {}) => {
  const { language = 'en', timeoutMs = 10000, maxResults = 8 } = options
  const params = new URLSearchParams({
    q:       query,
    format:  'json',
    language,
    pageno:  '1',
    engines: engine,
  })

  try {
    const res = await fetch(`${SEARXNG_BASE}/search?${params.toString()}`, {
      headers: { 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return []
    const data = await res.json()
    const raw  = data.results || []

    const results = raw
      .filter(r => r.url && r.title && !shouldSkipDomain(r.url))
      .slice(0, maxResults)
      .map(r => ({
        title:   r.title?.trim()   || '',
        url:     r.url?.trim()     || '',
        snippet: r.content?.trim() || '',
        engine:  r.engine          || engine,
        domain:  extractDomain(r.url),
      }))

    if (results.length > 0) {
      console.log(`[SearXNG-Override] "${query}" (engine: ${engine}) → ${results.length} results`)
    }
    return results
  } catch {
    return []
  }
}

// ── Core search ───────────────────────────────────────────────────────────

export const searxngSearch = async (query, options = {}) => {
  const {
    maxResults = 8,
    language   = 'en',
    retries    = 1,      // Reduced from 2 — fail fast, 4 engines covers gaps
    timeoutMs  = 10000,  // Reduced from 15000 — engines should respond within 8s
  } = options

  // ── Cache read ──────────────────────────────────────────────────────────
  const redis = await getRedis()
  const key   = cacheKey(query, language)

  if (redis && redisReady) {
    try {
      const cached = await redis.get(key)
      if (cached) {
        const parsed = JSON.parse(cached)
        console.log(`[SearXNG] CACHE HIT "${query}" → ${parsed.length} results`)
        return parsed
      }
    } catch (err) {
      console.warn('[SearXNG-Redis] Cache read failed:', err.message)
    }
  }

  // ── Live search ─────────────────────────────────────────────────────────
  const params = new URLSearchParams({
    q:      query,
    format: 'json',
    language,
    pageno: '1',
  })

  const searchUrl = `${SEARXNG_BASE}/search?${params.toString()}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(searchUrl, {
        headers: {
          'Accept':          'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        console.warn(`[SearXNG] HTTP ${res.status} for query: "${query}"`)
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
          continue
        }
        // Return typed error so orchestrator can distinguish from "no results"
        return { _searxngError: 'HTTP_ERROR', status: res.status, results: [] }
      }

      const data = await res.json()
      const raw  = data.results || []

      // Normalise and dedupe
      const seen    = new Set()
      const results = []

      for (const r of raw) {
        if (!r.url || !r.title) continue
        if (shouldSkipDomain(r.url)) continue

        const normUrl = r.url.toLowerCase().replace(/\/$/, '')
        if (seen.has(normUrl)) continue
        seen.add(normUrl)

        results.push({
          title:   r.title?.trim()   || '',
          url:     r.url?.trim()     || '',
          snippet: r.content?.trim() || '',
          engine:  r.engine          || 'unknown',
          domain:  extractDomain(r.url),
        })

        if (results.length >= maxResults) break
      }

      console.log(`[SearXNG] "${query}" → ${results.length} results (engines: ${[...new Set(raw.map(r => r.engine))].join(', ')})`)

      // ── Cache write ───────────────────────────────────────────────────
      if (redis && redisReady && results.length > 0) {
        try {
          await redis.set(key, JSON.stringify(results), { EX: CACHE_TTL_SECONDS })
        } catch (err) {
          console.warn('[SearXNG-Redis] Cache write failed:', err.message)
        }
      }

      return results

    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError'
      console.warn(`[SearXNG] Attempt ${attempt + 1} ${isTimeout ? 'TIMEOUT' : 'ERROR'} for "${query}": ${err.message}`)

      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)))
      } else {
        // Return typed error — orchestrator should NOT stamp dm_attempted_at
        return { _searxngError: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR', results: [] }
      }
    }
  }

  return []
}

// ── Multi-query search ────────────────────────────────────────────────────

export const searxngMultiSearch = async (queries, options = {}) => {
  const { delayBetween = 1500 } = options
  const allResults = []
  const seenUrls   = new Set()
  let   infraError = false

  for (const query of queries) {
    const response = await searxngSearch(query, options)

    // Detect infrastructure error — propagate up so orchestrator can bail
    if (response && response._searxngError) {
      console.warn(`[SearXNG] Infrastructure error on query "${query}": ${response._searxngError}`)
      infraError = true
      // Don't break — try remaining queries (partial results better than none)
      continue
    }

    const results = Array.isArray(response) ? response : []

    for (const r of results) {
      const key = r.url.toLowerCase().replace(/\/$/, '')
      if (!seenUrls.has(key)) {
        seenUrls.add(key)
        allResults.push({ ...r, query })
      }
    }

    if (queries.indexOf(query) < queries.length - 1) {
      await new Promise(r => setTimeout(r, delayBetween))
    }
  }

  // Tag the result set so orchestrator knows whether to trust "no results"
  if (allResults.length === 0 && infraError) {
    return { _searxngError: 'INFRA_FAILURE', results: [] }
  }

  // ── Layer 2: Engine override retry ───────────────────────────────────────
  // SearXNG returned 0 results across all queries (engines: dropout).
  // Retry the first query forcing each engine directly in priority order.
  if (allResults.length === 0 && !infraError && queries.length > 0) {
    const overrideEngines = ['google', 'startpage', 'bing', 'yahoo', 'qwant']
    for (const engine of overrideEngines) {
      console.log(`[SearXNG] Zero results — trying engine override (${engine}) on: "${queries[0]}"`)
      const overrideResults = await searxngSearchWithEngineOverride(queries[0], engine, options)
      if (overrideResults.length > 0) {
        console.log(`[SearXNG] Engine override recovered ${overrideResults.length} results via ${engine}`)
        return overrideResults.map(r => ({ ...r, query: queries[0] }))
      }
    }
    const overrideResults = []

    if (overrideResults.length > 0) {
      return overrideResults.map(r => ({ ...r, query: queries[0] }))
    }

    // ── Layer 3: Brave Search API fallback ──────────────────────────────────
    // SearXNG and engine override both returned nothing. Last resort paid call.
    // Only fires if BRAVE_SEARCH_API_KEY is set and under the run cap.
    if (process.env.BRAVE_SEARCH_API_KEY) {
      console.log(`[Brave] SearXNG exhausted — falling back to Brave API for: "${queries[0]}"`)
      const braveResults = await braveSearch(queries[0], options.maxResults || 8)

      if (braveResults.length > 0) {
        return braveResults.map(r => ({ ...r, query: queries[0] }))
      }
    }
  }

  return allResults
}

// ── LinkedIn-targeted search ──────────────────────────────────────────────

export const searxngLinkedInSearch = async (queries, options = {}) => {
  // LinkedIn queries via SearXNG proxy consistently fail because residential proxies
  // are blocked by LinkedIn/Google for site: operator queries.
  // Go directly to Brave Search API for LinkedIn queries — it is more reliable.
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const allResults = []
    const seenUrls   = new Set()

    for (const query of queries) {
      const isLinkedInQuery = query.toLowerCase().includes('linkedin') || query.includes('site:linkedin')
      if (isLinkedInQuery) {
        const braveResults = await braveSearch(query, options.maxResults || 8)
        for (const r of braveResults) {
          const key = r.url.toLowerCase().replace(/\/$/, '')
          if (!seenUrls.has(key)) {
            seenUrls.add(key)
            allResults.push({ ...r, query })
          }
        }
        continue
      }

      // Non-LinkedIn queries still go through SearXNG
      const response = await searxngSearch(query, options)
      if (response && response._searxngError) continue
      const results = Array.isArray(response) ? response : []
      for (const r of results) {
        const key = r.url.toLowerCase().replace(/\/$/, '')
        if (!seenUrls.has(key)) {
          seenUrls.add(key)
          allResults.push({ ...r, query })
        }
      }
    }

    return allResults.filter(r => {
      const url = r.url.toLowerCase()
      return url.includes('linkedin.com/in/') || url.includes('linkedin.com/pub/')
    })
  }

  // Fallback — original SearXNG path if no Brave key
  const response = await searxngMultiSearch(queries, options)
  if (response && response._searxngError) return response
  const results = Array.isArray(response) ? response : []
  return results.filter(r => {
    const url = r.url.toLowerCase()
    return url.includes('linkedin.com/in/') || url.includes('linkedin.com/pub/')
  })
}

// ── Page fetcher ──────────────────────────────────────────────────────────

export const fetchPageText = async (url, timeoutMs = 12000) => {
  if (/\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3|css|js)$/i.test(url)) return null

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) return null
    const html = await res.text()
    if (!html || html.length < 200) return null
    return stripHtml(html)

  } catch {
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
        headers: { 'Accept': 'text/plain' },
        signal:  AbortSignal.timeout(15000),
      })
      if (!jinaRes.ok) return null
      return await jinaRes.text()
    } catch {
      return null
    }
  }
}

// ── HTML stripper ─────────────────────────────────────────────────────────

export const stripHtml = (html) => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '  ')
    .trim()
    .slice(0, 8000)
}
