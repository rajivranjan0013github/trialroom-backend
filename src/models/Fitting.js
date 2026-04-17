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
    type: [String], // Array of all garment URLs used (Real URLs from R2)
    required: true
  },
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
