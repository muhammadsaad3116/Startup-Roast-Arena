import mongoose from 'mongoose';

const voteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  idea: { type: mongoose.Schema.Types.ObjectId, ref: 'Idea' },
  pitch_version: Number
}, { timestamps: true });

voteSchema.index({ user: 1, idea: 1 }, { unique: true });

export default mongoose.model('Vote', voteSchema);