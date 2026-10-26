import assert from 'node:assert/strict';
import test from 'node:test';
import { olderThan, VERSION } from '../lib/version.mjs';

test('a server is older when its version comes first, or when it does not tell it', () => {
  assert.equal(olderThan('1.2.2', '1.3.0'), true);
  assert.equal(olderThan('1.9.3', '1.10.0'), true);
  assert.equal(olderThan('1.10.0', '1.9.3'), false);
  assert.equal(olderThan('1.3.0', '1.3.0'), false);
  assert.equal(olderThan('2.0.0', '1.3.0'), false);
  assert.equal(olderThan('1.3.0-beta.1', '1.3.0'), false);
  assert.equal(olderThan('', VERSION), true);
  assert.equal(olderThan(undefined, VERSION), true);
});
