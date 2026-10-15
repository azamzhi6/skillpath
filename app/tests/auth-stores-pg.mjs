// Phase 1 Task 1: auth schema + per-learner store tests (+ corrective pass).
// Run: npm run test:auth-stores
// Uses pg-mem (no server required). Covers:
// - initDb idempotency with the new tables
// - legacy-schema migration (mastery without learner_id) + demo preservation
// - DB-enforced case-insensitive email uniqueness (incl. direct-DB bypass)
// - store input validation (email, role, password hash)
// - per-learner snapshot/mastery/learning/feedback/evidence isolation
// - scoped reset (clearAllForLearner) leaving other learners + demo intact
// - user/session/login-attempt stores incl. refresh + revoke-all
//   (server-side only, no routes yet)
// Existing demo functions are exercised last as a regression check.
import { newDb } from 'pg-mem'
import { Pool as PgPool } from 'pg'
import {
  clearAll,
  clearAllForLearner,
  countRecentLoginAttempts,
  createSession,
  createUser,
  deleteSessionByTokenHash,
  deleteSessionsForUser,
  findSessionByTokenHash,
  findUserByEmail,
  findUserCredentialsByEmail,
  initDb,
  journeyExists,
  journeyExistsForLearner,
  loadLearning,
  loadLearningForLearner,
  loadMastery,
  loadMasteryForLearner,
  loadSnapshot,
  loadSnapshotForLearner,
  overridePoolForTests,
  purgeExpiredSessions,
  recordLoginAttempt,
  refreshSessionLastSeen,
  saveFeedback,
  saveSnapshot,
  saveSnapshotForLearner,
  saveSubmission,
  saveSubmissionForLearner,
} from '../server/db.ts'

// Set TEST_DATABASE_URL to also run Block C against real PostgreSQL, which
// alone can prove physical removal of the legacy global unique constraint
// (pg-mem names auto-generated constraints with internal hashes, so the
// DROP CONSTRAINT step is a no-op there — see runPhase1Migrations).
const REAL_PG = !!process.env.TEST_DATABASE_URL

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

async function tableExists(pool, table) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return rows.length > 0
}

async function columnExists(pool, table, column) {
  try {
    await pool.query(`SELECT ${column} FROM ${table} LIMIT 0`)
    return true
  } catch {
    return false
  }
}

// ---- Block A: legacy-schema migration + demo preservation ----
{
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  overridePoolForTests(pool)
  // Old shape: mastery WITHOUT learner_id (goals already had learner_id).
  await pool.query(`CREATE TABLE learners (id TEXT PRIMARY KEY, display_name TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE goals (id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), raw_text TEXT NOT NULL, template TEXT NOT NULL, experience TEXT NOT NULL, hours_per_week TEXT NOT NULL, subject TEXT, desired_outcome TEXT, timeframe TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE diagnostics (goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE, answers_json TEXT NOT NULL, score INTEGER NOT NULL, level TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE paths (goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE, title TEXT NOT NULL, outcome TEXT NOT NULL, level TEXT NOT NULL, stages_json TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE progress (goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE, completed_stage_ids_json TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE submissions (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE, stage_id TEXT NOT NULL, kind TEXT NOT NULL, response TEXT NOT NULL, attempt INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (goal_id, stage_id, kind, attempt))`)
  await pool.query(`CREATE TABLE feedback (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE, verdict TEXT NOT NULL, strengths TEXT NOT NULL, improvements TEXT NOT NULL, next_action TEXT NOT NULL, prose_source TEXT NOT NULL DEFAULT 'mock', created_at TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE capability_evidence (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE, submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE, capability TEXT NOT NULL, result TEXT NOT NULL, evidence TEXT NOT NULL, demonstrated_at TEXT NOT NULL)`)
  await pool.query(`CREATE TABLE learner_criterion_mastery (id TEXT PRIMARY KEY, template TEXT NOT NULL, stage_id TEXT NOT NULL, criterion_id TEXT NOT NULL, attempts INTEGER NOT NULL, passes INTEGER NOT NULL, failures INTEGER NOT NULL, consecutive_failures INTEGER NOT NULL, last_result TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_assessed_at TEXT NOT NULL, mastery_status TEXT NOT NULL, UNIQUE (template, stage_id, criterion_id))`)
  await pool.query(`INSERT INTO learners (id, display_name) VALUES ('demo-learner', 'Demo Learner')`)
  await pool.query(`INSERT INTO goals (id, learner_id, raw_text, template, experience, hours_per_week, created_at, updated_at) VALUES ('goal-demo', 'demo-learner', 'I want to learn Excel for financial analysis', 'excel', 'Tried it before', '4 hours', 't', 't')`)
  await pool.query(`INSERT INTO learner_criterion_mastery (id, template, stage_id, criterion_id, attempts, passes, failures, consecutive_failures, last_result, first_seen_at, last_assessed_at, mastery_status) VALUES ('m-legacy', 'excel', 'excel-s1', 'legacy-c1', 1, 1, 0, 0, 'pass', 't', 't', 'demonstrated')`)

  await initDb()
  await initDb()
  check('migration: users table created', await tableExists(pool, 'users'))
  check('migration: sessions table created', await tableExists(pool, 'sessions'))
  check('migration: login_attempts table created', await tableExists(pool, 'login_attempts'))
  check('migration: password_resets stub created', await tableExists(pool, 'password_resets'))
  check('migration: mastery.learner_id column added', await columnExists(pool, 'learner_criterion_mastery', 'learner_id'))
  const demoSnap = await loadSnapshot()
  check('migration: demo snapshot preserved', demoSnap !== null && demoSnap.goalText === 'I want to learn Excel for financial analysis')
  const demoMastery = await loadMasteryForLearner('demo-learner')
  check('migration: legacy mastery backfilled to demo-learner', demoMastery.length === 1 && demoMastery[0].criterionId === 'legacy-c1')
}

// ---- Block B: fresh database, per-learner ownership ----
{
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  overridePoolForTests(pool)
  await initDb()
  await initDb()
  check('fresh initDb is idempotent', (await loadSnapshot()) === null)

  const userA = await createUser({ email: 'A@Example.com', passwordHash: 'hash-fixture-A-0123456789' })
  const userB = await createUser({ email: 'b@example.com', passwordHash: 'hash-fixture-B-0123456789' })
  check('user email normalized to lowercase', userA.email === 'a@example.com')
  check('user role defaults to learner', userA.role === 'learner')
  check('learners are distinct per user', userA.learnerId !== userB.learnerId)
  let dupRejected = false
  try {
    await createUser({ email: 'TEST@example.com', passwordHash: 'hash-fixture-dup-0123456789' })
    await createUser({ email: 'test@EXAMPLE.com', passwordHash: 'hash-fixture-dup2-0123456789' })
  } catch (err) {
    dupRejected = err instanceof Error && err.message === 'Email already registered'
  }
  // 'TEST@example.com' was free, so the first create succeeds; the second must fail.
  check('duplicate email (case-insensitive) rejected', dupRejected)
  const admin = await createUser({ email: 'admin@example.com', passwordHash: 'hash-fixture-admin-0123456789', role: 'admin' })
  check('server-side admin creation allowed', admin.role === 'admin')
  const foundA = await findUserByEmail('A@example.COM')
  check('findUserByEmail is case-insensitive', foundA !== null && foundA.learnerId === userA.learnerId)
  const creds = await findUserCredentialsByEmail('a@example.com')
  check('credentials lookup returns hash server-side', creds !== null && creds.passwordHash === 'hash-fixture-A-0123456789')
  check('public profile lookup exposes no hash', foundA !== null && !('passwordHash' in foundA))

  // Direct-database writes bypass application normalization: the unique
  // index on lower(email) must still reject case variants.
  let directDupRejected = false
  try {
    await pool.query(
      `INSERT INTO learners (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      ['learner-case-raw', 'Case Raw'],
    )
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, learner_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      ['user-case-raw', 'B@EXAMPLE.COM', 'hash-fixture-raw-0123456789', 'learner', 'learner-case-raw', new Date().toISOString()],
    )
  } catch {
    directDupRejected = true
  }
  check('direct case-variant insert rejected by database', directDupRejected)

  // Store-contract input validation.
  let invalidEmail = false
  try {
    await createUser({ email: 'not-an-email', passwordHash: 'hash-fixture-x-0123456789' })
  } catch (err) {
    invalidEmail = err instanceof Error && err.message === 'Invalid email'
  }
  check('invalid email rejected', invalidEmail)
  let invalidRole = false
  try {
    await createUser({ email: 'role@example.com', passwordHash: 'hash-fixture-x-0123456789', role: 'superadmin' })
  } catch (err) {
    invalidRole = err instanceof Error && err.message === 'Invalid role'
  }
  check('invalid role rejected', invalidRole)
  let invalidHash = false
  try {
    await createUser({ email: 'hash@example.com', passwordHash: 'short' })
  } catch (err) {
    invalidHash = err instanceof Error && err.message === 'Invalid password hash'
  }
  check('short password hash rejected', invalidHash)

  const base = {
    template: 'excel',
    experience: 'Tried it before',
    hoursPerWeek: '4 hours',
    answers: [],
    score: 0,
    level: 'Starting out',
    pathTitle: 'T',
    pathOutcome: 'O',
    pathLevel: 'L',
    stages: [],
    completedStageIds: [],
    parsedGoal: null,
  }
  await saveSnapshotForLearner(userA.learnerId, { ...base, goalText: 'A wants to learn Excel for finance' })
  await saveSnapshotForLearner(userB.learnerId, { ...base, goalText: 'B wants to build websites' })
  check('journey exists per learner', (await journeyExistsForLearner(userA.learnerId)) && (await journeyExistsForLearner(userB.learnerId)))
  check('demo journey untouched by learner writes', (await journeyExists()) === false)
  const snapA = await loadSnapshotForLearner(userA.learnerId)
  const snapB = await loadSnapshotForLearner(userB.learnerId)
  check('snapshot isolated per learner', snapA !== null && snapB !== null && snapA.goalText.includes('A wants') && snapB.goalText.includes('B wants'))
  check('unknown learner reads null', (await loadSnapshotForLearner('learner-missing')) === null)

  // Goal-creation safeguard: repeat and concurrent first saves must keep a
  // single goal row per learner (upsert on idx_goals_learner_unique).
  await saveSnapshotForLearner(userB.learnerId, { ...base, goalText: 'B second save' })
  const bGoalCount = Number((await pool.query('SELECT COUNT(*) AS n FROM goals WHERE learner_id = $1', [userB.learnerId])).rows[0].n)
  check('repeat saves keep a single goal row', bGoalCount === 1)
  const userC = await createUser({ email: 'c@example.com', passwordHash: 'hash-fixture-C-0123456789' })
  await Promise.all([
    saveSnapshotForLearner(userC.learnerId, { ...base, goalText: 'C race one' }),
    saveSnapshotForLearner(userC.learnerId, { ...base, goalText: 'C race two' }),
  ])
  const cGoalCount = Number((await pool.query('SELECT COUNT(*) AS n FROM goals WHERE learner_id = $1', [userC.learnerId])).rows[0].n)
  check('concurrent first saves keep a single goal row', cGoalCount === 1)
  const snapC = await loadSnapshotForLearner(userC.learnerId)
  check('concurrent first save loads a complete snapshot', snapC !== null && (snapC.goalText === 'C race one' || snapC.goalText === 'C race two'))

  const sub = { stageId: 's1', kind: 'practice', response: 'r', verdict: 'retry', strengths: '[]', improvements: '[]', nextAction: 'x' }
  let noJourneyRejected = false
  try {
    await saveSubmissionForLearner('learner-missing', sub, [], 'excel')
  } catch (err) {
    noJourneyRejected = err instanceof Error && err.message === 'No active learning journey'
  }
  check('submission without journey rejected', noJourneyRejected)
  await saveSubmissionForLearner(userA.learnerId, sub, [{ criterionId: 'la-1', met: true }], 'excel')
  await saveSubmissionForLearner(userB.learnerId, sub, [{ criterionId: 'lb-1', met: false }], 'excel')
  const mA = await loadMasteryForLearner(userA.learnerId)
  const mB = await loadMasteryForLearner(userB.learnerId)
  check('mastery isolated per learner', mA.length === 1 && mA[0].criterionId === 'la-1' && mB.length === 1 && mB[0].criterionId === 'lb-1')
  // Repeat writes for one learner's criterion must update a single row
  // (per-learner uniqueness) rather than insert duplicates.
  await saveSubmissionForLearner(userA.learnerId, sub, [{ criterionId: 'dup-c1', met: false }], 'excel')
  await saveSubmissionForLearner(userA.learnerId, sub, [{ criterionId: 'dup-c1', met: false }], 'excel')
  const dupRows = (await loadMasteryForLearner(userA.learnerId)).filter((m) => m.criterionId === 'dup-c1')
  check('same-learner criterion updates a single row', dupRows.length === 1 && dupRows[0].attempts === 2 && dupRows[0].consecutiveFailures === 2)
  const lA = await loadLearningForLearner(userA.learnerId)
  const lB = await loadLearningForLearner(userB.learnerId)
  const sharedIds = lA.submissions.filter((s) => lB.submissions.some((o) => o.id === s.id))
  check('learning isolated per learner', lA.submissions.length === 3 && lB.submissions.length === 1 && sharedIds.length === 0)

  // Feedback and evidence: feedback is written via the existing global
  // helper (it references only the learner-owned submission), while
  // capability_evidence carries its own goal_id column and the global
  // saveEvidence helper hardcodes the demo goal (absent in this block) —
  // so the fixture inserts evidence directly to keep each row owned by
  // its learner. Reads go through the scoped API in both cases.
  await saveFeedback(lA.submissions[0].id, 'retry', '["s"]', '["i"]', 'Try again.', 'mock')
  await saveFeedback(lB.submissions[0].id, 'satisfactory', '["s"]', '["i"]', 'Continue.', 'mock')
  async function insertEvidence(submissionId, learnerId, capability, evidence) {
    const { rows } = await pool.query('SELECT id FROM goals WHERE learner_id = $1', [learnerId])
    await pool.query(
      `INSERT INTO capability_evidence (id, goal_id, submission_id, capability, result, evidence, demonstrated_at)
       VALUES ($1, $2, $3, $4, 'satisfactory', $5, $6)`,
      [`ev-${submissionId}`, rows[0].id, submissionId, capability, evidence, new Date().toISOString()],
    )
  }
  await insertEvidence(lA.submissions[0].id, userA.learnerId, 'cap-a', 'evidence-a')
  await insertEvidence(lB.submissions[0].id, userB.learnerId, 'cap-b', 'evidence-b')
  const lA2 = await loadLearningForLearner(userA.learnerId)
  const lB2 = await loadLearningForLearner(userB.learnerId)
  check(
    'feedback isolated per learner',
    lA2.feedback.length === 1 && lA2.feedback[0].submissionId === lA.submissions[0].id &&
    lB2.feedback.length === 1 && lB2.feedback[0].submissionId === lB.submissions[0].id,
  )
  check(
    'evidence isolated per learner',
    lA2.evidence.length === 1 && lA2.evidence[0].evidence === 'evidence-a' &&
    lB2.evidence.length === 1 && lB2.evidence[0].evidence === 'evidence-b',
  )

  await clearAllForLearner(userA.learnerId)
  check('scoped reset clears only that learner', (await journeyExistsForLearner(userA.learnerId)) === false && (await journeyExistsForLearner(userB.learnerId)) === true)
  check('scoped reset clears that learner mastery', (await loadMasteryForLearner(userA.learnerId)).length === 0 && (await loadMasteryForLearner(userB.learnerId)).length === 1)

  const future = new Date(Date.now() + 3600_000).toISOString()
  const sess = await createSession({ userId: userB.id, tokenHash: 'tok-hash-1', expiresAt: future })
  const found = await findSessionByTokenHash('tok-hash-1')
  check('session round-trips with user', found !== null && found.user.learnerId === userB.learnerId && found.session.id === sess.id)
  await deleteSessionByTokenHash('tok-hash-1')
  check('deleted session no longer resolves', (await findSessionByTokenHash('tok-hash-1')) === null)

  const refreshSess = await createSession({ userId: userB.id, tokenHash: 'tok-refresh', expiresAt: future })
  const seenBefore = (await findSessionByTokenHash('tok-refresh')).session.lastSeenAt
  await refreshSessionLastSeen(refreshSess.id)
  const seenAfter = (await findSessionByTokenHash('tok-refresh')).session.lastSeenAt
  check('session last-seen refresh persists', seenAfter >= seenBefore)
  await createSession({ userId: userB.id, tokenHash: 'tok-extra', expiresAt: future })
  await deleteSessionsForUser(userB.id)
  check(
    'deleteSessionsForUser revokes all user sessions',
    (await findSessionByTokenHash('tok-refresh')) === null &&
    (await findSessionByTokenHash('tok-extra')) === null,
  )

  await createSession({ userId: userB.id, tokenHash: 'tok-expired', expiresAt: new Date(Date.now() - 1000).toISOString() })
  check('expired session does not resolve', (await findSessionByTokenHash('tok-expired')) === null)
  await purgeExpiredSessions()
  check('purge is idempotent', (await findSessionByTokenHash('tok-expired')) === null)

  await recordLoginAttempt({ email: 'b@example.com', ip: '10.0.0.1' })
  await recordLoginAttempt({ email: 'B@EXAMPLE.com', ip: '10.0.0.2' })
  const cnt = await countRecentLoginAttempts({ email: 'b@example.com', sinceIso: new Date(Date.now() - 600_000).toISOString() })
  const cntFuture = await countRecentLoginAttempts({ email: 'b@example.com', sinceIso: new Date(Date.now() + 600_000).toISOString() })
  check('login attempts counted (normalized email)', cnt === 2 && cntFuture === 0)

  // Demo regression: existing global functions still work after migration.
  await saveSnapshot({ ...base, goalText: 'I want to learn Excel for financial analysis' })
  check('demo snapshot still writable', (await journeyExists()) === true)
  await saveSubmission(sub, [{ criterionId: 'demo-c1', met: true }], 'excel')
  const demoLearning = await loadLearning()
  check('demo learning still works', demoLearning.submissions.length >= 1 && demoLearning.mastery.length >= 1)
  const bJourneyBefore = await journeyExistsForLearner(userB.learnerId)
  const bMasteryBefore = await loadMasteryForLearner(userB.learnerId)
  const bLearningBefore = await loadLearningForLearner(userB.learnerId)
  const cJourneyBefore = await journeyExistsForLearner(userC.learnerId)
  await clearAll()
  check('demo reset still works', (await journeyExists()) === false && (await loadSnapshot()) === null)
  check(
    'demo reset preserves registered journeys',
    bJourneyBefore === true && (await journeyExistsForLearner(userB.learnerId)) === true &&
    cJourneyBefore === true && (await journeyExistsForLearner(userC.learnerId)) === true,
  )
  check(
    'demo reset preserves registered mastery',
    bMasteryBefore.length >= 1 &&
    JSON.stringify(await loadMasteryForLearner(userB.learnerId)) === JSON.stringify(bMasteryBefore),
  )
  const bLearningAfter = await loadLearningForLearner(userB.learnerId)
  check(
    'demo reset preserves registered learning',
    bLearningAfter.submissions.length === bLearningBefore.submissions.length &&
    bLearningBefore.submissions.length === 1 &&
    bLearningAfter.feedback.length === 1 &&
    bLearningAfter.evidence.length === 1,
  )
}

// ---- Block C: real-PostgreSQL-only proof (skipped on pg-mem) ----
if (process.env.TEST_DATABASE_URL) {
  const realPool = new PgPool({ connectionString: process.env.TEST_DATABASE_URL })
  try {
    overridePoolForTests(realPool)
    await initDb()
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
    const u1 = await createUser({ email: `rc1-${suffix}@example.com`, passwordHash: 'hash-fixture-rc1-0123456789' })
    const u2 = await createUser({ email: `rc2-${suffix}@example.com`, passwordHash: 'hash-fixture-rc2-0123456789' })
    const rcBase = {
      template: 'excel',
      experience: 'Tried it before',
      hoursPerWeek: '4 hours',
      answers: [],
      score: 0,
      level: 'Starting out',
      pathTitle: 'T',
      pathOutcome: 'O',
      pathLevel: 'L',
      stages: [],
      completedStageIds: [],
      parsedGoal: null,
    }
    await saveSnapshotForLearner(u1.learnerId, { ...rcBase, goalText: 'RC one learns Excel for finance' })
    await saveSnapshotForLearner(u2.learnerId, { ...rcBase, goalText: 'RC two learns Excel for finance' })
    const rcSub = { stageId: 's1', kind: 'practice', response: 'r', verdict: 'retry', strengths: '[]', improvements: '[]', nextAction: 'x' }
    await saveSubmissionForLearner(u1.learnerId, rcSub, [{ criterionId: 'rc-shared-c1', met: true }], 'excel')
    await saveSubmissionForLearner(u2.learnerId, rcSub, [{ criterionId: 'rc-shared-c1', met: false }], 'excel')
    const rcM1 = await loadMasteryForLearner(u1.learnerId)
    const rcM2 = await loadMasteryForLearner(u2.learnerId)
    check(
      'real PG: same criterion coexists across learners',
      rcM1.some((m) => m.criterionId === 'rc-shared-c1' && m.masteryStatus === 'demonstrated') &&
      rcM2.some((m) => m.criterionId === 'rc-shared-c1' && m.masteryStatus === 'developing'),
    )
    const { rows: idxRows } = await realPool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_mastery_learner_unique', 'idx_goals_learner_unique')`,
    )
    check('real PG: per-learner unique indexes exist', idxRows.length === 2)
    // Leave the shared test database tidy.
    await clearAllForLearner(u1.learnerId)
    await clearAllForLearner(u2.learnerId)
    await realPool.query('DELETE FROM sessions WHERE user_id = $1 OR user_id = $2', [u1.id, u2.id])
    await realPool.query('DELETE FROM users WHERE id = $1 OR id = $2', [u1.id, u2.id])
    await realPool.query('DELETE FROM learners WHERE id = $1 OR id = $2', [u1.learnerId, u2.learnerId])
    check('real PG: cleanup removed Block C journeys', (await journeyExistsForLearner(u1.learnerId)) === false)
  } finally {
    await realPool.end()
    overridePoolForTests(null)
  }
} else {
  console.log('SKIP real-PostgreSQL constraint-removal proof (set TEST_DATABASE_URL to run it)')
}

overridePoolForTests(null)

if (failures > 0) {
  console.log(`AUTH-STORES-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('AUTH-STORES-ALL-PASS')
