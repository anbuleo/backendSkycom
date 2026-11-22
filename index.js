import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import Router from './src/routes/index.js';
import { connectDB } from './src/common/db.connect.js';
import { generateMonthlyCollections } from './src/controllers/collection.controller.js';

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

const allowedOrigins = process.env.FrontUri
  ? process.env.FrontUri.split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean)
  : [];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0) {
      return callback(null, true);
    }
    const normalizedOrigin = origin.replace(/\/$/, '');
    if (
      allowedOrigins.includes(normalizedOrigin) ||
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(normalizedOrigin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition', 'X-Refreshed-Token'],
  credentials: true,
};

app.use(cors(corsOptions));

const isProd = process.env.NODE_ENV === 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 25 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 600 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many requests. Please slow down and try again shortly.',
  },
});

app.use('/api/user/signin', authLimiter);
app.use('/api/user/signup', authLimiter);
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', Router);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'Field';
    message = `${field} already exists`;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    message = err.message || 'File upload error';
  }

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
});

// Runs automatically at 00:05 AM on the 1st of every month in configured local timezone
cron.schedule(
  '5 0 1 * *',
  async () => {
    console.log('Running scheduled monthly subscription billing...');
    await generateMonthlyCollections();
  },
  {
    timezone: process.env.TZ || 'Asia/Kolkata',
  }
);

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  connectDB()
    .then(() => {
      app.listen(PORT, () => console.log(`App Listening on Port ${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to start server due to DB error:', err.message);
      process.exit(1);
    });
}

export default app;
