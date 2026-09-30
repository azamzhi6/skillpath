// Groq provider (Phase 6A/6B). OpenAI-compatible chat-completions API.
// Key comes only from GROQ_API_KEY. Optional overrides: GROQ_MODEL,
// GROQ_BASE_URL (default Groq cloud; overridable for tests/proxies),
// GROQ_TIMEOUT_MS (default 25000).

import { buildLearnMessages } from './prompts.ts'
import { validateLearnContent, type ValidLearnContent } from './validate.ts'
import type { AiProvider, LearnRequest } from './provider.ts'

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'openai/gpt-oss-20b'
const DEFAULT_TIMEOUT_MS = 25000

export interface GroqConfig {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
}

export function groqConfigFromEnv(): GroqConfig | null {
  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (apiKey.trim() === '') return null
  const timeoutRaw = Number(process.env.GROQ_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  return {
    apiKey,
    model: process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: (process.env.GROQ_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : DEFAULT_TIMEOUT_MS,
  }
}

interface ChatCompletionsResponse {
  choices?: { message?: { content?: unknown } }[]
}

export function extractLearnContent(body: unknown): ValidLearnContent | null {
  if (typeof body !== 'object' || body === null) return null
  const choices = (body as ChatCompletionsResponse).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const content = choices[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  return validateLearnContent(parsed)
}

export class GroqProvider implements AiProvider {
  readonly name = 'groq'
  private readonly config: GroqConfig

  constructor(config: GroqConfig) {
    this.config = config
  }

  isConfigured(): boolean {
    return this.config.apiKey.trim() !== ''
  }

  async generateLearn(request: LearnRequest): Promise<ValidLearnContent | null> {
    const messages = buildLearnMessages(request.input)
    let res: Response
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: messages.system },
            { role: 'user', content: messages.user },
          ],
          temperature: 0.4,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      return null
    }
    if (!res.ok) return null
    let body: unknown
    try {
      body = (await res.json()) as unknown
    } catch {
      return null
    }
    return extractLearnContent(body)
  }
}
