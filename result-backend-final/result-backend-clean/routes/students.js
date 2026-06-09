const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/pgdb');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET  /api/students?semesterId=xxx
router.get('/', async (req, res) => {
  try {
    const { semesterId, search } = req.query;
    let query  = 'SELECT * FROM students WHERE 1=1';
    const params = [];

    if (semesterId) { query += ' AND semester_id = ?'; params.push(semesterId); }
    if (search) {
      query += ' AND (roll_no LIKE ? OR uid LIKE ? OR name LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    query += ' ORDER BY roll_no + 0 ASC, uid ASC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/students   — single or bulk
router.post('/', adminOnly, async (req, res) => {
  try {
    const { semesterId, students } = req.body;
    // students = [{ rollNo, uid, name }, ...]

    if (!semesterId || !Array.isArray(students) || !students.length)
      return res.status(400).json({ error: 'semesterId and students[] required.' });

    let added = 0;
    for (const s of students) {
      if (!s.uid || !s.name) continue;
      const id = uuidv4();
      try {
        await db.query(
          'INSERT INTO students (id, semester_id, roll_no, uid, name) VALUES (?,?,?,?,?)',
          [id, semesterId, s.rollNo || '', s.uid.toUpperCase(), s.name.trim()]
        );
        added++;
      } catch (e) {
        if (e.code !== '23505') throw e;
      }
    }
    res.status(201).json({ added, message: `${added} student(s) added.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/students/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM students WHERE id = ?', [req.params.id]);
    res.json({ message: 'Student removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
