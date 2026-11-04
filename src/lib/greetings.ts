// Home-screen greetings. The name line is fixed; the lead-in and the line under it are picked here.
// The "topic" is inferred only from the user's own chats stored in their browser. Nothing is sent anywhere.

export type Topic = 'code' | 'maths' | 'writing' | 'science' | 'business' | ''

const TOPIC_WORDS: Record<Exclude<Topic, ''>, RegExp> = {
  code: /\b(code|coding|function|bug|error|debug|react|next\.?js|python|javascript|typescript|html|css|api|deploy|database|sql|github|npm|component)\b/gi,
  maths: /\b(solve|equation|calculus|algebra|integral|derivative|geometry|trigonometry|probability|statistics|maths?|theorem|proof)\b/gi,
  writing: /\b(essay|paragraph|summar(y|ise|ize)|rewrite|proofread|draft|thesis|report|assignment|introduction|conclusion)\b/gi,
  science: /\b(biology|chemistry|physics|cell|atom|molecule|reaction|photosynthesis|energy|organism|experiment)\b/gi,
  business: /\b(marketing|budget|pitch|customer|revenue|startup|business plan|invoice|strategy|sales|profit)\b/gi,
}

/** Looks at the user's recent messages and returns the subject they bring up most, or '' if it is not clear. */
export function inferTopic(userMessages: string[]): Topic {
  const text = userMessages.slice(-40).join(' \n ').slice(0, 20_000)
  if (text.length < 20) return ''
  let best: Topic = ''
  let bestCount = 0
  for (const key of Object.keys(TOPIC_WORDS) as Exclude<Topic, ''>[]) {
    const count = (text.match(TOPIC_WORDS[key]) ?? []).length
    if (count > bestCount) { best = key; bestCount = count }
  }
  return bestCount >= 3 ? best : ''
}

const ROLE_LEADS: Record<string, string[]> = {
  student: ['Ready to study,', "Let's get revising,", 'Hey there,'],
  developer: ['What are we building,', "What's broken today,", 'Ready to ship,'],
  business: ["Let's get to work,", 'Good to see you,', 'Ready when you are,'],
  personal: ["What's on your mind,", "What's cooking,", 'Welcome back,'],
}

const ROLE_SUBS: Record<string, string[]> = {
  student: ['What are we studying today?', 'Got a topic or notes to go through?', 'Want to quiz yourself before your next test?', 'What should we revise first?'],
  developer: ['What are you working on?', 'Got a bug or an idea to dig into?', 'Paste an error or describe the feature.', 'What are we shipping today?'],
  business: ['What are we working through today?', 'Need a plan, a summary or a second opinion?', 'What decision are you weighing?', 'What should we tackle first?'],
  personal: ['What can I help you figure out?', 'Anything you want to learn or plan?', 'What would you like to explore today?', 'Ask me anything, big or small.'],
}

const TOPIC_SUBS: Record<Exclude<Topic, ''>, string[]> = {
  code: ['Back to the code? Paste what you have.', 'Picking up where the coding left off?', 'Got an error or a feature to talk through?'],
  maths: ['More maths today? Show me the problem.', 'Stuck on a problem? Share the working.', 'Want to practise a few questions?'],
  writing: ['Working on some writing? Share a draft.', 'Need help planning or tightening a piece?', 'Got an essay or report to shape up?'],
  science: ['More science today? Pick a topic.', 'Want a concept explained, then a quick quiz?', 'Which topic should we break down?'],
  business: ['Got a plan or pitch to work on?', 'Want to think through a decision together?', 'What are we planning today?'],
}

const GENERIC_LEADS = ["What's cooking,", "What's on your mind,", 'Welcome back,', 'Ready when you are,', 'Hey there,', "Let's get into it,", 'Good to see you,']
const GENERIC_SUBS = ['What would you like to study today?', 'What are we learning today?', 'Pick a topic and we will dig in.', 'Got notes you want to go through?', 'What do you want to understand better?', 'What should we tackle first?']

function pick<T>(list: T[], rand: () => number): T { return list[Math.floor(rand() * list.length)] }

export function pickGreeting(opts: { hour: number; role?: string; topic?: Topic; rand?: () => number }): { lead: string; sub: string } {
  const rand = opts.rand ?? Math.random
  const role = opts.role && ROLE_LEADS[opts.role] ? opts.role : ''
  const timeLead = opts.hour < 12 ? 'Good morning' : opts.hour < 17 ? 'Good afternoon' : 'Good evening'

  // The time-of-day greeting shows about a third of the time, the rest are role-based or generic.
  const leads = [timeLead, timeLead, ...(role ? [...ROLE_LEADS[role], ...ROLE_LEADS[role]] : []), ...GENERIC_LEADS]
  const lead = pick(leads, rand)

  // Under the name: a topic line when we know what they usually work on, otherwise a role line, otherwise generic.
  let subs: string[] = GENERIC_SUBS
  if (opts.topic && rand() < 0.6) subs = TOPIC_SUBS[opts.topic]
  else if (role) subs = ROLE_SUBS[role]
  return { lead, sub: pick(subs, rand) }
}
