/**
 * Executive Monitor
 *
 * Monthly check for leadership changes at enriched businesses.
 * Uses Exa to search for new executives, founders stepping back,
 * or new professional management being hired.
 *
 * For PE acquisition intelligence, executive changes are among the most
 * important signals — a founder hiring a professional CEO often precedes
 * willingness to sell. A new CFO signals preparation for a transaction.
 *
 * Signal types emitted:
 *   - exec_change_new_hire: new senior person joined
 *   - exec_change_founder_stepping_back: founder transitioning out
 *   - exec_change_professional_management: non-founder executive hired
 */

import Exa from 'exa-js'
import Anthropic from '@anthropic-ai/sdk'

const exa       = new Exa(process.env.EXA_API_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Check for executive changes ───────────────────────────────────────────

export const checkExecutiveChanges = async (business) => {
  const { id: businessId, name, city, state } = business
  const signals = []

  const location = [city, state].filter(Boolean).join(', ')

  try {
    // Search for recent news and LinkedIn mentions
    const query   = `"${name}" ${location} new hire CEO CFO COO president director manager`
    const results = await exa.searchAndContents(query, {
      numResults: 5,
      text:       true,
    })

    if (!results?.results || results.results.length === 0) return signals

    // Use Haiku to identify any executive changes from search results
    const content = results.results
      .map(r => `Source: ${r.url}\n${(r.text || '').slice(0, 600)}`)
      .join('\n\n---\n\n')
      .slice(0, 3000)

    const analysis = await analyseExecChanges(name, content)

    for (const change of analysis.changes) {
      signals.push({
        businessId,
        signalType:     change.type,
        signalCategory: 'leadership',
        signalSource:   'exa_search',
        signalContent:  change.description,
        signalData:     {
          personName: change.personName,
          role:        change.role,
          changeType:  change.type,
        },
        severity:    change.severity || 'medium',
        impactScore: change.impactScore || 6,
      })
    }

  } catch (err) {
    console.warn(`[ExecMonitor] Failed for "${name}":`, err.message)
  }

  return signals
}

// ── Analyse executive changes with Haiku ──────────────────────────────────

const analyseExecChanges = async (businessName, content) => {
  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role:    'user',
        content: `You are analyzing web search results for executive changes at "${businessName}".

Search results:
${content}

Identify any executive or leadership changes mentioned. Return ONLY this JSON:
{
  "changes": [
    {
      "type": "exec_change_new_hire" or "exec_change_founder_stepping_back" or "exec_change_professional_management",
      "personName": "name if mentioned",
      "role": "their title",
      "description": "one sentence describing the change and why it matters for PE acquisition interest",
      "severity": "high" or "medium" or "low",
      "impactScore": 1-10
    }
  ]
}

Return empty changes array if no clear executive changes found.
Only include changes that are clearly about THIS specific company, not competitors.`
      }],
    })

    const text      = response.content[0]?.text || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { changes: [] }

    return JSON.parse(jsonMatch[0])

  } catch {
    return { changes: [] }
  }
}
