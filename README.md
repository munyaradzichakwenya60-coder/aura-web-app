# AURA — Adaptive Unified Reasoning Assistant

> A next-generation, full-stack AI chat platform that makes powerful AI accessible, personal, and production-ready.

---

## The Problem AURA Solves

Most AI assistants today fall into one of two failure modes:

1. **Too generic** — they respond the same way to a student as to a senior engineer, the same way to a creative writer as to a data scientist. There is no personalization, no memory, no sense of who is actually on the other side.
2. **Too locked down** — the best models (GPT-4, Claude) are API-only, paywalled, or embedded in siloed products. Developers cannot customize the stack, inspect what's happening, or own their data.

AURA is built on the belief that AI should be:
- **Personal** — it knows your name, your use case, and adapts to you
- **Capable** — real web research, image generation, code execution, file management, all in one place
- **Open** — you choose the model (local or cloud), you own your data via Supabase, you control the keys
- **Safe** — content policy enforcement, role-based access, audit logs — so it can be shared with real users, not just developers

---

## What AURA Does

### 🤖 Multi-Model AI Chat
- **Primary**: Google Gemini 2.5 Flash (free, 1500 req/day, vision + tool calling)
- **Fallback 1**: Ollama local models (runs entirely on-device, zero cost, full privacy)
- **Fallback 2**: NVIDIA Nemotron 120B via OpenRouter (free tier, state-of-the-art reasoning)
- **Fallback 3**: Pollinations cloud (always-on, no key required)
- Automatic cascade — if one is overloaded or unavailable, the next kicks in silently

### 🔍 Real-Time Web Research
- Toggle Research mode or let AURA auto-detect when a question needs current information
- Fetches live results from Google News RSS + DuckDuckGo Instant Answers
- 3-second budget cap so responses are never blocked waiting for search
- Auto-triggers on: news questions, coding documentation lookups, current events

### 🖼️ AI Image Generation
- Powered by FLUX.1-schnell via Hugging Face Inference API (nscale provider)
- Automatic prompt enhancement via local LLM before sending to the image model
- Negative prompt injection to prevent anatomy artifacts
- Image revision history with carousel navigation

### 💻 Multi-Language Code Preview & Execution
- In-browser live preview for: HTML, CSS, JavaScript, TypeScript, Markdown, SVG
- Python execution via Pyodide (WebAssembly) — no server needed, runs in the browser
- Auto-detects GUI libraries (tkinter, pygame, PySimpleGUI) and offers browser conversion
- "Launch as Web App" — converts Python GUI scripts to interactive HTML equivalents

### 🗂️ Sandbox File Environment (Admin)
- Server-side terminal (PowerShell on Windows, bash on Linux/Vercel)
- Upload zip files or folders — auto-extracted into a session-scoped sandbox directory
- File tree browser with download-as-zip packaging
- AURA auto-opens the sandbox when she detects a coding task

### 👤 User System & Onboarding
- Supabase authentication (email, OAuth)
- 3-step onboarding modal for new users: name, use case, content policy agreement
- Role-based access: `admin` role unlocks sandbox terminal, file packaging, model controls
- Content policy guard: server-side classifier blocks harmful/illegal requests before they reach any LLM
- Violation audit log in Supabase for compliance review

### 📱 PWA — Works as a Mobile App
- Full Progressive Web App with `manifest.json` — "Add to Home Screen" on iOS and Android
- Mobile-responsive layout: bottom tab bar replaces sidebar on small screens
- Detects mobile via `window.innerWidth` + touch API — separate UI surfaces for desktop and mobile
- `height: 100dvh`, `viewport-fit: cover`, safe area insets — pixel-perfect on notched phones

### 🎨 Design System
- Dark / light theme toggle with CSS custom properties throughout
- Custom SVG icon system — no icon library dependency, consistent stroke-based style
- Themed code blocks with syntax highlighting, copy button, download, and live preview
- Message reactions (👍/👎/copy), chat rename, markdown + JSON export
- Voice input via Web Speech API

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS + CSS custom properties |
| Auth & DB | Supabase (Postgres, RLS, Auth) |
| AI — Chat | Google Gemini 2.5 Flash / Ollama / OpenRouter / Pollinations |
| AI — Images | Hugging Face Inference API (FLUX.1-schnell via nscale) |
| AI — Python | Pyodide (WebAssembly) |
| Deployment | Vercel (serverless, edge-ready) |

---

## Getting Started

### Prerequisites
- Node.js 20+
- A Supabase project ([supabase.com](https://supabase.com))
- A Gemini API key ([aistudio.google.com](https://aistudio.google.com)) — free
- A Hugging Face token ([huggingface.co](https://huggingface.co)) — free

### Local Development

```bash
git clone https://github.com/YOUR_USERNAME/aura-web-app
cd aura-web-app
npm install
```

Create `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_key
HF_API_KEY=hf_your_huggingface_token
OPENROUTER_API_KEY=your_openrouter_key   # optional, for Nemotron fallback
NEXT_PUBLIC_ADMIN_EMAIL=your@email.com
```

Run the Supabase migration in your dashboard SQL Editor:
```sql
-- File: supabase/migration_user_profiles.sql
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Deploy to Vercel

1. Push this repo to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add the same env vars in the Vercel dashboard
4. Deploy — live in ~2 minutes

---

## Roadmap

- [ ] Streaming tool-call loop (Gemini function calling for autonomous task execution)
- [ ] Persistent conversation memory across sessions (Supabase vector store)
- [ ] User-configurable system prompt and persona
- [ ] Team workspaces with shared chat history
- [ ] Plugin marketplace for custom tools
- [ ] Native mobile app (Capacitor or React Native wrapper)

---

## License

MIT
