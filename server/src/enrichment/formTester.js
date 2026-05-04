/**
 * Form Tester
 *
 * Tests whether a business responds to contact form submissions.
 * A business that does not auto-reply to leads is losing revenue daily.
 * This is a high-value PE signal — easy fix post-acquisition.
 *
 * Adapted from existing formSubmissionAgent.js logic.
 * Uses direct HTTP POST — no Puppeteer needed for most forms.
 *
 * Note: We do NOT actually submit spam to real businesses.
 * Instead we detect form presence and check for auto-reply configuration
 * by analysing the form action URL and any visible confirmation messages.
 */

const FETCH_TIMEOUT_MS = 8000

const CONTACT_PAGE_PATHS = [
  '/contact',
  '/contact-us',
  '/contact_us',
  '/get-in-touch',
  '/reach-us',
  '/request-quote',
  '/free-quote',
  '/schedule',
  '/book',
]

// ── Auto-reply indicator patterns ─────────────────────────────────────────
// These patterns in form HTML suggest auto-reply is configured

const AUTO_REPLY_INDICATORS = [
  /thank\s*you.*email/i,
  /confirmation.*sent/i,
  /we.*will.*contact.*you/i,
  /check.*your.*inbox/i,
  /response.*within/i,
  /reply.*within/i,
  /get back to you/i,
  /automated.*response/i,
  /auto.*reply/i,
]

// ── Form service indicators ───────────────────────────────────────────────
// These services typically have auto-reply built in

const FORM_SERVICES_WITH_AUTOREPLY = [
  /formspree\.io/i,
  /typeform\.com/i,
  /jotform\.com/i,
  /gravity.*form/i,
  /contact.*form.*7/i,
  /wpforms/i,
  /ninjaforms/i,
  /cognito.*forms/i,
  /wufoo\.com/i,
]

// ── Main form test function ───────────────────────────────────────────────

export const testFormPresence = async (websiteUrl, websiteHtml) => {
  if (!websiteUrl && !websiteHtml) {
    return {
      has_contact_form:  false,
      form_auto_reply:   null,
      form_service:      null,
      contact_page_url:  null,
    }
  }

  // Check homepage HTML first (already fetched in websiteEnricher)
  if (websiteHtml) {
    const result = analyseFormHtml(websiteHtml, websiteUrl)
    if (result.has_contact_form) return result
  }

  // Try contact pages if no form found on homepage
  if (websiteUrl) {
    const domain = extractDomain(websiteUrl)
    if (!domain) return buildEmptyResult()

    for (const path of CONTACT_PAGE_PATHS) {
      try {
        const url      = `https://${domain}${path}`
        const html     = await fetchPage(url)
        if (!html) continue

        const result = analyseFormHtml(html, url)
        if (result.has_contact_form) {
          return { ...result, contact_page_url: url }
        }
      } catch {}
    }
  }

  return buildEmptyResult()
}

// ── Analyse HTML for form presence and auto-reply ─────────────────────────

const analyseFormHtml = (html, pageUrl) => {
  if (!html) return buildEmptyResult()

  // Check for form element
  const hasForm = /<form[^>]*>/i.test(html)
  if (!hasForm) return buildEmptyResult()

  // Check for contact-specific forms (not search bars or login forms)
  const hasContactForm =
    /contact|message|inquiry|enquiry|quote|booking|appointment|name.*email|email.*phone/i.test(html) &&
    /<input[^>]*(?:name|email|phone|message|subject)[^>]*>/i.test(html)

  if (!hasContactForm) return buildEmptyResult()

  // Check for auto-reply indicators
  const formAutoReply =
    AUTO_REPLY_INDICATORS.some(p => p.test(html)) ||
    FORM_SERVICES_WITH_AUTOREPLY.some(p => p.test(html))

  // Detect form service
  let formService = null
  for (const pattern of FORM_SERVICES_WITH_AUTOREPLY) {
    if (pattern.test(html)) {
      formService = pattern.source.split('\\.')[0].replace(/[^a-z]/gi, '')
      break
    }
  }

  // Check for phone number as alternative contact (reduces urgency of form)
  const hasPhone = /tel:|(?:\+1\s?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/i.test(html)

  return {
    has_contact_form: true,
    form_auto_reply:  formAutoReply,
    form_service:     formService || 'custom',
    has_phone_backup: hasPhone,
    contact_page_url: pageUrl || null,
  }
}

// ── Fetch a page ──────────────────────────────────────────────────────────

const fetchPage = async (url) => {
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'text/html,*/*;q=0.8',
      },
    })

    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

const buildEmptyResult = () => ({
  has_contact_form: false,
  form_auto_reply:  null,
  form_service:     null,
  contact_page_url: null,
})

const extractDomain = (url) => {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
