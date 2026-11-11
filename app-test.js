import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from './Db.js';
import { createApp } from './server.js';
import { mockLlm, runInvestor } from './AI.js';
import { validateVerdict, aiScore, leaderboardScore } from './rules.js';

const good = { score: 7, roast: 'Decent start, weak moat.', tip: 'Find a niche first.', offer_lakh: 8, equity_pct: 10 };

test('validator rejects bad score, bad JSON and non-JSON', () => {
  assert.throws(() => validateVerdict({ ...good, score: 11 }));
  assert.throws(() => validateVerdict({ ...good, score: 0 }));
  assert.throws(() => validateVerdict({ ...good, score: 7.5 }));
  assert.throws(() => validateVerdict('I refuse to answer'));
  assert.throws(() => validateVerdict('{"score": 5,'));
});

test('validator clamps funding to the band and strips code fences', () => {
  const v = validateVerdict('```json\n' + JSON.stringify({ ...good, offer_lakh: 9999, equity_pct: 90 }) + '\n```');
  assert.equal(v.offer_lakh, 25);
  assert.equal(v.equity_pct, 20);
  const low = validateVerdict({ ...good, score: 2, offer_lakh: 50 });
  assert.equal(low.offer_lakh, 0);   // score 1-3 => no offer
  assert.equal(low.equity_pct, 0);
});

test('retry recovers from a bad first answer; total failure becomes "passed"', async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? 'garbage' : JSON.stringify(good));
  const ok = await runInvestor('strict', 'mild', { problem: 'p', solution: 's', customer: 'c' }, flaky);
  assert.equal(ok.status, 'ok'); assert.equal(calls, 3);
  const dead = await runInvestor('strict', 'mild', { problem: 'p', solution: 's', customer: 'c' }, async () => { throw new Error('down'); });
  assert.equal(dead.status, 'passed'); assert.equal(dead.score, null);
});

test('AI score needs at least 2 investors; leaderboard math saturates', () => {
  const v = s => ({ status: 'ok', score: s });
  assert.equal(aiScore([v(6), v(8), { status: 'passed' }]), 7);
  assert.equal(aiScore([v(6), { status: 'passed' }, { status: 'passed' }]), null);
  assert.ok(leaderboardScore(7, 1000) < 100);
  assert.ok(leaderboardScore(7, 10) > leaderboardScore(7, 0));
});

test('full API flow: voting rules, re-pitch, leaderboard', async () => {
  const server = http.createServer(createApp(openDb(), mockLlm));
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/api`;
  const call = async (path, method = 'GET', body, token) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  try {
    const a = (await call('/login', 'POST', { name: 'Ali' })).data.token;
    const b = (await call('/login', 'POST', { name: 'Sara' })).data.token;
    const pitch = { problem: 'Students cannot get honest feedback', solution: 'AI investors roast ideas', customer: 'University students', roast_level: 'spicy' };

    assert.equal((await call('/ideas', 'POST', pitch)).status, 401);                       // no login
    assert.equal((await call('/ideas', 'POST', { ...pitch, roast_level: 'nuclear' }, a)).status, 400);
    assert.equal((await call('/ideas', 'POST', { ...pitch, problem: 'short' }, a)).status, 400);

    const created = await call('/ideas', 'POST', pitch, a);
    assert.equal(created.status, 200);
    const id = created.data.id;
    assert.equal(created.data.pitches[0].verdicts.length, 3);

    assert.equal((await call(`/ideas/${id}/vote`, 'POST', null, a)).status, 403);          // own idea
    assert.equal((await call(`/ideas/${id}/vote`, 'POST', null, b)).status, 200);
    assert.equal((await call(`/ideas/${id}/vote`, 'POST', null, b)).status, 409);          // double vote

    assert.equal((await call(`/ideas/${id}/repitch`, 'POST', pitch, b)).status, 403);      // not the founder
    const re = await call(`/ideas/${id}/repitch`, 'POST', { ...pitch, solution: 'AI investors roast ideas and founders re-pitch' }, a);
    assert.equal(re.data.pitches.length, 2);
    assert.equal(re.data.votes, 1);                                                        // votes carry over

    const lb = await call('/leaderboard');
    assert.equal(lb.data.length, 1);
    assert.equal(lb.data[0].version, 2);
  } finally { server.close(); }
});