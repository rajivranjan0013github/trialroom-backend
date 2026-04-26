import mongoose from 'mongoose';

const hairstyleFittingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  faceImageUrl: {
    type: String,
    required: true,
  },
  hairstyleId: {
    type: String,
    required: true,
  },
  hairstyleName: {
    type: String,
    required: true,
  },
  hairstyleCategory: {
    type: String,
    required: true,
  },
  resultImage: {
    type: String,
    required: true,
  },
  isFavorite: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const HairstyleFitting = mongoose.model('HairstyleFitting', hairstyleFittingSchema);
export default HairstyleFitting;
