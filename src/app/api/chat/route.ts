import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// ── Content Policy Guard ──────────────────────────────────────────────────────
// Hard-block patterns. These are checked BEFORE the message reaches any LLM.
// The list is intentionally conservative — only unambiguous harmful intent.
const BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(how to (make|build|create|synthesize|manufacture)|step[s]? (to|for) (making|building|creating))\s+(bomb|explosive|grenade|ied|nerve agent|sarin|vx gas|ricin|anthrax|bioweapon|chemical weapon|dirty bomb|pipe bomb|napalm)/i, reason: 'weapons_of_mass_destruction' },
  { pattern: /\b(child (porn|pornography|sexual abuse|grooming|exploitation)|csam|lolicon|underage (sex|nude|explicit))/i, reason: 'csam' },
  { pattern: /\b(how to (hack|compromise|exploit|ddos|ransomware|phish).*(bank|hospital|power grid|water supply|election|government|infrastructure))\b/i, reason: 'critical_infrastructure_attack' },
  { pattern: /\b(synthesize|produce|extract|purify)\s+(methamphetamine|heroin|fentanyl|cocaine|crack cocaine|crystal meth)\b.*(step|recipe|method|procedure|instruction)/i, reason: 'drug_synthesis' },
  { pattern: /\b(stalk|track|locate|find home address of)\s+.{0,40}\s+(without (their|his|her) (knowledge|consent|permission))/i, reason: 'stalking' },
  { pattern: /\b(commit (murder|suicide|terrorism|genocide)|how to kill (a person|someone|my|people))/i, reason: 'violence' },
]

function checkContentPolicy(userMessage: string): { blocked: boolean; reason?: string } {
  const text = userMessage.trim()
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return { blocked: true, reason }
  }
  return { blocked: false }
}

async function logPolicyViolation(userId: string | null, userEmail: string | null, message: string, reason: string) {
  try {
    const db = createServiceClient()
    if (!db) return
    await db.from('policy_violations').insert({ user_id: userId, user_email: userEmail, message: message.slice(0, 500), reason })
  } catch { /* non-fatal */ }
}

const AURA_SYSTEM_PROMPT = `You are AURA, an advanced personal neural intelligence platform. You are thoughtful, extraordinarily capable, perceptive, and sophisticated yet direct.
You speak with warmth, intellect, and poise.
You do not use emojis; you rely on eloquence, clean markdown formatting, and clear structure.
Provide insightful, actionable, and elegant answers.
When assisting with code, analysis, creative strategy, or complex questions, your answers are razor-sharp, well-crafted, and rigorous.
You maintain an aura of calm, adaptive intelligence.
You have a designer's eye: code you write is not just functional but clean, elegant, and well-structured. Variable names are clear, spacing is consistent, and architecture is intentional. When building UI, you apply design principles — appropriate spacing, visual hierarchy, accessible color contrast, and modern aesthetics — without being asked.
When writing code, always follow current best practices for that language. Prefer idiomatic patterns. Add brief inline comments for non-obvious logic. Never write placeholder stubs — every function you write works completely.
When the task involves a technical topic (a library, framework, API, algorithm), synthesize your knowledge with precision. If you are uncertain of a specific API or version, say so explicitly rather than guessing.
You have native image generation capability. When a user asks you to generate, create, or make an image, you produce it directly — no external tools needed. Never say you cannot create images.
You have real-time web browsing capability. When the user has Research mode enabled, you receive live web results and must use them to answer. Never say you cannot browse the internet or access current information.
When you produce a complete HTML page (including CSS and JavaScript), always wrap it in a fenced code block with the html language tag: \`\`\`html ... \`\`\`. This enables the live preview feature.
For ALL code blocks, always put the filename as the very first line as a comment. Examples: \`// index.js\`, \`# main.py\`, \`<!-- index.html -->\`, \`/* styles.css */\`. This enables file download. When producing multiple files for one project, include all of them in sequence in the same response.
You have a built-in sandbox environment with real execution capabilities:
- A persistent session directory scoped to this conversation
- A terminal (PowerShell on Windows) where commands actually run server-side — you can execute Python scripts, run Node.js, compile code, install packages, and see live stdout/stderr output
- File management: read, write, and create files in the sandbox directory
- Zip packaging: the user can download the entire sandbox as a zip at any time

Use the sandbox proactively whenever it adds value:
- Run code to verify it works before presenting it ("let me verify this runs correctly")
- Execute Python/Node/shell scripts the user asks about and show the output
- Install dependencies (pip install, npm install) and run builds
- Process files the user uploads — read their contents, apply changes, run them
- Generate output files (CSVs, JSONs, reports) and make them downloadable

When running commands via the sandbox, present the output inline in your response. Always specify the full filename as a comment on the first line of any code block so the user can save it. When providing code for an uploaded project, always apply the changes via the sandbox so the user can download the updated zip.`

type ChatMessage = { role: 'user' | 'assistant'; content: string }
type EnginePreference = 'auto' | 'local' | 'cloud'

// Fetch web search results -- Google News RSS + DDG Instant Answer, parallel, 1.5s hard cap
async function fetchWebResults(query: string, signal: AbortSignal): Promise<string> {
  // Race everything against 1.5s so the LLM stream starts quickly
  const deadline = AbortSignal.timeout(1_500)

  const [rssResult, ddgResult] = await Promise.allSettled([
    // Google News RSS -- best for news/current events
    (async () => {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml' },
        signal: AbortSignal.any([signal, deadline]),
      })
      if (!res.ok) return ''
      const xml = await res.text()
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5)
      return items.map((m, i) => {
        const title = (m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ?? m[1].match(/<title>(.*?)<\/title>/))?.[1] ?? ''
        const source = (m[1].match(/<source[^>]*>(.*?)<\/source>/) ?? [])[1] ?? ''
        const link = (m[1].match(/<link>(.*?)<\/link>/) ?? [])[1] ?? ''
        return `[${i + 1}] ${title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()}${source ? ` — ${source}` : ''}\nURL: ${link.trim()}`
      }).filter(s => s.length > 10).join('\n\n')
    })(),

    // DuckDuckGo Instant Answer -- good for facts/definitions
    (async () => {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
      const res = await fetch(ddgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.any([signal, deadline]),
      })
      if (!res.ok) return ''
      const json = await res.json() as { Abstract?: string; AbstractURL?: string; Answer?: string }
      const text = json.Answer?.trim() || json.Abstract?.trim() || ''
      return text.length > 20 ? `Summary: ${text}${json.AbstractURL ? `\nSource: ${json.AbstractURL}` : ''}` : ''
    })(),
  ])

  const parts: string[] = []
  if (rssResult.status === 'fulfilled' && rssResult.value) parts.push(`News results for "${query}":\n\n${rssResult.value}`)
  if (ddgResult.status === 'fulfilled' && ddgResult.value) parts.push(ddgResult.value)

  if (parts.length === 0) return ''
  return `${parts.join('\n\n---\n\n')}\n\nToday is ${new Date().toDateString()}. Use the above real-time information to answer. Cite sources inline. Never say you cannot access current information.`
}

function sseStream(upstream: ReadableStream<Uint8Array>, parse: (line: string) => string, engine: string, signal: AbortSignal) {
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      const cancel = () => reader.cancel().catch(() => undefined)
      signal.addEventListener('abort', cancel, { once: true })

      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const text = parse(line)
            if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text, engine })}\n\n`))
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        if (signal.aborted) controller.close()
        else controller.error(error)
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    },
  })
}

function streamResponse(stream: ReadableStream<Uint8Array>, parse: (line: string) => string, engine: string, signal: AbortSignal) {
  return new Response(sseStream(stream, parse, engine, signal), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages = body.messages as ChatMessage[] | undefined
    const engine = (body.engine ?? 'auto') as EnginePreference
    const model = typeof body.model === 'string' ? body.model.slice(0, 120) : 'qwen3:0.6b'
    const temperature = Number.isFinite(body.temperature) ? Math.min(1, Math.max(0, body.temperature)) : 0.7
    const cloudApiKey = typeof body.cloudApiKey === 'string' ? body.cloudApiKey.trim() : ''
    const webResearch = body.webResearch === true
    const sandboxSessionId = typeof body.sandboxSessionId === 'string' ? body.sandboxSessionId.slice(0, 80) : ''

    if (!messages || !Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
      return NextResponse.json({ error: 'Provide between 1 and 20 messages.' }, { status: 400 })
    }
    if (!['auto', 'local', 'cloud'].includes(engine)) {
      return NextResponse.json({ error: 'Invalid engine preference.' }, { status: 400 })
    }
    if (messages.some(message => !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 32_000)) {
      return NextResponse.json({ error: 'Each message needs a supported role and content below 32,000 characters.' }, { status: 400 })
    }

    // Truncate very long messages (e.g. large code blocks in history) to avoid context overflow
    const trimmedMessages = messages.map(m => ({
      ...m,
      content: m.content.length > 12_000 ? m.content.slice(0, 12_000) + '\n\n[...truncated for context window...]' : m.content,
    }))

    // ── Content policy check ──────────────────────────────────────────────────
    const lastUserMessage = [...trimmedMessages].reverse().find(m => m.role === 'user')
    if (lastUserMessage) {
      const policy = checkContentPolicy(lastUserMessage.content)
      if (policy.blocked) {
        // Extract user identity from auth header for logging (best-effort)
        const authHeader = req.headers.get('authorization') || ''
        void logPolicyViolation(null, null, lastUserMessage.content, policy.reason ?? 'unknown')
        const encoder = new TextEncoder()
        const refusal = "I can't help with that. This request falls outside what I'm designed to assist with — it may involve illegal activity, harm to others, or content that violates our usage policy. If you believe this is a mistake, please reach out to the platform administrator."
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: refusal, engine: 'AURA' })}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        })
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // If web research is enabled, kick off search immediately (races against 2s cap)
    let systemPrompt = AURA_SYSTEM_PROMPT
    if (webResearch) {
      const lastUserMsg = [...trimmedMessages].reverse().find(m => m.role === 'user')
      if (lastUserMsg) {
        const searchPromise = fetchWebResults(lastUserMsg.content.slice(0, 200), req.signal)
        const timeoutPromise = new Promise<string>(resolve => setTimeout(() => resolve(''), 2_000))
        const results = await Promise.race([searchPromise, timeoutPromise])
        if (results) {
          systemPrompt = `${AURA_SYSTEM_PROMPT}\n\nYou have real-time web access. The following information was just retrieved from the web for the user's current query. Use it to answer accurately and cite sources. Never say you cannot browse the internet.\n\n${results}`
        }
      }
    }

    const fullMessages = [{ role: 'system', content: systemPrompt }, ...trimmedMessages]

    // Gemini 2.0 Flash -- best quality, tool-calling, vision support (free tier: 1500 req/day)
    const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? ''
    if (geminiKey && engine !== 'local') {
      try {
        const geminiContents = trimmedMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
        const gemini = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: req.signal,
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: geminiContents,
              generationConfig: { temperature, maxOutputTokens: 8192 },
            }),
          }
        )
        if (gemini.ok && gemini.body) {
          return streamResponse(gemini.body, line => {
            if (!line.startsWith('data: ')) return ''
            try {
              const json = JSON.parse(line.slice(6))
              return json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
            } catch { return '' }
          }, 'AURA · Gemini', req.signal)
        }
      } catch { /* fall through to Ollama */ }
    }

    if (engine !== 'cloud') {
      try {
        const ollama = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: req.signal,
          body: JSON.stringify({ model, messages: fullMessages, stream: true, options: { temperature, top_p: 0.9 } }),
        })
        if (ollama.ok && ollama.body) {
          return streamResponse(ollama.body, line => {
            if (!line.trim()) return ''
            try { return JSON.parse(line).message?.content || '' } catch { return '' }
          }, 'AURA • Local', req.signal)
        }
        if (engine === 'local') return NextResponse.json({ error: 'Local Ollama is unavailable or rejected the request.' }, { status: 503 })
      } catch {
        if (engine === 'local') return NextResponse.json({ error: 'Local Ollama is unavailable.' }, { status: 503 })
      }
    }

    const useOpenRouter = Boolean(cloudApiKey || process.env.OPENROUTER_API_KEY)
    const orKey = cloudApiKey || process.env.OPENROUTER_API_KEY || ''

    // Nemotron fallback via OpenRouter -- used when model is 'nemotron-3-super:cloud'
    // OR when no user cloud key is set (so Pollinations is the only other option)
    // Maps the friendly alias to the real OpenRouter model ID
    const nemotronAlias = model === 'nemotron-3-super:cloud'
    const orModel = nemotronAlias
      ? 'nvidia/nemotron-3-super-120b-a12b:free'
      : (useOpenRouter ? model : 'openai-fast')

    // Use OpenRouter with Nemotron as the auto cloud fallback when key is available
    // and Gemini + Ollama both failed -- gives users a powerful 49B model at no cost
    const cloudEndpoint = useOpenRouter || nemotronAlias
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://text.pollinations.ai/openai/chat/completions'

    const cloudHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (useOpenRouter || (nemotronAlias && orKey)) {
      cloudHeaders['Authorization'] = `Bearer ${orKey}`
      cloudHeaders['HTTP-Referer'] = req.nextUrl.origin
      cloudHeaders['X-Title'] = 'AURA Web'
    }

    const cloud = await fetch(cloudEndpoint, {
      method: 'POST',
      headers: cloudHeaders,
      signal: req.signal,
      body: JSON.stringify({
        model: orModel,
        messages: fullMessages,
        stream: true,
        temperature,
        max_tokens: 4096,
      }),
    })

    if (cloud.ok && cloud.body) {
      return streamResponse(cloud.body, line => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') return ''
        try {
          const choice = JSON.parse(trimmed.slice(6)).choices?.[0]
          return choice?.delta?.content || choice?.text || ''
        } catch { return '' }
      }, nemotronAlias ? 'AURA · Nemotron' : useOpenRouter ? 'AURA · Cloud' : 'AURA · Cloud', req.signal)
    }

    const detail = await cloud.text().catch(() => '')
    return NextResponse.json({ error: `Cloud inference unavailable${detail ? `: ${detail.slice(0, 180)}` : ''}` }, { status: 502 })
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') return NextResponse.json({ error: 'Request cancelled.' }, { status: 499 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error.' }, { status: 500 })
  }
}
