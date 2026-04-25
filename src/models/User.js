import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  googleId: {
    type: String,
    required: true,
    unique: true
  },
  avatar: {
    type: String,
    default: '',
  },
  profileSetup: {
    type: [String],
    validate: [
      {
        validator: function(val) {
          return val.length <= 4;
        },
        message: 'You can upload up to 4 images only'
      }
    ],
    default: []
  },
  height: {
    type: Number,
    min: [0, 'Height cannot be negative']
  },
  weight: {
    type: Number,
    min: [0, 'Weight cannot be negative']
  },
  fcmToken: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model('User', userSchema);
export default User;
