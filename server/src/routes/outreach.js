/**
 * Outreach Routes
 *
 * POST /api/outreach/draft — generate personalised outreach email
 *
 * This is the ONLY endpoint in the entire system that calls Claude
 * at query time. Everything else is pre-computed.
 *
 * Takes a company ID and contact ID, loads all stored signal data,
 * and generates a personalised outreach email using Claude Haiku.
 * The email references specific operational signals as hooks.
 */

import { Router }   from 'express'
import { supabase } from '../db/supabaseClient.js'
import Anthropic    from '@anthropic-ai/sdk'

const router    = Router()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── POST /api/outreach/draft ──────────────────────────────────────────────

router.post('/draft', async (req, res) => {
  try {
    const { company_id, contact_id, sequence_step = 1, sender_name, sender_firm } = req.body

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' })
    }

    // Load all data needed for personalisation
    const [businessRes, enrichmentRes, scoreRes, signalsRes, contactRes] =
      await Promise.all([
        supabase.from('businesses').select('*').eq('id', company_id).single(),
        supabase.from('enrichment_data').select('*').eq('business_id', company_id).maybeSingle(),
        supabase.from('readiness_scores').select('*').eq('business_id', company_id).maybeSingle(),
        supabase.from('signal_events').select('*').eq('business_id', company_id).order('detected_at', { ascending: false }).limit(10),
        contact_id
          ? supabase.from('contacts').select('*').eq('id', contact_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

    if (businessRes.error) throw businessRes.error
    if (!businessRes.data) return res.status(404).json({ error: 'Company not found' })

    const business   = businessRes.data
    const enrichment = enrichmentRes.data
    const score      = scoreRes.data
    const signals    = signalsRes.data || []
    const contact    = contactRes.data

    // Build personalisation context from signals
    const hiringSignals    = signals.filter(s => s.signal_category === 'hiring')
    const digitalSignals   = signals.filter(s => s.signal_category === 'digital')
    const reviewSignals    = signals.filter(s => s.signal_category === 'reviews')
    const leadershipSignals = signals.filter(s => s.signal_category === 'leadership')

    const techGaps = enrichment?.tech_stack?.missing || []
    const hasForm  = enrichment?.has_contact_form
    const formReply = enrichment?.form_auto_reply
    const responseRate = enrichment?.review_response_rate

    // Generate email with Claude Haiku
    const email = await generateOutreachEmail({
      business,
      contact,
      score,
      hiringSignals,
      digitalSignals,
      reviewSignals,
      leadershipSignals,
      techGaps,
      hasForm,
      formReply,
      responseRate,
      sequenceStep: sequence_step,
      senderName:   sender_name || 'Your Name',
      senderFirm:   sender_firm || 'Your Firm',
    })

    // Save to outreach queue
    const { data: outreachRecord, error: saveError } = await supabase
      .from('outreach_queue')
      .insert({
        business_id:   company_id,
        contact_id:    contact_id || null,
        subject:       email.subject,
        email_body:    email.body,
        personalisation_hooks: email.hooks,
        sequence_step,
        status:        'pending',
      })
      .select()
      .single()

    if (saveError) console.error('[Outreach] Save failed:', saveError.message)

    res.json({
      subject:   email.subject,
      body:      email.body,
      hooks:     email.hooks,
      recipient: contact ? {
        name:  contact.name,
        email: contact.email,
        title: contact.title,
      } : null,
      outreach_id: outreachRecord?.id || null,
    })

  } catch (err) {
    console.error('[API] POST /outreach/draft error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Generate outreach email with Claude Haiku ─────────────────────────────

const generateOutreachEmail = async ({
  business, contact, score, hiringSignals, digitalSignals,
  reviewSignals, techGaps, hasForm, formReply, responseRate,
  sequenceStep, senderName, senderFirm,
}) => {
  const recipientName  = contact?.name?.split(' ')[0] || 'there'
  const businessName   = business.name
  const vertical       = business.vertical?.replace(/_/g, ' ')
  const location       = [business.city, business.state].filter(Boolean).join(', ')
  const readinessScore = score?.readiness_score

  // Build signal context
  const signalContext = []

  if (hiringSignals.length > 0) {
    signalContext.push(`Currently hiring: ${hiringSignals.map(s => s.signal_content).slice(0, 2).join('; ')}`)
  }

  if (techGaps.length > 0) {
    signalContext.push(`Missing vertical software: ${techGaps.join(', ')}`)
  }

  if (responseRate !== null && responseRate !== undefined && responseRate < 50) {
    signalContext.push(`Only responding to ${responseRate}% of Google reviews`)
  }

  if (hasForm && !formReply) {
    signalContext.push('Has contact form but no auto-reply configured — losing leads')
  }

  const isFollowUp = sequenceStep > 1

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role:    'user',
        content: `You are a PE associate writing a cold outreach email to the owner of a ${vertical} business.

Company: ${businessName}
Location: ${location}
Contact: ${recipientName}${contact?.title ? ` (${contact.title})` : ''}
Readiness Score: ${readinessScore ? `${readinessScore}/10` : 'unknown'}
Sequence step: ${isFollowUp ? 'Follow-up email' : 'Initial outreach'}

Operational signals detected:
${signalContext.length > 0 ? signalContext.map(s => `- ${s}`).join('\n') : '- No specific signals available'}

Write a ${isFollowUp ? 'brief follow-up' : 'concise initial'} outreach email. Rules:
- Subject line: specific to their business, not generic
- Body: 3-4 short paragraphs maximum
- Reference 1-2 specific operational signals as the reason for reaching out
- Frame as operational partnership / growth capital, NOT just acquisition
- Do NOT use phrases like "I came across your business" or "I hope this email finds you well"
- Tone: direct, respectful, peer-to-peer — not salesy
- Sign off as ${senderName} from ${senderFirm}

Return ONLY this JSON:
{
  "subject": "email subject line",
  "body": "full email body with line breaks as \\n",
  "hooks": ["signal 1 used", "signal 2 used"]
}`
      }],
    })

    const text      = response.content[0]?.text?.trim() || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    return JSON.parse(jsonMatch[0])

  } catch (err) {
    console.error('[Outreach] Haiku generation failed:', err.message)

    // Fallback template
    return {
      subject: `Growth partnership opportunity — ${businessName}`,
      body:    `Hi ${recipientName},\n\nI lead investments at ${senderFirm} focused on ${vertical} businesses in ${location}.\n\nWe've been researching operators in your market and ${businessName} stood out based on your track record and market position.\n\nWould you be open to a brief call to explore whether there might be a fit?\n\nBest,\n${senderName}`,
      hooks:   ['general market research'],
    }
  }
}

// ── GET /api/outreach — list outreach queue ───────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status = 'pending', limit = 50 } = req.query

    const { data, error } = await supabase
      .from('outreach_queue')
      .select(`
        *,
        business:businesses ( id, name, city, state, vertical ),
        contact:contacts ( id, name, title, email )
      `)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (error) throw error
    res.json({ outreach: data || [] })

  } catch (err) {
    console.error('[API] GET /outreach error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
