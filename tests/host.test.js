import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { apply } from '../index.js';

function request(body, { method = 'POST', origin = 'http://localhost:3080' } = {}) {
  let route;
  apply({ effect: fn => fn(), webServer: {
    getOrigin: () => 'http://localhost:3080',
    register: value => { route = value; return () => {}; },
  } });
  const req = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.headers = { origin };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('endpoint did not respond')), 1000);
    const response = {
      writeHead(status) { this.status = status; },
      end(text) { clearTimeout(timeout); resolve({ status: this.status, body: JSON.parse(text) }); },
    };
    route.handler(req, response);
  });
}

test('resolve rejects malformed and non-object JSON without a detached exception', async () => {
  for (const body of ['null', '[]', '42', '"path"', '{']) {
    const result = await request(body);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'invalid-json');
  }
});

test('resolve enforces method, origin and absolute path checks', async () => {
  assert.equal((await request('{}', { method: 'GET' })).status, 405);
  assert.equal((await request('{}', { origin: 'https://example.com' })).status, 403);
  assert.deepEqual((await request('{"path":"relative"}')).body, { ok: false, error: 'not-absolute' });
});
