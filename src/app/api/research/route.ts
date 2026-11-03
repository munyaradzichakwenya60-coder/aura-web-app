import { NextRequest, NextResponse } from 'next/server'
import { rateLimited, requireUser } from '@/lib/auth'
import { checkContentPolicy } from '@/lib/policy'
import {
  SourceRegistry, TIER_LABEL, annotate, groundedSearch, hostOf, resolveRedirect, searchReference, searchScholarly,
  type GroundedNote, type Source,
} from '@/lib/research'

export const runtime = 'nodejs'
export const maxDuration = 60

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const REPORT_SYSTEM = `You are AURA, writing a research report for a student or lecturer. You are given research notes with numbered sources. Rules:
- Use ONLY the notes and sources provided. Do not add facts from memory. If the notes do not answer part of the question, say so plainly.
- Cite every factual claim with the source numbers in square brackets, like [1] or [2][5]. Only use numbers that appear in the notes. Never invent a source or a number.
- Prefer sources marked "official or peer-reviewed". Where only low-quality sources back a claim, say it is weakly supported.
- When sources disagree, show both sides and say what each one says. When only one source supports an important claim, say that it rests on a single source.
- Use plain, clear English and no emojis. Do not write a Sources list; it is added automatically.
Structure the report with these headings:
## Summary
Two to four sentences that answer the question directly.
## Key findings
The main points, each with citations. Include figures, dates and names where the notes have them.
## Where sources agree and disagree
Short and specific. Say "No disagreement found" only if that is true.
## Limits of this research
What could not be confirmed, what is out of date or thin, and what the reader should check in the original sources.`

function sse(controller: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`))
}

async function plan(apiKey: string, question: string, context: string, signal: AbortSignal): Promise<{ questions: string[]; keywords: string }> {
  const fallback = { questions: [question], keywords: question.slice(0, 120) }
  if (!apiKey) return fallback
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Today is ${new Date().toDateString()}.\nPlan web research for the question below. Return JSON with "questions": 3 or 4 specific, non-overlapping sub-questions that together cover it (definitions, evidence, numbers and dates, opposing views, recent developments as relevant), and "keywords": a short keyword query (under 10 words) for finding academic papers.\n${context ? `Conversation so far:\n${context}\n` : ''}Question: ${question}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
      }),
    })
    if (!res.ok) return fallback
    const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const raw = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
    const parsed = JSON.parse(raw) as { questions?: unknown; keywords?: unknown }
    const questions = Array.isArray(parsed.questions) ? parsed.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 5).slice(0, 4).map(q => q.slice(0, 300)) : []
    const keywords = typeof parsed.keywords === 'string' && parsed.keywords.trim() ? parsed.keywords.trim().slice(0, 120) : question.slice(0, 120)
    return { questions: questions.length ? questions : [question], keywords }
  } catch { return fallback }
}

/** Fallback writer for when Gemini is unavailable: OpenRouter, then Pollinations. One block, not streamed. */
async function writeWithFallback(system: string, user: string, origin: string, signal: AbortSignal): Promise<string> {
  const orKey = process.env.OPENROUTER_API_KEY?.trim() ?? ''
  const endpoint = orKey ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://text.pollinations.ai/openai/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (orKey) { headers.Authorization = `Bearer ${orKey}`; headers['HTTP-Referer'] = origin; headers['X-Title'] = 'AURA Web' }
  const res = await fetch(endpoint, {
    method: 'POST', headers, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    body: JSON.stringify({ model: orKey ? 'nvidia/nemotron-3-super-120b-a12b:free' : 'openai-fast', temperature: 0.2, max_tokens: 3500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  })
  if (!res.ok) return ''
  const json = await res.json() as { choices?: { message?: { content?: string } }[] }
  return json.choices?.[0]?.message?.content?.trim() ?? ''
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (auth.response) return auth.response
  const user = auth.user
  // Deep research is heavy, so it has its own, tighter limit.
  if (rateLimited(`research:${user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Research is limited to a few runs a minute. Please wait a moment.' }, { status: 429 })
  }

  let messages: ChatMessage[]
  try {
    const body = await req.json() as { messages?: unknown }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 20) throw new Error('bad')
    messages = (body.messages as ChatMessage[]).map(m => {
      if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new Error('bad')
      return { role: m.role, content: m.content.slice(0, 4_000) }
    })
  } catch {
    return NextResponse.json({ error: 'Provide between 1 and 20 messages.' }, { status: 400 })
  }

  const last = [...messages].reverse().find(m => m.role === 'user')
  if (!last) return NextResponse.json({ error: 'No question found.' }, { status: 400 })
  const question = last.content.replace(/--- Attached file:[\s\S]*$/, '').trim().slice(0, 600) || last.content.slice(0, 600)
  if (checkContentPolicy(last.content).blocked) {
    return NextResponse.json({ error: 'That request is outside what AURA can help with.' }, { status: 400 })
  }
  const context = messages.slice(-7, -1).map(m => `${m.role}: ${m.content.slice(0, 400)}`).join('\n')
  const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? ''
  const origin = req.nextUrl.origin

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const status = (text: string) => sse(controller, { status: text })
      const emit = (text: string, engine: string) => sse(controller, { text, engine })
      try {
        status('Planning the research')
        const { questions, keywords } = await plan(geminiKey, question, context, req.signal)

        status(`Searching ${geminiKey ? 'the web, ' : ''}academic papers and reference works`)
        const [grounded, scholarly, reference] = await Promise.all([
          geminiKey ? Promise.all(questions.map(q => groundedSearch(geminiKey, q, req.signal))) : Promise.resolve([] as (GroundedNote | null)[]),
          searchScholarly(keywords, req.signal),
          searchReference(keywords, req.signal),
        ])

        status('Checking and ranking the sources')
        const registry = new SourceRegistry()
        const webNotes: { question: string; text: string }[] = []
        for (let i = 0; i < grounded.length; i++) {
          const note = grounded[i]
          if (!note) continue
          const resolved = await Promise.all(note.chunks.map(c => c.uri ? resolveRedirect(c.uri, req.signal) : Promise.resolve('')))
          const chunkToN = note.chunks.map((c, k) => {
            if (!resolved[k]) return null
            const hint = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(c.title) ? c.title : undefined
            const host = hint ?? hostOf(resolved[k])
            return registry.add({ title: host, url: resolved[k], kind: 'web', hostHint: host }).n
          })
          webNotes.push({ question: questions[i], text: annotate(note, chunkToN) })
        }
        const paperLines = scholarly.map(p => `[${registry.add({ title: p.title, url: p.url, kind: 'scholarly' }).n}] ${p.title}. ${p.line}`)
        const refLines = reference.map(r => `[${registry.add({ title: r.title, url: r.url, kind: 'reference' }).n}] ${r.title}: ${r.extract}`)

        const sources = registry.list
        if (sources.length === 0) {
          emit('I could not find reliable sources for this question just now, so I will not guess. Try rewording the question with more specific names, dates or places, or try again in a moment.', 'AURA · Research')
          sse(controller, { done: true }); controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); return
        }

        const pack = [
          webNotes.length ? `WEB RESEARCH NOTES (numbers show which source supports each sentence)\n${webNotes.map(n => `### ${n.question}\n${n.text}`).join('\n\n')}` : '',
          paperLines.length ? `ACADEMIC PAPERS (peer-reviewed or preprint)\n${paperLines.join('\n')}` : '',
          refLines.length ? `REFERENCE BACKGROUND (encyclopedia, general context only)\n${refLines.join('\n')}` : '',
          `SOURCE QUALITY (judged by type of website, not by fact-checking)\n${sources.map(s => `[${s.n}] ${s.host}: ${TIER_LABEL[s.tier]}`).join('\n')}`,
        ].filter(Boolean).join('\n\n')

        const userPrompt = `Today is ${new Date().toDateString()}.\nQuestion: ${question}\n${context ? `Earlier in the conversation:\n${context}\n` : ''}\n${pack}\n\nWrite the report now.`

        status(`Writing the report from ${sources.length} source${sources.length === 1 ? '' : 's'}`)
        let report = ''
        let engine = 'AURA · Research'
        let streamed = false
        if (geminiKey) {
          try {
            const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
              signal: req.signal,
              body: JSON.stringify({
                system_instruction: { parts: [{ text: REPORT_SYSTEM }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 6000 },
              }),
            })
            if (res.ok && res.body) {
              const reader = res.body.getReader()
              const decoder = new TextDecoder()
              let buf = ''
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                const lines = buf.split('\n'); buf = lines.pop() || ''
                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue
                  try {
                    const parts = (JSON.parse(line.slice(6)).candidates?.[0]?.content?.parts ?? []) as { text?: string; thought?: boolean }[]
                    const t = parts.filter(p => !p.thought).map(p => p.text ?? '').join('')
                    if (t) { report += t; streamed = true; emit(t, engine) }
                  } catch { /* skip malformed frame */ }
                }
              }
            }
          } catch (e) { if (req.signal.aborted) throw e }
        }
        if (!report) {
          report = await writeWithFallback(REPORT_SYSTEM, userPrompt, origin, req.signal)
          if (report) { engine = 'AURA · Research (backup model)'; emit(report, engine) }
        }
        if (!report) {
          emit('I gathered sources but could not write the report just now. Please try again in a moment.', engine)
        } else {
          // Sources are built here from what was actually found, so a link can never be made up by the model.
          const cited = new Set([...report.matchAll(/\[(\d{1,3})\]/g)].map(m => Number(m[1])))
          const used: Source[] = sources.filter(s => cited.has(s.n))
          const shown = used.length ? used : sources
          const list = shown.map(s => `[${s.n}] [${s.title.replace(/[\[\]]/g, '')}](${s.url}) (${s.host}, ${TIER_LABEL[s.tier]})`).join('\n\n')
          emit(`\n\n---\n\n## Sources\n\n${list}\n\nSource labels describe the type of website. They are not a fact-check, so confirm important claims in the originals.`, engine)
        }
        void streamed
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        if (req.signal.aborted) { try { controller.close() } catch { /* already closed */ } return }
        console.error('[research] failed:', error instanceof Error ? error.message : error)
        try {
          emit('Research failed part way through. Please try again.', 'AURA · Research')
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        } catch { /* stream already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
