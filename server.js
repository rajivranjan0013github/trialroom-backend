import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Routes
import authRoutes from './src/routes/authRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import aiRoutes from './src/routes/aiRoutes.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('🍃 Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Register Routes
app.use('/api/v1', aiRoutes); // Priority
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date() });
});

// JSON 404 Handler - Strengthened (Express 5 compatible)
app.use((req, res) => {
  res.status(404).json({ 
    status: 'Error', 
    message: `Route ${req.method} ${req.originalUrl} not found`,
    hint: 'Ensure you are using the correct method and path'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.stack);
  res.status(500).json({ 
    status: 'Error', 
    message: 'Internal Server Error',
    detail: err.message
  });
});

app.listen(PORT, () => {
  console.log(`
  🚀 TrailRoom Backend Refactored & Running!
  📡 Port: ${PORT}
  🌍 Environment: ${process.env.NODE_ENV}
  ✨ Routes Registered: /api/v1/remove-bg, /api/v1/modelify, etc.
  `);
});
