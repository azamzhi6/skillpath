// Browser-cache namespace purity (no DOM needed: only pure key builders).
// Run: npm run test:storage-keys
// Proves account switching cannot collide caches: demo keeps the legacy
// keys (existing caches keep working) and every account gets isolated keys.
import { activityCacheKey, journeyCacheKey } from '../src/storage.ts'

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name)
  if (!cond) failures++
}

check('demo journey keeps legacy key', journeyCacheKey({ kind: 'demo' }) === 'skillpath.prototype.v1')
check('demo activity keeps legacy key', activityCacheKey({ kind: 'demo' }) === 'skillpath.activity.v1')

const keyA1 = journeyCacheKey({ kind: 'user', id: 'user-a' })
const keyA2 = journeyCacheKey({ kind: 'user', id: 'user-a' })
const keyB = journeyCacheKey({ kind: 'user', id: 'user-b' })
check('account journey keys are stable', keyA1 === keyA2)
check('account journey keys differ per account', keyA1 !== keyB)
check('account journey keys never collide with demo', keyA1 !== 'skillpath.prototype.v1' && keyB !== 'skillpath.prototype.v1')

const actA = activityCacheKey({ kind: 'user', id: 'user-a' })
const actB = activityCacheKey({ kind: 'user', id: 'user-b' })
check('account activity keys differ per account', actA !== actB)
check('account activity keys never collide with demo', actA !== 'skillpath.activity.v1')

if (failures > 0) {
  console.log(`STORAGE-KEYS-FAILURES: ${failures}`)
  process.exit(1)
}
console.log('STORAGE-KEYS-ALL-PASS')
