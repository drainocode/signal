/**
 * Ad Monitor
 *
 * Weekly check for changes in Google Ads and Meta pixel presence.
 * Compares current state against last stored enrichment data.
 *
 * Signal types emitted:
 *   - ad_activity_started: new ad pixel detected that wasn't there before
 *   - ad_activity_stopped: ad pixel removed (cutting marketing spend)
 */

import { detectTechStack } from '../enrichment/techStackDetector.js'
import { fetchWebsiteEnrichment } from '../enrichment/websiteEnricher.js'

// ── Check ad activity changes ─────────────────────────────────────────────

export const checkAdChanges = async (business, enrichmentData) => {
  const { id: businessId, name, website, vertical } = business
  const signals = []

  if (!website) return signals

  // Fetch current website HTML
  const websiteResult = await fetchWebsiteEnrichment(website)
  if (!websiteResult.success) return signals

  // Detect current ad pixels
  const currentTechStack = detectTechStack(websiteResult.html, vertical)
  const currentGoogleAds = currentTechStack.ads.google_ads
  const currentMetaAds   = currentTechStack.ads.meta_ads

  // Compare against stored enrichment data
  const previousGoogleAds = enrichmentData?.has_google_ads || false
  const previousMetaAds   = enrichmentData?.has_meta_ads   || false

  // Google Ads changes
  if (currentGoogleAds && !previousGoogleAds) {
    signals.push({
      businessId,
      signalType:     'ad_activity_started',
      signalCategory: 'digital',
      signalSource:   'website_scan',
      signalContent:  `${name} just started running Google Ads — investing in growth marketing`,
      signalData:     { platform: 'google_ads', previous: false, current: true },
      severity:       'high',
      impactScore:    7,
    })
  }

  if (!currentGoogleAds && previousGoogleAds) {
    signals.push({
      businessId,
      signalType:     'ad_activity_stopped',
      signalCategory: 'digital',
      signalSource:   'website_scan',
      signalContent:  `${name} removed Google Ads tracking — may have paused or stopped advertising`,
      signalData:     { platform: 'google_ads', previous: true, current: false },
      severity:       'medium',
      impactScore:    5,
    })
  }

  // Meta Ads changes
  if (currentMetaAds && !previousMetaAds) {
    signals.push({
      businessId,
      signalType:     'ad_activity_started',
      signalCategory: 'digital',
      signalSource:   'website_scan',
      signalContent:  `${name} just added Meta/Facebook advertising pixel — expanding digital marketing`,
      signalData:     { platform: 'meta_ads', previous: false, current: true },
      severity:       'high',
      impactScore:    6,
    })
  }

  if (!currentMetaAds && previousMetaAds) {
    signals.push({
      businessId,
      signalType:     'ad_activity_stopped',
      signalCategory: 'digital',
      signalSource:   'website_scan',
      signalContent:  `${name} removed Meta pixel — reduced social advertising presence`,
      signalData:     { platform: 'meta_ads', previous: true, current: false },
      severity:       'low',
      impactScore:    3,
    })
  }

  // Also check for new tech stack additions (booking, chat, etc.)
  const previousMissingCount = (enrichmentData?.tech_stack?.missing || []).length
  const currentMissingCount  = currentTechStack.missing_software.length

  if (currentMissingCount < previousMissingCount) {
    const added = previousMissingCount - currentMissingCount
    signals.push({
      businessId,
      signalType:     'tech_stack_improved',
      signalCategory: 'digital',
      signalSource:   'website_scan',
      signalContent:  `${name} added ${added} new software tool(s) — improving operational tech stack`,
      signalData:     {
        previousMissing: previousMissingCount,
        currentMissing:  currentMissingCount,
        currentDetected: currentTechStack.vertical_software.map(s => s.name),
      },
      severity:   'low',
      impactScore: 2,
    })
  }

  return signals
}
