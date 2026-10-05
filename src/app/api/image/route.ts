import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 90

// Strip common intent prefixes so the model gets a clean subject
function cleanPrompt(raw: string): string {
  const cleaned = raw
    .replace(/^(generate|create|make|draw|paint|show|render|design|produce|give me|can you (make|create|generate|draw))\s+(me\s+)?(a|an|the|some)?\s*(image|photo|picture|illustration|artwork|painting|drawing|portrait|wallpaper|poster|logo|icon|banner)\s+(of\s+)?/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .trim()
  return cleaned || raw.trim()
}

// Ask local Ollama to enrich the prompt with quality/realism keywords
async function enhancePrompt(subject: string, signal: AbortSignal): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    signal.addEventListener('abort', () => controller.abort(), { once: true })

    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gemma3:4b',
        stream: false,
        options: { temperature: 0.4, num_predict: 80 },
        messages: [
          {
            role: 'system',
            content:
              'You are a Stable Diffusion prompt engineer. Given a short image subject, output ONLY an enhanced prompt: add photorealism, lighting, camera, and environment detail keywords. NEVER add words about faces, mouths, lips, hands, or human anatomy to animal or nature subjects. Output the prompt text only — no explanation, no quotes, no extra text. Keep it under 75 words.',
          },
          { role: 'user', content: subject },
        ],
      }),
    })
    clearTimeout(timeout)

    if (!res.ok) return subject
    const json = await res.json()
    const enhanced: string = json.message?.content?.trim() ?? ''
    if (enhanced && enhanced.length > 4) {
      console.log('[image proxy] enhanced prompt:', enhanced)
      return enhanced
    }
    return subject
  } catch {
    return subject
  }
}

// Generate via Hugging Face Router -> nscale provider -> FLUX.1-schnell
// Returns: ArrayBuffer of PNG/JPEG bytes, or null on failure
async function generateWithHF(prompt: string, hfKey: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 75_000)
    signal.addEventListener('abort', () => controller.abort(), { once: true })

    console.log('[image proxy] using HF router/nscale FLUX.1-schnell')
    // nscale provider returns { data: [{ b64_json: "..." }] }
    const res = await fetch('https://router.huggingface.co/nscale/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell',
        prompt,
        width: 1024,
        height: 1024,
        steps: 4,
        n: 1,
      }),
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[image proxy] HF/nscale error:', res.status, err.slice(0, 200))
      return null
    }

    const ct = res.headers.get('content-type') ?? ''

    // Binary image response
    if (ct.startsWith('image/')) {
      return await res.arrayBuffer()
    }

    // JSON response with base64 image data
    if (ct.includes('json')) {
      const json = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> }
      const item = json.data?.[0]
      if (item?.b64_json) {
        const binaryStr = atob(item.b64_json)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
        return bytes.buffer
      }
      if (item?.url) {
        // Fetch the URL
        const imgRes = await fetch(item.url, { signal: controller.signal })
        if (imgRes.ok) return await imgRes.arrayBuffer()
      }
      console.error('[image proxy] HF/nscale unexpected JSON shape:', JSON.stringify(json).slice(0, 200))
      return null
    }

    console.error('[image proxy] HF/nscale unexpected content-type:', ct)
    return null
  } catch (e) {
    console.error('[image proxy] HF threw:', e instanceof Error ? e.message : e)
    return null
  }
}

// Fallback: generate via Pollinations (free, no key, lower quality)
async function generateWithPollinations(prompt: string, seed: string, width: string, height: string, signal: AbortSignal): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 85_000)
    signal.addEventListener('abort', () => controller.abort(), { once: true })

    const negative = 'human face, mouth, lips, teeth, hands, fingers, distorted anatomy, ugly, deformed, extra limbs, watermark'
    const upstream = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nofeed=true&model=sana&negative=${encodeURIComponent(negative)}`
    console.log('[image proxy] fallback Pollinations:', upstream)

    const res = await fetch(upstream, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[image proxy] Pollinations error:', res.status, body.slice(0, 200))
      return null
    }

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    if (!contentType.startsWith('image/')) return null

    return { buffer: await res.arrayBuffer(), contentType }
  } catch (e) {
    console.error('[image proxy] Pollinations threw:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function GET(req: NextRequest) {
  const rawPrompt = req.nextUrl.searchParams.get('prompt')
  if (!rawPrompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })

  const subject = cleanPrompt(rawPrompt)
  const rawSeed = parseInt(req.nextUrl.searchParams.get('seed') ?? String(Date.now()), 10)
  const seed = String(rawSeed % 2147483647)
  const width = req.nextUrl.searchParams.get('w') ?? '1024'
  const height = req.nextUrl.searchParams.get('h') ?? '768'

  // Enhance prompt via local LLM (max 8s, non-blocking fallback)
  const prompt = await enhancePrompt(subject, req.signal)

  const hfKey = process.env.HF_API_KEY?.trim() ?? ''

  if (hfKey) {
    const buffer = await generateWithHF(prompt, hfKey, req.signal)
    if (buffer) {
      // Detect image type from magic bytes: PNG starts with 0x89 0x50, JPEG with 0xFF 0xD8
      const bytes = new Uint8Array(buffer)
      const contentType = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(buffer.byteLength),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }
    console.warn('[image proxy] HF failed, falling back to Pollinations')
  }

  // Fallback to Pollinations
  const result = await generateWithPollinations(prompt, seed, width, height, req.signal)
  if (result) {
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.buffer.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  return NextResponse.json({ error: 'Image generation failed on all backends' }, { status: 502 })
}
