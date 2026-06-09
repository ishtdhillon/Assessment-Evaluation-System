const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/pgdb');
const { authMiddleware, adminOnly } = require('../middleware/auth');

// All routes require login; most require admin
router.use(authMiddleware);

// ════════════════════════════════════════════════════════════
//  SEMESTERS
// ════════════════════════════════════════════════════════════

// GET  /api/semesters
router.get('/semesters', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM semesters ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semesters
router.post('/semesters', adminOnly, async (req, res) => {
  try {
    const { name, section, batch, program } = req.body;
    if (!name || !section || !batch || !program)
      return res.status(400).json({ error: 'All semester fields required.' });

    const id = uuidv4();
    await db.query(
      'INSERT INTO semesters (id, name, section, batch, program) VALUES (?,?,?,?,?)',
      [id, name.trim(), section.trim(), batch.trim(), program.trim()]
    );
    const [row] = await db.query('SELECT * FROM semesters WHERE id = ?', [id]);
    res.status(201).json(row[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/semesters/:id
router.delete('/semesters/:id', adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM semesters WHERE id = ?', [req.params.id]);
    res.json({ message: 'Semester removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  SUBJECTS
// ════════════════════════════════════════════════════════════

// GET  /api/subjects?semesterId=xxx
router.get('/subjects', async (req, res) => {
  try {
    const { semesterId } = req.query;
    let query = 'SELECT * FROM subjects';
    const params = [];
    if (semesterId) {
      query += ' WHERE semester_id = ?';
      params.push(semesterId);
    }
    query += ' ORDER BY name ASC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subjects
router.post('/subjects', adminOnly, async (req, res) => {
  try {
    const { semesterId, name, code, credits, internalMax, externalMax } = req.body;
    if (!semesterId || !name || !code || !credits)
      return res.status(400).json({ error: 'All subject fields required.' });

    const id = uuidv4();
    await db.query(
      `INSERT INTO subjects
         (id, semester_id, name, code, credits, internal_max, external_max)
       VALUES (?,?,?,?,?,?,?)`,
      [id, semesterId, name.trim(), code.trim().toUpperCase(),
       credits, internalMax || 30, externalMax || 70]
    );
    const [row] = await db.query('SELECT * FROM subjects WHERE id = ?', [id]);
    res.status(201).json(row[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subjects/:id
router.delete('/subjects/:id', adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM subjects WHERE id = ?', [req.params.id]);
    res.json({ message: 'Subject removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  FACULTY
// ════════════════════════════════════════════════════════════

// GET  /api/faculty
router.get('/faculty', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM faculty ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faculty
router.post('/faculty', adminOnly, async (req, res) => {
  try {
    const { name, phone, email, designation } = req.body;
    if (!name || !phone || !designation)
      return res.status(400).json({ error: 'Name, phone, and designation required.' });

    if (!/^\d{10}$/.test(phone))
      return res.status(400).json({ error: 'Valid 10-digit phone required.' });

    const id = uuidv4();
    await db.query(
      'INSERT INTO faculty (id, name, phone, email, designation) VALUES (?,?,?,?,?)',
      [id, name.trim(), phone, email || '', designation.trim()]
    );
    const [row] = await db.query('SELECT * FROM faculty WHERE id = ?', [id]);
    res.status(201).json(row[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Phone number already registered.' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/faculty/:id
router.delete('/faculty/:id', adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM faculty WHERE id = ?', [req.params.id]);
    res.json({ message: 'Faculty removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  ASSIGNMENTS
// ════════════════════════════════════════════════════════════

// GET  /api/assignments?facultyId=xxx
router.get('/assignments', async (req, res) => {
  try {
    const { facultyId } = req.query;
    let query = `
      SELECT a.*, f.name AS faculty_name, f.designation,
             s.name AS subject_name, s.code, s.credits,
             s.internal_max, s.external_max, s.semester_id,
             sem.name AS semester_name, sem.section, sem.batch, sem.program
      FROM assignments a
      JOIN faculty f  ON f.id = a.faculty_id
      JOIN subjects s ON s.id = a.subject_id
      JOIN semesters sem ON sem.id = s.semester_id
    `;
    const params = [];
    if (facultyId) {
      query += ' WHERE a.faculty_id = ?';
      params.push(facultyId);
    }
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assignments
router.post('/assignments', adminOnly, async (req, res) => {
  try {
    const { facultyId, subjectId } = req.body;
    if (!facultyId || !subjectId)
      return res.status(400).json({ error: 'Faculty and subject required.' });

    const id = uuidv4();
    await db.query(
      'INSERT INTO assignments (id, faculty_id, subject_id) VALUES (?,?,?)',
      [id, facultyId, subjectId]
    );
    res.status(201).json({ id, facultyId, subjectId, message: 'Assigned.' });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Already assigned.' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/assignments/:id
router.delete('/assignments/:id', adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM assignments WHERE id = ?', [req.params.id]);
    res.json({ message: 'Assignment removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
