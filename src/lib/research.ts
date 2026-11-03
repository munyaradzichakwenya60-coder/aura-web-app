// Deep-research helpers: source registry, source-quality tiers, and scholarly/reference lookups.
// Source quality is judged by the kind of website only. It is a guide, not a fact-check.

export type Tier = 'high' | 'medium' | 'low'

export type Source = {
  n: number
  title: string
  url: string
  host: string
  tier: Tier
  kind: 'web' | 'scholarly' | 'reference'
  note?: string
}

export const TIER_LABEL: Record<Tier, string> = {
  high: 'official or peer-reviewed',
  medium: 'established outlet or reference',
  low: 'unverified, check it yourself',
}

const HIGH_SUFFIX = /\.(gov|edu|mil)(\.[a-z]{2})?$|\.ac\.[a-z]{2}$|\.gov\.[a-z]{2}$/i
const HIGH_HOSTS = [
  'who.int', 'un.org', 'unesco.org', 'unicef.org', 'worldbank.org', 'imf.org', 'oecd.org', 'europa.eu',
  'nih.gov', 'nasa.gov', 'cdc.gov', 'nature.com', 'science.org', 'sciencedirect.com', 'springer.com',
  'thelancet.com', 'bmj.com', 'jstor.org', 'arxiv.org', 'plos.org', 'ieee.org', 'acm.org', 'cambridge.org',
  'oup.com', 'academic.oup.com', 'wiley.com', 'tandfonline.com', 'pnas.org', 'cell.com', 'doi.org',
  'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'zimstat.co.zw', 'sadc.int', 'au.int', 'hexco.co.zw',
  'openalex.org', 'crossref.org', 'semanticscholar.org',
]
const MEDIUM_HOSTS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com', 'nytimes.com', 'economist.com',
  'ft.com', 'wikipedia.org', 'britannica.com', 'aljazeera.com', 'dw.com', 'npr.org', 'bloomberg.com',
  'khanacademy.org', 'smithsonianmag.com', 'nationalgeographic.com', 'scientificamerican.com',
  'herald.co.zw', 'chronicle.co.zw', 'newsday.co.zw',
]

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').toLowerCase() }
}

function matches(host: string, list: string[]): boolean {
  return list.some(h => host === h || host.endsWith(`.${h}`))
}

export function tierFor(host: string, kind: Source['kind']): Tier {
  if (kind === 'scholarly') return 'high'
  if (HIGH_SUFFIX.test(host) || matches(host, HIGH_HOSTS)) return 'high'
  if (matches(host, MEDIUM_HOSTS)) return 'medium'
  return 'low'
}

/** Numbers sources once, so the same page found by two searches keeps one citation number. */
export class SourceRegistry {
  private byKey = new Map<string, Source>()
  readonly list: Source[] = []

  add(input: { title: string; url: string; kind: Source['kind']; note?: string; hostHint?: string }): Source {
    const host = input.hostHint ? input.hostHint.toLowerCase() : hostOf(input.url)
    const key = input.url.split('#')[0].replace(/\/$/, '')
    const existing = this.byKey.get(key)
    if (existing) return existing
    const source: Source = {
      n: this.list.length + 1,
      title: input.title.trim().slice(0, 160) || host,
      url: input.url,
      host,
      tier: tierFor(host, input.kind),
      kind: input.kind,
      note: input.note,
    }
    this.byKey.set(key, source)
    this.list.push(source)
    return source
  }
}

function withTimeout(ms: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms)
  return parent ? AbortSignal.any([parent, t]) : t
}

/** Google grounding returns redirect links. Follow one hop to show the real address. */
export async function resolveRedirect(uri: string, signal?: AbortSignal): Promise<string> {
  if (!uri.includes('vertexaisearch.cloud.google.com')) return uri
  try {
    const res = await fetch(uri, { method: 'GET', redirect: 'manual', signal: withTimeout(3_000, signal), headers: { 'User-Agent': 'Mozilla/5.0' } })
    const loc = res.headers.get('location')
    if (loc && /^https?:\/\//i.test(loc)) return loc
  } catch { /* keep the redirect link */ }
  return uri
}

function abstractFrom(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return ''
  const words: string[] = []
  for (const [word, positions] of Object.entries(inv)) for (const pos of positions) words[pos] = word
  return words.filter(Boolean).join(' ').slice(0, 700)
}

type OpenAlexWork = {
  title?: string
  doi?: string | null
  publication_year?: number
  cited_by_count?: number
  type?: string
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string } | null } | null
  authorships?: { author?: { display_name?: string } }[]
  abstract_inverted_index?: Record<string, number[]> | null
}

export type ScholarlyHit = { title: string; url: string; line: string }

/** Peer-reviewed literature from OpenAlex (free, no key). */
export async function searchScholarly(query: string, signal?: AbortSignal): Promise<ScholarlyHit[]> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=6&sort=relevance_score:desc&filter=has_abstract:true,type:article|review|preprint&select=title,doi,publication_year,cited_by_count,type,primary_location,authorships,abstract_inverted_index&mailto=aura@intelliaura.vercel.app`
    const res = await fetch(url, { signal: withTimeout(6_000, signal), headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const json = await res.json() as { results?: OpenAlexWork[] }
    return (json.results ?? []).filter(w => w.title && (w.doi || w.primary_location?.landing_page_url)).slice(0, 4).map(w => {
      const authors = (w.authorships ?? []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ')
      const venue = w.primary_location?.source?.display_name
      const abs = abstractFrom(w.abstract_inverted_index)
      return {
        title: w.title as string,
        url: (w.doi || w.primary_location?.landing_page_url) as string,
        line: `${authors ? `${authors}. ` : ''}${w.publication_year ?? 'n.d.'}${venue ? `. ${venue}` : ''}. Cited by ${w.cited_by_count ?? 0}. ${abs ? `Abstract: ${abs}` : ''}`,
      }
    })
  } catch { return [] }
}

export type ReferenceHit = { title: string; url: string; extract: string }

/** Background context from Wikipedia. Treated as medium quality, never as the final word. */
export async function searchReference(query: string, signal?: AbortSignal): Promise<ReferenceHit[]> {
  try {
    const s = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=2`, { signal: withTimeout(4_000, signal), headers: { 'User-Agent': 'AURA-study-assistant/1.0' } })
    if (!s.ok) return []
    const pages = ((await s.json()) as { pages?: { title: string; key: string }[] }).pages ?? []
    const out: ReferenceHit[] = []
    for (const page of pages.slice(0, 2)) {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`, { signal: withTimeout(4_000, signal), headers: { 'User-Agent': 'AURA-study-assistant/1.0' } })
      if (!r.ok) continue
      const j = await r.json() as { extract?: string; content_urls?: { desktop?: { page?: string } } }
      if (j.extract && j.content_urls?.desktop?.page) out.push({ title: `${page.title} (Wikipedia)`, url: j.content_urls.desktop.page, extract: j.extract.slice(0, 900) })
    }
    return out
  } catch { return [] }
}

type Grounded = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[]
      groundingSupports?: { segment?: { endIndex?: number }; groundingChunkIndices?: number[] }[]
    }
  }[]
}

export type GroundedNote = { text: string; chunks: { uri: string; title: string }[]; supports: { end: number; idx: number[] }[] }

/** One Google-grounded answer for a sub-question, with which web pages back which sentences. */
export async function groundedSearch(apiKey: string, question: string, signal?: AbortSignal): Promise<GroundedNote | null> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: withTimeout(25_000, signal),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a research assistant. Answer the question with specific facts, figures, dates and names. Prefer official, academic and primary sources. If sources disagree, say so. Be concise and do not speculate.' }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
      }),
    })
    if (!res.ok) return null
    const json = await res.json() as Grounded
    const cand = json.candidates?.[0]
    const text = (cand?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('').trim()
    if (!text) return null
    const chunks = (cand?.groundingMetadata?.groundingChunks ?? []).map(c => ({ uri: c.web?.uri ?? '', title: c.web?.title ?? '' }))
    const supports = (cand?.groundingMetadata?.groundingSupports ?? []).map(s => ({ end: s.segment?.endIndex ?? 0, idx: s.groundingChunkIndices ?? [] }))
    return { text, chunks, supports }
  } catch { return null }
}

/** Inserts [n] markers into a grounded answer at the sentences each source supports. */
export function annotate(note: GroundedNote, chunkToN: (number | null)[]): string {
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const bytes = enc.encode(note.text)
  const inserts = note.supports
    .map(s => ({ end: s.end, tags: [...new Set(s.idx.map(i => chunkToN[i]).filter((n): n is number => typeof n === 'number'))] }))
    .filter(s => s.tags.length > 0 && s.end > 0 && s.end <= bytes.length)
    .sort((a, b) => b.end - a.end)
  let out = bytes
  for (const ins of inserts) {
    const marker = enc.encode(ins.tags.map(n => `[${n}]`).join(''))
    const merged = new Uint8Array(out.length + marker.length)
    merged.set(out.slice(0, ins.end), 0)
    merged.set(marker, ins.end)
    merged.set(out.slice(ins.end), ins.end + marker.length)
    out = merged
  }
  return dec.decode(out)
}
