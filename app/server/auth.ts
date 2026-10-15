// Authentication for the SkillPath prototype (Phase 1, Task 2).
// Opaque sessions carried in HttpOnly cookies; passwords via bcryptjs.
// Learner identity is always resolved server-side from the session —
// callers never supply a learner ID. AI endpoints stay public because
// they neither read nor write learner data.

import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import {
  DEMO_LEARNER_ID,
  countRecentLoginAttempts,
  findSessionByTokenHash,
  recordLoginAttempt,
  type StoredUser,
} from './db.ts'

export const SESSION_COOKIE = 'sp_session'
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
export const DEMO_SESSION_TTL_MS = 7 * 24 * 3600 * 1000
const BCRYPT_COST = 10
const LOGIN_MAX_FAILURES = 20
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const IP_AUTH_LIMIT = 200
const IP_AUTH_WINDOW_MS = 10 * 60 * 1000
const PASSWORD_MIN_LENGTH = 10
const PASSWORD_MAX_BYTES = 72
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function header(req: Request, name: string): string | undefined {
  const headers = req.headers as Record<string, string | string[] | undefined>
  const direct = headers[name]
  if (typeof direct === 'string') return direct
  if (Array.isArray(direct)) return direct[0]
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) {
      const value = headers[key]
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

/** Resolves the session cookie against stored session hashes. */
export async function authenticate(req: Request): Promise<StoredUser | null> {
  const token = getSessionToken(req)
  if (!token) return null
  const found = await findSessionByTokenHash(hashToken(token))
  return found ? found.user : null
}

/** Resolved learner scope: the session owner, or the explicit demo learner. */
export function learnerIdFor(user: StoredUser | null): string {
  return user ? user.learnerId : DEMO_LEARNER_ID
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export async function passwordMatches(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}

// Fixed dummy hash so unknown-email logins cost the same as real ones,
// denying a timing oracle for account enumeration.
let dummyHash: string | null = null
export function dummyHashValue(): string {
  if (!dummyHash) dummyHash = bcrypt.hashSync('skillpath-never-a-real-password', BCRYPT_COST)
  return dummyHash
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hex of the presented token: the only form ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function normalizeAuthEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (normalized.length > 320 || !EMAIL_RE.test(normalized)) return null
  return normalized
}

export function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return 'Password is too long'
  }
  return null
}

export function publicUser(user: StoredUser): {
  id: string
  email: string
  role: string
} {
  return { id: user.id, email: user.email, role: user.role }
}

export function getSessionToken(req: Request): string | null {
  const cookieHeader = header(req, 'cookie')
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim()
      if (/^[A-Za-z0-9_-]{20,120}$/.test(value)) return value
      return null
    }
  }
  return null
}

// Secure cookies everywhere except local development (no proxy-header
// trust involved: localhost is detected from the Host itself).
function cookieSecure(req: Request): boolean {
  const host = (header(req, 'host') ?? '').split(':')[0].toLowerCase()
  return host !== '' && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]'
}

function cookieValue(req: Request, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (cookieSecure(req)) parts.push('Secure')
  return parts.join('; ')
}

export function setSessionCookie(
  res: Response,
  req: Request,
  token: string,
  maxAgeMs: number = SESSION_TTL_MS,
): void {
  res.setHeader('Set-Cookie', cookieValue(req, token, Math.floor(maxAgeMs / 1000)))
}

export function clearSessionCookie(res: Response, req: Request): void {
  res.setHeader(
    'Set-Cookie',
    `${cookieValue(req, '', 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  )
}

export function clientIp(req: Request): string {
  // Best-effort only (serverless instances cannot share counters either);
  // the database-backed per-email throttle is the durable layer.
  const forwarded = header(req, 'x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  if (first) return first.slice(0, 200)
  const direct = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
  return direct.slice(0, 200)
}

const ipHits = new Map<string, number[]>()

/** Best-effort per-IP throttle for auth writes. Durable limits live in loginAllowed. */
export function ipAuthAllowed(ip: string): boolean {
  const now = Date.now()
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_AUTH_WINDOW_MS)
  if (recent.length >= IP_AUTH_LIMIT) {
    ipHits.set(ip, recent)
    return false
  }
  recent.push(now)
  ipHits.set(ip, recent)
  if (ipHits.size > 5000) {
    for (const [key, times] of ipHits) {
      if (times.length === 0 || now - times[times.length - 1] > IP_AUTH_WINDOW_MS) {
        ipHits.delete(key)
      }
    }
  }
  return true
}

export async function loginAllowed(email: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString()
  return (
    (await countRecentLoginAttempts({ email, sinceIso: since })) < LOGIN_MAX_FAILURES
  )
}

export async function recordFailedLogin(email: string, ip: string): Promise<void> {
  await recordLoginAttempt({ email, ip })
}

// CSRF: cookies are SameSite=Lax and state changes require JSON, so simple
// cross-site forms cannot act. Requests that DO carry an Origin/Referer
// from another host are rejected; same-origin fetch and API clients
// (no Origin header) are unaffected.
export function sameOriginOk(req: Request): boolean {
  const host = (header(req, 'host') ?? '').toLowerCase()
  const origin = header(req, 'origin')
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === host
    } catch {
      return false
    }
  }
  const referer = header(req, 'referer')
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === host
    } catch {
      return false
    }
  }
  return true
}
