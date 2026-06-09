const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/pgdb');
const { sendOtpEmail } = require('../config/mailer');
require('dotenv').config();

// ─── Helper ──────────────────────────────────────────────────
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  });
}

// ─── POST /api/auth/admin/login ───────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required.' });

    const [rows] = await db.query(
      'SELECT * FROM admin WHERE username = ?', [username]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Invalid username or password.' });

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match)
      return res.status(401).json({ error: 'Invalid username or password.' });

    const token = signToken({ id: admin.id, role: 'admin' });
    res.json({ token, role: 'admin', message: 'Login successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during admin login.' });
  }
});

// ─── POST /api/auth/faculty/request-otp ──────────────────────
// Body: { phone, email, name?, designation? }
router.post('/faculty/request-otp', async (req, res) => {
  try {
    const { phone, email, name, designation } = req.body;

    if (!phone || !/^\d{10}$/.test(phone))
      return res.status(400).json({ error: 'Valid 10-digit phone required.' });
    if (!email)
      return res.status(400).json({ error: 'Email address required to receive OTP.' });

    // Check if faculty exists
    const [existing] = await db.query(
      'SELECT * FROM faculty WHERE phone = ?', [phone]
    );

    // New faculty registration — require name
    if (!existing.length && !name)
      return res.status(400).json({ error: 'Name required for first-time registration.' });

    // Auto-register new faculty
    if (!existing.length) {
      await db.query(
        'INSERT INTO faculty (id, name, phone, email, designation) VALUES (?,?,?,?,?)',
        [uuidv4(), name.trim(), phone, email.trim(), designation || 'Faculty']
      );
    } else {
      // Update email if provided
      await db.query('UPDATE faculty SET email = ? WHERE phone = ?', [email, phone]);
    }

    // Generate OTP
    const otp       = generateOtp();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Save OTP (invalidate old ones first)
    await db.query('UPDATE otp_store SET used = 1 WHERE phone = ? AND used = 0', [phone]);
    await db.query(
      'INSERT INTO otp_store (phone, email, code, expires_at) VALUES (?,?,?,?)',
      [phone, email, otp, expiresAt]
    );

    // Send OTP via AWS SES
    const facultyName = existing[0]?.name || name;
    await sendOtpEmail(email, otp, facultyName);

    res.json({ message: `OTP sent to ${email}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send OTP. Check SES configuration.' });
  }
});

// ─── POST /api/auth/faculty/verify-otp ───────────────────────
// Body: { phone, otp }
router.post('/faculty/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp)
      return res.status(400).json({ error: 'Phone and OTP required.' });

    const [rows] = await db.query(
      `SELECT * FROM otp_store
       WHERE phone = ? AND code = ? AND used = 0
       ORDER BY created_at DESC LIMIT 1`,
      [phone, otp]
    );

    if (!rows.length)
      return res.status(401).json({ error: 'Invalid OTP.' });

    const record = rows[0];
    if (record.expires_at < Date.now())
      return res.status(401).json({ error: 'OTP has expired. Request a new one.' });

    // Mark OTP as used
    await db.query('UPDATE otp_store SET used = 1 WHERE id = ?', [record.id]);

    // Get faculty
    const [faculty] = await db.query(
      'SELECT * FROM faculty WHERE phone = ?', [phone]
    );
    if (!faculty.length)
      return res.status(404).json({ error: 'Faculty record not found.' });

    const token = signToken({ id: faculty[0].id, role: 'faculty' });
    res.json({
      token,
      role: 'faculty',
      faculty: {
        id:          faculty[0].id,
        name:        faculty[0].name,
        phone:       faculty[0].phone,
        email:       faculty[0].email,
        designation: faculty[0].designation
      },
      message: `Welcome, ${faculty[0].name}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during OTP verification.' });
  }
});

module.exports = router;
