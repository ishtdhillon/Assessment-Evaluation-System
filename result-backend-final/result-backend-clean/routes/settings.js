const express = require('express');
const router  = express.Router();
const db      = require('../config/pgdb');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET  /api/settings
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM settings LIMIT 1');
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT  /api/settings
router.put('/', adminOnly, async (req, res) => {
  try {
    const { collegeName, departmentName } = req.body;
    await db.query(
      `UPDATE settings SET college_name=?, department_name=? WHERE id=1`,
      [collegeName, departmentName]
    );
    res.json({ message: 'Settings updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
