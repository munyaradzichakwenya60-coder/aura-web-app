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

export function checkContentPolicy(userMessage: string): { blocked: boolean; reason?: string } {
  const text = userMessage.trim()
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return { blocked: true, reason }
  }
  return { blocked: false }
}

