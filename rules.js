
export const LEVELS = ['mild', 'medium', 'spicy'];
export const FIELD_MAX = 500; // max characters per pitch field

export const INVESTORS = {
  strict: {
    name: 'The Strict Investor', emoji: '🧐',
    brief: 'Ask hard questions about money, market size, pricing and competition.'
  },
  funny: {
    name: 'The Funny Investor', emoji: '😂',
    brief: 'Roast the idea with jokes, but still include one genuinely useful point.'
  },
  dreamer: {
    name: 'The Dreamer', emoji: '🌈',
    brief: 'See the big vision and suggest bold extensions of the idea.'
  }
};

export function bandFor(score) {
  if (score <= 3) return { min: 0, max: 0 };   // pass: no offer
  if (score <= 6) return { min: 1, max: 5 };
  return { min: 5, max: 25 };
}

const text = (v, min, max, label) => {
  if (typeof v !== 'string') throw new Error(`${label} must be a string`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new Error(`${label} length must be ${min}-${max}`);
  return s;
};


export function validateVerdict(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON object found');
    obj = JSON.parse(m[0]);
  }
  if (!obj || typeof obj !== 'object') throw new Error('not an object');

  const score = obj.score;
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new Error('score must be an integer 1-10');

  const roast = text(obj.roast, 5, 400, 'roast');
  const tip = text(obj.tip, 5, 250, 'tip');

  let offer = Number(obj.offer_lakh);
  let equity = Number(obj.equity_pct);
  if (!Number.isFinite(offer) || !Number.isFinite(equity)) throw new Error('offer/equity must be numbers');

  const band = bandFor(score);
  offer = Math.min(Math.max(offer, band.min), band.max);
  equity = offer === 0 ? 0 : Math.min(Math.max(equity, 5), 20);
  return { score, roast, tip, offer_lakh: offer, equity_pct: equity };
}


export function aiScore(verdicts) {
  const ok = verdicts.filter(v => v.status === 'ok');
  if (ok.length < 2) return null;
  return Math.round((ok.reduce((s, v) => s + v.score, 0) / ok.length) * 10) / 10;
}


export const LB = { wAi: 0.7, wVotes: 0.3, voteHalfLife: 5 };
export function leaderboardScore(ai, votes, cfg = LB) {
  const voteSignal = votes / (votes + cfg.voteHalfLife); // 0..1, saturates, resists vote-spam
  return Math.round((cfg.wAi * (ai / 10) + cfg.wVotes * voteSignal) * 1000) / 10;
}