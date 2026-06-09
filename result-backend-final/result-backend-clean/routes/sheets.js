const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/pgdb');
const { authMiddleware, adminOnly, facultyOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET  /api/sheets?facultyId=xxx&assignmentId=xxx&status=submitted
router.get('/', async (req, res) => {
  try {
    const { facultyId, assignmentId, status } = req.query;

    let query = `
      SELECT ms.*,
             f.name  AS faculty_name,
             f.designation,
             s.name  AS subject_name,
             s.code  AS subject_code,
             s.credits,
             sem.name    AS semester_name,
             sem.section AS semester_section,
             sem.batch,
             sem.program
      FROM marks_sheets ms
      JOIN assignments a  ON a.id  = ms.assignment_id
      JOIN faculty f      ON f.id  = ms.faculty_id
      JOIN subjects s     ON s.id  = a.subject_id
      JOIN semesters sem  ON sem.id = s.semester_id
      WHERE 1=1
    `;
    const params = [];

    if (facultyId)    { query += ' AND ms.faculty_id = ?';    params.push(facultyId); }
    if (assignmentId) { query += ' AND ms.assignment_id = ?'; params.push(assignmentId); }
    if (status)       { query += ' AND ms.status = ?';        params.push(status); }

    // Faculty can only see their own sheets
    if (req.user.role === 'faculty') {
      query += ' AND ms.faculty_id = ?';
      params.push(req.user.id);
    }

    query += ' ORDER BY ms.updated_at DESC';
    const [sheets] = await db.query(query, params);

    // Attach entries for each sheet
    for (const sheet of sheets) {
      const [entries] = await db.query(
        'SELECT * FROM marks_entries WHERE sheet_id = ?', [sheet.id]
      );
      sheet.entries = entries;
    }

    res.json(sheets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET  /api/sheets/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM marks_sheets WHERE id = ?', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Sheet not found.' });

    const sheet = rows[0];

    // Faculty can only view their own
    if (req.user.role === 'faculty' && sheet.faculty_id !== req.user.id)
      return res.status(403).json({ error: 'Access denied.' });

    const [entries] = await db.query(
      'SELECT * FROM marks_entries WHERE sheet_id = ?', [sheet.id]
    );
    sheet.entries = entries;
    res.json(sheet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sheets   — create new sheet
router.post('/', facultyOnly, async (req, res) => {
  try {
    const {
      assignmentId, sheetMode, assessmentLabel,
      academicYear, examDate, internalMax, externalMax,
      sheetNote, status, entries
    } = req.body;

    if (!assignmentId || !assessmentLabel || !academicYear || !examDate)
      return res.status(400).json({ error: 'Required sheet fields missing.' });

    // Verify assignment belongs to this faculty (if faculty role)
    if (req.user.role === 'faculty') {
      const [asgn] = await db.query(
        'SELECT * FROM assignments WHERE id = ? AND faculty_id = ?',
        [assignmentId, req.user.id]
      );
      if (!asgn.length)
        return res.status(403).json({ error: 'Not your assignment.' });
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO marks_sheets
         (id, assignment_id, faculty_id, sheet_mode, assessment_label,
          academic_year, exam_date, internal_max, external_max, sheet_note, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, assignmentId, req.user.id,
       sheetMode || 'final', assessmentLabel,
       academicYear, examDate,
       internalMax || 30, externalMax || 70,
       sheetNote || '', status || 'draft']
    );

    // Save entries
    if (Array.isArray(entries)) {
      for (const e of entries) {
        await db.query(
          `INSERT INTO marks_entries
             (sheet_id, student_id, roll_no, student_uid, student_name,
              status, attendance, internal, external, remarks)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             status=VALUES(status), attendance=VALUES(attendance),
             internal=VALUES(internal), external=VALUES(external),
             remarks=VALUES(remarks)`,
          [id, e.studentId, e.rollNo || '', e.studentUid || '',
           e.studentName || '', e.status || 'Present',
           e.attendance || '100', e.internal ?? '', e.external ?? '',
           e.remarks || '']
        );
      }
    }

    const [row] = await db.query('SELECT * FROM marks_sheets WHERE id = ?', [id]);
    res.status(201).json(row[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT  /api/sheets/:id — update sheet + entries
router.put('/:id', facultyOnly, async (req, res) => {
  try {
    const {
      sheetMode, assessmentLabel, academicYear, examDate,
      internalMax, externalMax, sheetNote, status, entries
    } = req.body;

    // Ownership check
    const [existing] = await db.query(
      'SELECT * FROM marks_sheets WHERE id = ?', [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Sheet not found.' });

    if (req.user.role === 'faculty' && existing[0].faculty_id !== req.user.id)
      return res.status(403).json({ error: 'Not your sheet.' });

    await db.query(
      `UPDATE marks_sheets SET
         sheet_mode=?, assessment_label=?, academic_year=?, exam_date=?,
         internal_max=?, external_max=?, sheet_note=?, status=?
       WHERE id=?`,
      [sheetMode || existing[0].sheet_mode,
       assessmentLabel || existing[0].assessment_label,
       academicYear || existing[0].academic_year,
       examDate || existing[0].exam_date,
       internalMax ?? existing[0].internal_max,
       externalMax ?? existing[0].external_max,
       sheetNote ?? existing[0].sheet_note,
       status || existing[0].status,
       req.params.id]
    );

    if (Array.isArray(entries)) {
      for (const e of entries) {
        await db.query(
          `INSERT INTO marks_entries
             (sheet_id, student_id, roll_no, student_uid, student_name,
              status, attendance, internal, external, remarks)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             status=VALUES(status), attendance=VALUES(attendance),
             internal=VALUES(internal), external=VALUES(external),
             remarks=VALUES(remarks)`,
          [req.params.id, e.studentId, e.rollNo || '', e.studentUid || '',
           e.studentName || '', e.status || 'Present',
           e.attendance || '100', e.internal ?? '', e.external ?? '',
           e.remarks || '']
        );
      }
    }

    res.json({ message: 'Sheet updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sheets/:id  (admin only)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM marks_sheets WHERE id = ?', [req.params.id]);
    res.json({ message: 'Sheet deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sheets/dashboard/summary  — admin overview stats
router.get('/dashboard/summary', adminOnly, async (req, res) => {
  try {
    const [[{ students }]]   = await db.query('SELECT COUNT(*) AS students FROM students');
    const [[{ subjects }]]   = await db.query('SELECT COUNT(*) AS subjects FROM subjects');
    const [[{ faculty }]]    = await db.query('SELECT COUNT(*) AS faculty FROM faculty');
    const [[{ submitted }]]  = await db.query("SELECT COUNT(*) AS submitted FROM marks_sheets WHERE status='submitted'");
    const [[{ total_sheets }]] = await db.query('SELECT COUNT(*) AS total_sheets FROM marks_sheets');

    res.json({ students, subjects, faculty, submitted, total_sheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
