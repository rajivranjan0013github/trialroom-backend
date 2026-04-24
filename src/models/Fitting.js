import mongoose from 'mongoose';

const fittingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  personReferences: {
    type: [String], // All 4 person angles used
    required: true
  },
  outfitImages: {
    type: [String],
    required: true
  },
  detectedItems: [{
    label: String,
    point: [Number],
    scale: Number,
  }],
  selectedItems: [String],
  title: String,
  category: String,
  resultImage: {
    type: String, // Final AI result
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Fitting = mongoose.model('Fitting', fittingSchema);
export default Fitting;
