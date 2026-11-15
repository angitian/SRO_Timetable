import test from 'node:test'
import assert from 'node:assert/strict'

import { pickAutoOpenTarget } from './src/utils/workspacePreference.js'

const local = (id, updatedAt = 1) => ({ kind: 'local', id, updatedAt })
const cloud = (id, updatedAt = 1) => ({ kind: 'cloud', id, updatedAt })

test('cloud preference wins even when a local snapshot is newer', () => {
  const result = pickAutoOpenTarget({
    preference: { kind: 'cloud', id: 'c1' },
    localItems: [local('l1', 999)],
    cloudItems: [cloud('c1', 10)],
    user: true,
  })
  assert.deepEqual(result.target, { kind: 'cloud', id: 'c1' })
  assert.equal(result.keepPreference, true)
  assert.equal(result.needsLogin, false)
})

test('cloud preference without login falls back to local but keeps the preference', () => {
  const result = pickAutoOpenTarget({
    preference: { kind: 'cloud', id: 'c1' },
    localItems: [local('l1', 5), local('l2', 50)],
    cloudItems: [],
    user: false,
  })
  assert.deepEqual(result.target, { kind: 'local', id: 'l2' })
  assert.equal(result.keepPreference, true)
  assert.equal(result.needsLogin, true)
})

test('deleted cloud workspace clears the preference and uses the newest', () => {
  const result = pickAutoOpenTarget({
    preference: { kind: 'cloud', id: 'gone' },
    localItems: [local('l1', 5)],
    cloudItems: [cloud('c2', 100)],
    user: true,
  })
  assert.deepEqual(result.target, { kind: 'cloud', id: 'c2' })
  assert.equal(result.keepPreference, false)
})

test('local preference is respected even when cloud is newer', () => {
  const result = pickAutoOpenTarget({
    preference: { kind: 'local', id: 'l1' },
    localItems: [local('l1', 5)],
    cloudItems: [cloud('c1', 999)],
    user: true,
  })
  assert.deepEqual(result.target, { kind: 'local', id: 'l1' })
  assert.equal(result.keepPreference, true)
})

test('without preference the newest of local+cloud wins', () => {
  const result = pickAutoOpenTarget({
    preference: null,
    localItems: [local('l1', 5)],
    cloudItems: [cloud('c1', 500)],
    user: true,
  })
  assert.deepEqual(result.target, { kind: 'cloud', id: 'c1' })
})

test('empty stores return no target', () => {
  const result = pickAutoOpenTarget({ preference: null, localItems: [], cloudItems: [], user: false })
  assert.equal(result.target, null)
})
