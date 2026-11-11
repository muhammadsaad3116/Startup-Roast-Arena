import mongoose from 'mongoose';

const pitchSchema = new mongoose.Schema({
  idea: { type: mongoose.Schema.Types.ObjectId, ref: 'Idea', required: true },
  version: Number,
  problem: String,
  solution: String,
  customer: String,
  roast_level: { type: String, required: true },
  ai_score: Number
}, { timestamps: true });

export default mongoose.model('Pitch', pitchSchema);