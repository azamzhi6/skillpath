// Phase 1 Task 2 (+expiry review): HTTP authentication + authorization tests.
// Run: npm run test:auth
// Uses pg-mem (no server required) through the real Express app via
// serverless-http (same wrapper as the Netlify Function). Every
// learner-data endpoint requires a valid session (demo sessions are minted
// explicitly via POST /api/auth/demo); anonymous and forged sessions get
// 401 on all reads and writes. Exercises the cookie jar end to end:
// register, login, logout, me, expiry, revocation, invalid credentials,
// duplicates, throttling, isolation between learners and demo, and CSRF.
import { newDb } from 'pg-mem'
import serverless from 'serverless-http'

const mem = newDb()
const { Pool } = mem.adapters.createPg()
const pool = new Pool()

const { overridePoolForTests } = await import('../server/db.ts')
overridePoolForTests(pool)

const { default: app } = await import('../server/index.ts')
const handler = serverless(app)

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

// One jar per simulated browser.
function makeClient() {
  const jar = {}
  function storeCookies(res) {
    const found = []
    const headers = res.headers ?? {}
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === 'set-cookie') {
        found.push(...(Array.isArray(value) ? value : [value]))
      }
    }
    const multi = res.multiValueHeaders ?? {}
    for (const [key, value] of Object.entries(multi)) {
      if (key.toLowerCase() === 'set-cookie') found.push(...value)
    }
    for (const cookie of found) {
      const match = /^([^=]+)=([^;]*)/.exec(cookie)
      if (match) {
        if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cookie)) delete jar[match[1]]
        else jar[match[1]] = match[2]
      }
    }
    return found
  }
  return {
    jar,
    async call(method, path, body, extra) {
      const headers = {}
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      const override = extra?.cookie
      const jarCookie = Object.entries(jar)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
      const cookie = override ?? jarCookie
      if (cookie) headers.Cookie = cookie
      if (extra?.headers) Object.assign(headers, extra.headers)
      const res = await handler({
        httpMethod: method,
        path,
        headers,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: body === undefined ? null : JSON.stringify(body),
        isBase64Encoded: false,
      })
      const setCookies = storeCookies(res)
      let json = null
      try {
        json = JSON.parse(res.body)
      } catch {
        // leave null
      }
      return { status: res.statusCode, json, setCookies }
    },
  }
}

const anon = makeClient()
const clientA = makeClient()
const clientB = makeClient()
const clientC = makeClient()

const BASE_SNAPSHOT = {
  goalText: 'I want to learn Excel for financial analysis',
  template: 'excel',
  experience: 'Tried it before',
  hoursPerWeek: '4 hours',
  answers: [{ questionId: 'excel-1', choiceId: 'b' }],
  score: 1,
  level: 'Starting out',
  pathTitle: 'T',
  pathOutcome: 'O',
  pathLevel: 'L',
  stages: [],
  completedStageIds: [],
  parsedGoal: null,
}

const STAGED_SNAPSHOT = {
  ...BASE_SNAPSHOT,
  stages: [
    {
      id: 'excel-s1',
      title: 'S1',
      criteria: [{ id: 'excel-s1-structure' }, { id: 'excel-s1-other' }],
    },
  ],
}

function practicePayload(overrides = {}) {
  return {
    stageId: 'excel-s1',
    kind: 'practice',
    response: 'I formatted the table and checked validation rules.',
    verdict: 'retry',
    strengths: '["a"]',
    improvements: '["b"]',
    nextAction: 'Try again.',
    criteria: [
      { criterionId: 'excel-s1-structure', met: true },
      { criterionId: 'excel-s1-other', met: false },
    ],
    template: 'excel',
    ...overrides,
  }
}

// ---- Registration ----
{
  const res = await clientA.call('POST', '/api/auth/register', {
    email: 'A@Example.com',
    password: 'correct-horse-10',
  })
  check('register 201 with session cookie', res.status === 201 && res.setCookies.some((c) => c.startsWith('sp_session=')))
  check('register normalizes email, learner role', res.json?.user?.email === 'a@example.com' && res.json?.user?.role === 'learner')
  const cookie = res.setCookies.find((c) => c.startsWith('sp_session=')) ?? ''
  check('session cookie HttpOnly SameSite, no Secure on http', /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie))
  const serialized = JSON.stringify(res.json)
  check(
    'register response leaks no secrets',
    !/password_hash|passwordHash|token_hash|tokenHash/.test(serialized) && !/correct-horse/.test(serialized),
  )
}

{
  const res = await clientB.call('POST', '/api/auth/register', {
    email: 'b@example.com',
    password: 'correct-horse-10',
    role: 'admin',
  })
  check('client-supplied admin role ignored', res.status === 201 && res.json?.user?.role === 'learner')
}

{
  const dup = await anon.call('POST', '/api/auth/register', {
    email: 'a@EXAMPLE.com',
    password: 'correct-horse-10',
  })
  check('duplicate email rejected', dup.status === 409)
  const badEmail = await anon.call('POST', '/api/auth/register', {
    email: 'not-an-email',
    password: 'correct-horse-10',
  })
  check('invalid email rejected', badEmail.status === 400)
  const shortPw = await anon.call('POST', '/api/auth/register', {
    email: 'short@example.com',
    password: 'tiny',
  })
  check('short password rejected', shortPw.status === 400)
  const missing = await anon.call('POST', '/api/auth/register', { email: 'x@example.com' })
  check('missing password rejected', missing.status === 400)
}

// ---- Session validation ----
{
  const me = await clientA.call('GET', '/api/auth/me')
  check('me reports authenticated user', me.status === 200 && me.json?.authenticated === true && me.json?.user?.email === 'a@example.com')
  const anonMe = await anon.call('GET', '/api/auth/me')
  check('anonymous me reports unauthenticated', anonMe.json?.authenticated === false && anonMe.json?.user === null)
}

// ---- Login ----
{
  const fresh = makeClient()
  const res = await fresh.call('POST', '/api/auth/login', {
    email: 'a@example.com',
    password: 'correct-horse-10',
  })
  check('login 200 with session cookie', res.status === 200 && res.setCookies.some((c) => c.startsWith('sp_session=')))
  const serialized = JSON.stringify(res.json)
  check('login response leaks no secrets', !/password_hash|passwordHash|token_hash|tokenHash/.test(serialized))
}

{
  const badPw = await anon.call('POST', '/api/auth/login', {
    email: 'a@example.com',
    password: 'wrong-password-99',
  })
  const unknown = await anon.call('POST', '/api/auth/login', {
    email: 'nobody-here@example.com',
    password: 'wrong-password-99',
  })
  check(
    'invalid credentials share one generic message',
    badPw.status === 401 &&
      unknown.status === 401 &&
      badPw.json?.error === 'Invalid email or password' &&
      unknown.json?.error === 'Invalid email or password',
  )
  const malformed = await anon.call('POST', '/api/auth/login', { email: 'a@example.com' })
  check('malformed login rejected', malformed.status === 400)
}

// ---- Login throttling ----
{
  for (let i = 0; i < 20; i++) {
    await anon.call('POST', '/api/auth/login', {
      email: 'throttle@example.com',
      password: 'wrong-password-99',
    })
  }
  const blocked = await anon.call('POST', '/api/auth/login', {
    email: 'throttle@example.com',
    password: 'wrong-password-99',
  })
  check('login throttled after repeated failures', blocked.status === 429)
}

// ---- No silent demo fallback: anonymous and forged sessions are rejected ----
{
  const get = await anon.call('GET', '/api/state')
  const put = await anon.call('PUT', '/api/state', { state: BASE_SNAPSHOT })
  const del = await anon.call('DELETE', '/api/state')
  const sub = await anon.call('POST', '/api/submissions', practicePayload())
  check('anonymous reads rejected', get.status === 401)
  check('anonymous writes rejected', put.status === 401 && del.status === 401 && sub.status === 401)
  const forged = await anon.call('GET', '/api/state', undefined, { cookie: 'sp_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  check('forged token rejected', forged.status === 401)
}

const demo = makeClient()
{
  const hello = await demo.call('POST', '/api/auth/demo')
  check(
    'demo handshake issues a session',
    hello.status === 200 &&
      hello.json?.authenticated === true &&
      hello.json?.demo === true &&
      typeof hello.json?.user?.email === 'string',
  )
  const put = await demo.call('PUT', '/api/state', { state: { ...BASE_SNAPSHOT, goalText: 'Demo journey text' } })
  check('demo writes stay on demo scope', put.status === 200 && put.json?.scope === 'demo')
}

{
  const res = await clientC.call('POST', '/api/auth/register', {
    email: 'c@example.com',
    password: 'correct-horse-10',
  })
  check('third account registers', res.status === 201)
  const got = await clientC.call('GET', '/api/state')
  check('new account sees neither demo nor others', got.status === 200 && got.json?.state === null)
  const demoGot = await demo.call('GET', '/api/state')
  check('demo session still sees demo journey', demoGot.json?.state?.goalText === 'Demo journey text')
}

{
  const putA = await clientA.call('PUT', '/api/state', { state: { ...BASE_SNAPSHOT, goalText: 'A journey text' } })
  check('authenticated writes report authenticated scope', putA.json?.scope === 'authenticated')
  const getA = await clientA.call('GET', '/api/state')
  const getB = await clientB.call('GET', '/api/state')
  check(
    'learners read only their own snapshots',
    getA.json?.state?.goalText === 'A journey text' && getB.json?.state === null,
  )
  await clientB.call('PUT', '/api/state', { state: { ...BASE_SNAPSHOT, goalText: 'B journey text' } })
  const getA2 = await clientA.call('GET', '/api/state')
  check('concurrent learner journeys stay separate', getA2.json?.state?.goalText === 'A journey text')
  const delB = await clientB.call('DELETE', '/api/state')
  const getA3 = await clientA.call('GET', '/api/state')
  const getB3 = await clientB.call('GET', '/api/state')
  check(
    'cross-account reset clears only that learner',
    delB.status === 200 && getB3.json?.state === null && getA3.json?.state?.goalText === 'A journey text',
  )
}

// ---- Demo/account separation, demo login guard, expiry, revocation ----
{
  const demoGot = await demo.call('GET', '/api/state')
  const getA = await clientA.call('GET', '/api/state')
  check(
    'demo and account journeys stay separate',
    demoGot.json?.state?.goalText === 'Demo journey text' && getA.json?.state?.goalText === 'A journey text',
  )
  const demoLogin = await demo.call('POST', '/api/auth/login', {
    email: 'demo@skillpath.local',
    password: 'anything-at-all-10',
  })
  check('demo address can never sign in', demoLogin.status === 401 && demoLogin.json?.error === 'Invalid email or password')
}

{
  const clientD = makeClient()
  await clientD.call('POST', '/api/auth/register', {
    email: 'd@example.com',
    password: 'correct-horse-10',
  })
  await clientD.call('PUT', '/api/state', { state: { ...BASE_SNAPSHOT, goalText: 'D journey text' } })
  await pool.query(`UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE email = 'd@example.com')`)
  const autosave = await clientD.call('PUT', '/api/state', { state: { ...BASE_SNAPSHOT, goalText: 'D overwritten text' } })
  check('expired session autosave rejected without writing', autosave.status === 401)
  await clientD.call('POST', '/api/auth/login', {
    email: 'd@example.com',
    password: 'correct-horse-10',
  })
  const recovered = await clientD.call('GET', '/api/state')
  check('expired write preserved the original journey', recovered.json?.state?.goalText === 'D journey text')
}

{
  const staleDemo = demo.jar.sp_session
  await demo.call('POST', '/api/auth/logout')
  const put = await demo.call('PUT', '/api/state', { state: BASE_SNAPSHOT }, { cookie: `sp_session=${staleDemo}` })
  check('revoked demo session cannot write', put.status === 401)
}

// ---- Submissions isolation ----
{
  await clientA.call('PUT', '/api/state', { state: { ...STAGED_SNAPSHOT, goalText: 'A journey text' } })
  const subA1 = await clientA.call('POST', '/api/submissions', practicePayload())
  check('authenticated submission persists', subA1.status === 200 && subA1.json?.submission?.attempt === 1)
  const subAnonStage = await clientB.call('POST', '/api/submissions', practicePayload())
  check('learner without journey cannot submit', subAnonStage.status === 400)
  await clientB.call('PUT', '/api/state', { state: { ...STAGED_SNAPSHOT, goalText: 'B journey text' } })
  const subB1 = await clientB.call('POST', '/api/submissions', practicePayload())
  check('attempt counting is per learner journey', subB1.json?.submission?.attempt === 1)
  const subA2 = await clientA.call('POST', '/api/submissions', practicePayload())
  check('second attempt increments for the same learner', subA2.json?.submission?.attempt === 2)
  const learnA = await clientA.call('GET', '/api/state')
  const learnB = await clientB.call('GET', '/api/state')
  check(
    'learning blocks are isolated',
    learnA.json?.learning?.submissions?.length === 2 &&
      learnB.json?.learning?.submissions?.length === 1 &&
      learnA.json?.learning?.mastery?.length === 2,
  )
}

// ---- Capability evidence isolation ----
{
  const cap = await clientA.call('POST', '/api/submissions', {
    stageId: 'capability',
    kind: 'capability',
    response: 'I built the monthly sales analysis with validation and charts, explained the margins, and noted one caveat about returns.',
    verdict: 'satisfactory',
    strengths: '["method"]',
    improvements: '["polish"]',
    nextAction: 'Recorded.',
    evidence: { capability: 'Excel analysis', result: 'satisfactory', evidence: 'Workbook excerpt.' },
  })
  check('capability evidence recorded', cap.json?.evidenceId !== null && cap.json?.evidenceId !== undefined)
  const learnA = await clientA.call('GET', '/api/state')
  const learnB = await clientB.call('GET', '/api/state')
  check(
    'capability evidence visible only to its learner',
    learnA.json?.learning?.evidence?.length === 1 && (learnB.json?.learning?.evidence ?? []).length === 0,
  )
}

// ---- CSRF ----
{
  const evil = await anon.call('PUT', '/api/state', { state: BASE_SNAPSHOT }, { headers: { Origin: 'https://evil.example' } })
  check('cross-origin state write rejected', evil.status === 403)
}

// ---- Logout + revocation + expiry ----
{
  const stale = clientA.jar.sp_session
  const out = await clientA.call('POST', '/api/auth/logout')
  check('logout ok and clears cookie', out.status === 200 && out.setCookies.some((c) => /Max-Age=0/.test(c)))
  const meAfter = await clientA.call('GET', '/api/auth/me')
  check('logged-out session no longer valid', meAfter.json?.authenticated === false)
  const replay = await clientA.call('GET', '/api/auth/me', undefined, { cookie: `sp_session=${stale}` })
  check('stale token rejected after logout', replay.json?.authenticated === false)
  const replayWrite = await clientA.call('PUT', '/api/state', { state: { ...BASE_SNAPSHOT, goalText: 'Attacker overwrite' } }, { cookie: `sp_session=${stale}` })
  check('logged-out token cannot write', replayWrite.status === 401)
  await clientA.call('POST', '/api/auth/login', {
    email: 'a@example.com',
    password: 'correct-horse-10',
  })
  const aAfter = await clientA.call('GET', '/api/state')
  check('logged-out write left the journey unchanged', aAfter.json?.state?.goalText === 'A journey text')
  const demoFresh = makeClient()
  await demoFresh.call('POST', '/api/auth/demo')
  const demoAfter = await demoFresh.call('GET', '/api/state')
  check('logged-out write left demo data unchanged', demoAfter.json?.state?.goalText === 'Demo journey text')
}

{
  const login = await anon.call('POST', '/api/auth/login', {
    email: 'b@example.com',
    password: 'correct-horse-10',
  })
  check('login still works after other logout', login.status === 200)
  await pool.query(`UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'`)
  const me = await anon.call('GET', '/api/auth/me')
  check('expired session reads as unauthenticated', me.json?.authenticated === false)
}

overridePoolForTests(null)

if (failures > 0) {
  console.log(`AUTH-API-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('AUTH-API-ALL-PASS')
