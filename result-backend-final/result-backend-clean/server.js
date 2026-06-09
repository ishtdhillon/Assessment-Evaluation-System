require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api',           require('./routes/academic'));   // semesters, subjects, faculty, assignments
app.use('/api/students',  require('./routes/students'));
app.use('/api/sheets',    require('./routes/sheets'));
app.use('/api/settings',  require('./routes/settings'));

// ─── 404 fallback ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ─── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀  Server running on port ${PORT}`);
  console.log(`📡  Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Pull in DB connection (logs success/failure on startup)
require('./config/db');
