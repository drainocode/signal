/**
 * Tech Stack Detector
 *
 * Detects presence or absence of known software tools from website HTML.
 * Adapted from existing adPresenceDetector.js with expanded coverage.
 *
 * For PE acquisition intelligence, ABSENCE of vertical software is the
 * key signal — it means the business is running manually and has upside.
 *
 * Two types of detection:
 *   1. Ad pixels — Google Ads, Meta (from existing adPresenceDetector logic)
 *   2. Vertical software — CRM, scheduling, billing, field service tools
 */

// ── Ad pixel patterns (from existing adPresenceDetector.js) ──────────────

const AD_TAG_PATTERNS = {
  google_ads: [
    /googletagmanager\.com\/gtag/i,
    /google_conversion_id/i,
    /google_remarketing_only/i,
    /AW-\d{9,}/i,
    /googletag\.pubads/i,
    /adwords\.google\.com/i,
  ],
  meta_ads: [
    /connect\.facebook\.net\/en_US\/fbevents/i,
    /facebook\.com\/tr\?id=/i,
    /fbq\('init'/i,
    /connect\.facebook\.net\/signals/i,
  ],
}

// ── Vertical-specific software patterns ───────────────────────────────────
// These are the tools PE firms look for post-acquisition to modernise.
// ABSENCE = operational gap = PE upside.

const VERTICAL_TECH_STACKS = {
  hvac: {
    field_service: [
      { name: 'ServiceTitan',    patterns: [/servicetitan/i, /st\.servicetitan/i] },
      { name: 'Jobber',          patterns: [/jobber\.com/i, /getjobber/i] },
      { name: 'Housecall Pro',   patterns: [/housecallpro/i, /hcp\.com/i] },
      { name: 'FieldEdge',       patterns: [/fieldedge/i] },
      { name: 'Service Fusion',  patterns: [/servicefusion/i] },
      { name: 'Comporium',       patterns: [/comporium/i] },
    ],
    scheduling: [
      { name: 'Calendly',        patterns: [/calendly\.com/i] },
      { name: 'Acuity',          patterns: [/acuityscheduling/i] },
      { name: 'ScheduleEngine',  patterns: [/scheduleengine/i] },
    ],
    crm: [
      { name: 'Salesforce',      patterns: [/salesforce\.com/i, /force\.com/i] },
      { name: 'HubSpot',         patterns: [/hubspot/i, /hs-scripts/i] },
    ],
  },

  dental: {
    practice_management: [
      { name: 'Dentrix',         patterns: [/dentrix/i] },
      { name: 'Eaglesoft',       patterns: [/eaglesoft/i] },
      { name: 'Curve Dental',    patterns: [/curvedental/i] },
      { name: 'Open Dental',     patterns: [/opendental/i] },
      { name: 'Carestream',      patterns: [/carestream/i] },
      { name: 'Lighthouse360',   patterns: [/lighthouse360/i] },
    ],
    scheduling: [
      { name: 'Zocdoc',          patterns: [/zocdoc\.com/i] },
      { name: 'NexHealth',       patterns: [/nexhealth/i] },
      { name: 'Weave',           patterns: [/getweave\.com/i] },
    ],
  },

  physiotherapy: {
    practice_management: [
      { name: 'WebPT',           patterns: [/webpt\.com/i] },
      { name: 'Cliniko',         patterns: [/cliniko/i] },
      { name: 'Jane App',        patterns: [/janeapp\.com/i] },
      { name: 'TherapyNotes',    patterns: [/therapynotes/i] },
      { name: 'SimplePractice',  patterns: [/simplepractice/i] },
    ],
    scheduling: [
      { name: 'Calendly',        patterns: [/calendly\.com/i] },
      { name: 'Acuity',          patterns: [/acuityscheduling/i] },
    ],
  },

  pest_control: {
    field_service: [
      { name: 'ServiceTitan',    patterns: [/servicetitan/i] },
      { name: 'PestPac',         patterns: [/pestpac/i] },
      { name: 'Jobber',          patterns: [/jobber\.com/i] },
      { name: 'FieldRoutes',     patterns: [/fieldroutes/i] },
      { name: 'ServSuite',       patterns: [/servsuite/i] },
    ],
  },

  plumbing: {
    field_service: [
      { name: 'ServiceTitan',    patterns: [/servicetitan/i] },
      { name: 'Jobber',          patterns: [/jobber\.com/i] },
      { name: 'Housecall Pro',   patterns: [/housecallpro/i] },
      { name: 'Service Fusion',  patterns: [/servicefusion/i] },
    ],
  },

  landscaping: {
    field_service: [
      { name: 'Jobber',          patterns: [/jobber\.com/i] },
      { name: 'LMN',             patterns: [/golmn\.com/i, /lmnpro/i] },
      { name: 'Aspire',          patterns: [/youraspire/i] },
      { name: 'Service Autopilot', patterns: [/serviceautopilot/i] },
      { name: 'Yardbook',        patterns: [/yardbook/i] },
    ],
  },

  optometry: {
    practice_management: [
      { name: 'Eyefinity',       patterns: [/eyefinity/i] },
      { name: 'Compulink',       patterns: [/compulink/i] },
      { name: 'RevolutionEHR',   patterns: [/revolutionehr/i] },
      { name: 'OfficeMate',      patterns: [/officemate/i] },
    ],
    scheduling: [
      { name: 'Zocdoc',          patterns: [/zocdoc\.com/i] },
      { name: 'NexHealth',       patterns: [/nexhealth/i] },
    ],
  },

  veterinary: {
    practice_management: [
      { name: 'AVImark',         patterns: [/avimark/i] },
      { name: 'Cornerstone',     patterns: [/cornerstone.*software/i] },
      { name: 'ezyVet',          patterns: [/ezyvet/i] },
      { name: 'ImproMed',        patterns: [/impromed/i] },
      { name: 'Shepherd',        patterns: [/shepherdvet/i] },
    ],
    scheduling: [
      { name: 'PetDesk',         patterns: [/petdesk/i] },
      { name: 'Vetstoria',       patterns: [/vetstoria/i] },
    ],
  },
}

// ── Online booking patterns (generic, applies to all verticals) ───────────

const BOOKING_PATTERNS = [
  { name: 'Online Booking',   patterns: [/book.*online|online.*booking|book.*appointment/i] },
  { name: 'Chat Widget',      patterns: [/intercom|drift\.com|tawk\.to|livechat|crisp\.chat|zendesk/i] },
  { name: 'Review Platform',  patterns: [/birdeye|podium|grade\.us|reviewtrackers/i] },
]

// ── Main detection function ───────────────────────────────────────────────

/**
 * Detect tech stack from website HTML.
 *
 * @param {string} html - Raw HTML from website
 * @param {string} vertical - Business vertical (hvac, dental, etc.)
 * @returns {Object} Detection results
 */
export const detectTechStack = (html, vertical) => {
  if (!html) {
    return {
      ads: { google_ads: false, meta_ads: false },
      vertical_software: [],
      missing_software:  [],
      has_booking:       false,
      has_chat:          false,
      tech_gap_score:    10, // Maximum gap if no website
    }
  }

  // ── Ad detection ─────────────────────────────────────────────────────
  const ads = {}
  for (const [platform, patterns] of Object.entries(AD_TAG_PATTERNS)) {
    ads[platform] = patterns.some(p => p.test(html))
  }

  // ── Vertical software detection ───────────────────────────────────────
  const verticalStack = VERTICAL_TECH_STACKS[vertical] || {}
  const detectedSoftware = []
  const missingSoftwareCategories = []

  for (const [category, tools] of Object.entries(verticalStack)) {
    const detected = tools.filter(tool =>
      tool.patterns.some(p => p.test(html))
    )

    if (detected.length > 0) {
      detectedSoftware.push(...detected.map(t => ({
        name:     t.name,
        category,
      })))
    } else {
      missingSoftwareCategories.push(category)
    }
  }

  // ── Generic booking/chat detection ───────────────────────────────────
  const hasBooking = BOOKING_PATTERNS
    .find(p => p.name === 'Online Booking')
    ?.patterns.some(p => p.test(html)) || false

  const hasChat = BOOKING_PATTERNS
    .find(p => p.name === 'Chat Widget')
    ?.patterns.some(p => p.test(html)) || false

  const hasReviewPlatform = BOOKING_PATTERNS
    .find(p => p.name === 'Review Platform')
    ?.patterns.some(p => p.test(html)) || false

  // ── Tech gap score ────────────────────────────────────────────────────
  // Higher score = bigger tech gap = more PE upside
  // Based on absence of key vertical software categories
  const totalCategories  = Object.keys(verticalStack).length || 1
  const missingCount     = missingSoftwareCategories.length
  const baseGapScore     = Math.round((missingCount / totalCategories) * 8)
  const bookingBonus     = hasBooking ? 0 : 1
  const chatBonus        = hasChat ? 0 : 1
  const techGapScore     = Math.min(10, baseGapScore + bookingBonus + chatBonus)

  return {
    ads: {
      google_ads: ads.google_ads || false,
      meta_ads:   ads.meta_ads   || false,
    },
    vertical_software:      detectedSoftware,
    missing_software:       missingSoftwareCategories,
    has_booking:            hasBooking,
    has_chat:               hasChat,
    has_review_platform:    hasReviewPlatform,
    tech_gap_score:         techGapScore,
    tech_gap_description:   buildGapDescription(detectedSoftware, missingSoftwareCategories, vertical),
  }
}

// ── Build human-readable gap description ─────────────────────────────────

const buildGapDescription = (detected, missing, vertical) => {
  if (missing.length === 0) {
    return `Well-equipped tech stack detected for ${vertical} vertical`
  }

  const detectedNames = detected.map(d => d.name).join(', ')
  const missingStr    = missing.join(', ')

  if (detected.length === 0) {
    return `No ${vertical} software detected — running entirely manually. Missing: ${missingStr}`
  }

  return `Partial tech stack. Has: ${detectedNames}. Missing: ${missingStr}`
}
