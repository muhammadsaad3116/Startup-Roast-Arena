import mongoose from 'mongoose';

const verdictSchema = new mongoose.Schema({
  pitch: { type: mongoose.Schema.Types.ObjectId, ref: 'Pitch' },
  investor: String,
  status: String,
  score: Number,
  roast: String,
  tip: String,
  offer_lakh: Number,
  equity_pct: Number
});

export default mongoose.model('Verdict', verdictSchema);