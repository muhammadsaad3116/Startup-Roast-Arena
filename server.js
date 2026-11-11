
import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import connectDB from './Db.js';
import User from './models/User.js';
import Idea from './models/Idea.js';
import Pitch from './models/pitch.js';
import Verdict from './models/verdict.js';
import Vote from './models/vote.js';

import { runPanel, defaultLlm } from './AI.js';
import { LEVELS, FIELD_MAX, aiScore, leaderboardScore } from './rules.js';

class HttpError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

const INDEX = fileURLToPath(new URL('./index.html', import.meta.url));

export function createApp(llm = defaultLlm) {

  const userFrom = async req => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const user = token && await User.findOne({ token });
    if (!user) throw new HttpError(401, 'login required');
    return user;
  };

  function readPitch(b) {
    const out = {};

    for (const f of ['problem', 'solution', 'customer']) {
      const v = typeof b[f] === 'string' ? b[f].trim() : '';

      if (v.length < 10 || v.length > FIELD_MAX) {
        throw new HttpError(400, `${f} must be 10-${FIELD_MAX} characters`);
      }

      out[f] = v;
    }

    if (!LEVELS.includes(b.roast_level)) {
      throw new HttpError(400, `roast_level must be one of ${LEVELS}`);
    }

    out.roast_level = b.roast_level;
    return out;
  }

  async function savePitch(ideaId, ownerId, version, p) {
    const verdicts = await runPanel(p.roast_level, p, llm);
    const score = aiScore(verdicts);

    let idea;

    if (!ideaId) {
      idea = await Idea.create({ owner: ownerId });
    } else {
      idea = await Idea.findById(ideaId);
      if (!idea) throw new HttpError(404, 'idea not found');
    }

    const pitch = await Pitch.create({
      idea: idea._id,
      version,
      ...p,
      ai_score: score
    });

    await Verdict.insertMany(
      verdicts.map(v => ({
        pitch: pitch._id,
        ...v
      }))
    );

    return idea._id;
  }

  async function ideaView(id) {
    const idea = await Idea.findById(id).populate('owner', 'name');

    if (!idea) throw new HttpError(404, 'idea not found');

    const pitches = await Pitch.find({ idea: idea._id }).sort({ version: 1 });

    const result = [];

    for (const p of pitches) {
      const verdicts = await Verdict.find({ pitch: p._id })
        .select('investor status score roast tip offer_lakh equity_pct');

      result.push({
        id: p._id.toString(),
        idea: p.idea.toString(),
        version: p.version,
        problem: p.problem,
        solution: p.solution,
        customer: p.customer,
        roast_level: p.roast_level,
        ai_score: p.ai_score,
        verdicts
      });
    }

    const votes = await Vote.countDocuments({ idea: idea._id });

    const last = result.at(-1);
    const prev = result.at(-2);

    const delta =
      last?.ai_score != null && prev?.ai_score != null
        ? Math.round((last.ai_score - prev.ai_score) * 10) / 10
        : null;

    return {
      id: idea._id.toString(),
      owner_id: idea.owner._id.toString(),
      owner: idea.owner.name,
      votes,
      pitches: result,
      delta
    };
  }

  async function leaderboard() {
    const ideas = await Idea.find();
    const list = [];

    for (const idea of ideas) {
      const item = await ideaView(idea._id);
      const last = item.pitches.at(-1);

      if (last?.ai_score == null) continue;

      list.push({
        id: item.id,
        owner: item.owner,
        problem: last.problem,
        version: last.version,
        ai_score: last.ai_score,
        votes: item.votes,
        score: leaderboardScore(last.ai_score, item.votes)
      });
    }

    return list.sort((a, b) => b.score - a.score).slice(0, 20);
  }

  async function route(req, body) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    let match;

    if (req.method === 'POST' && path === '/api/login') {
      const name = String(body.name || '').trim().slice(0, 40);

      if (name.length < 2) throw new HttpError(400, 'name too short');

      if (await User.findOne({ name })) {
        throw new HttpError(409, 'name taken');
      }

      const token = crypto.randomBytes(16).toString('hex');

      await User.create({ name, token });

      return { name, token };
    }

    if (req.method === 'POST' && path === '/api/ideas') {
      const user = await userFrom(req);
      const id = await savePitch(null, user._id, 1, readPitch(body));
      return ideaView(id);
    }

    if (
      req.method === 'POST' &&
      (match = path.match(/^\/api\/ideas\/([a-f\d]{24})\/repitch$/i))
    ) {
      const user = await userFrom(req);
      const idea = await ideaView(match[1]);

      if (idea.owner_id !== user._id.toString()) {
        throw new HttpError(403, 'only the founder can re-pitch');
      }

      await savePitch(
        match[1],
        user._id,
        idea.pitches.length + 1,
        readPitch(body)
      );

      return ideaView(match[1]);
    }

    if (
      req.method === 'POST' &&
      (match = path.match(/^\/api\/ideas\/([a-f\d]{24})\/vote$/i))
    ) {
      const user = await userFrom(req);
      const idea = await Idea.findById(match[1]);

      if (!idea) throw new HttpError(404, 'idea not found');

      if (idea.owner.toString() === user._id.toString()) {
        throw new HttpError(403, 'you cannot vote on your own idea');
      }

      try {
        await Vote.create({
          user: user._id,
          idea: idea._id,
          pitch_version: await Pitch.countDocuments({ idea: idea._id })
        });
      } catch (e) {
        if (e.code === 11000) {
          throw new HttpError(409, 'you already voted on this idea');
        }
        throw e;
      }

      return ideaView(match[1]);
    }

    if (
      req.method === 'GET' &&
      (match = path.match(/^\/api\/ideas\/([a-f\d]{24})$/i))
    ) {
      return ideaView(match[1]);
    }

    if (req.method === 'GET' && path === '/api/leaderboard') {
      return leaderboard();
    }

    throw new HttpError(404, 'not found');
  }

  return async (req, res) => {
    const send = (code, type, data) => {
      res.writeHead(code, { 'content-type': type });
      res.end(data);
    };

    try {
      if (req.method === 'GET' && req.url === '/') {
        return send(
          200,
          'text/html; charset=utf-8',
          await readFile(INDEX)
        );
      }

      let raw = '';

      for await (const c of req) {
        raw += c;
        if (raw.length > 20000) {
          throw new HttpError(413, 'body too large');
        }
      }

      let body = {};

      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HttpError(400, 'invalid JSON');
        }
      }

      send(
        200,
        'application/json',
        JSON.stringify(await route(req, body))
      );

    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);

      send(
        e.code || 500,
        'application/json',
        JSON.stringify({
          error: e.code ? e.message : 'server error'
        })
      );
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;

  connectDB().then(() => {
    http.createServer(createApp()).listen(port, () => {
      console.log(`Roast Arena on http://localhost:${port}`);
    });
  }).catch(err => {
    console.error('Database startup failed:', err);
    process.exit(1);
  });
}
