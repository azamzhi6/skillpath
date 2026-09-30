// Local environment loader (Phase 6A). No new dependencies: reads a few
// KEY=VALUE lines from app/.env if present. Real environment variables
// always win. Never logs values.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const KNOWN_KEYS = ['GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_BASE_URL', 'GROQ_TIMEOUT_MS', 'PORT']

export function loadLocalEnv(): void {
  const dir = dirname(fileURLToPath(import.meta.url))
  const envPath = join(dir, '..', '..', '.env')
  if (!existsSync(envPath)) return
  let text = ''
  try {
    text = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!KNOWN_KEYS.includes(key)) continue
    if (process.env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value !== '') process.env[key] = value
  }
}
