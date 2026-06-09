-- ============================================================
-- CSE Result Management System — PostgreSQL Schema
-- Paste this entire file in Supabase SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS admin (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO admin (username, password)
VALUES ('hod.cse', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS faculty (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  phone       VARCHAR(15) UNIQUE NOT NULL,
  email       VARCHAR(100),
  designation VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_store (
  id         SERIAL PRIMARY KEY,
  phone      VARCHAR(15) NOT NULL,
  email      VARCHAR(100),
  code       VARCHAR(6) NOT NULL,
  expires_at BIGINT NOT NULL,
  used       SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_store(phone);

CREATE TABLE IF NOT EXISTS semesters (
  id         VARCHAR(36) PRIMARY KEY,
  name       VARCHAR(50) NOT NULL,
  section    VARCHAR(10) NOT NULL,
  batch      VARCHAR(20) NOT NULL,
  program    VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subjects (
  id           VARCHAR(36) PRIMARY KEY,
  semester_id  VARCHAR(36) NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  code         VARCHAR(20) NOT NULL,
  credits      VARCHAR(5) NOT NULL,
  internal_max INT DEFAULT 30,
  external_max INT DEFAULT 70,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
  id         VARCHAR(36) PRIMARY KEY,
  faculty_id VARCHAR(36) NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  subject_id VARCHAR(36) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (faculty_id, subject_id)
);

CREATE TABLE IF NOT EXISTS students (
  id          VARCHAR(36) PRIMARY KEY,
  semester_id VARCHAR(36) NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  roll_no     VARCHAR(20),
  uid         VARCHAR(20) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (semester_id, uid)
);

CREATE TABLE IF NOT EXISTS marks_sheets (
  id               VARCHAR(36) PRIMARY KEY,
  assignment_id    VARCHAR(36) NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  faculty_id       VARCHAR(36) NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  sheet_mode       VARCHAR(10) DEFAULT 'final',
  assessment_label VARCHAR(100) NOT NULL,
  academic_year    VARCHAR(20) NOT NULL,
  exam_date        DATE NOT NULL,
  internal_max     INT DEFAULT 30,
  external_max     INT DEFAULT 70,
  sheet_note       TEXT,
  status           VARCHAR(10) DEFAULT 'draft',
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS marks_entries (
  id           SERIAL PRIMARY KEY,
  sheet_id     VARCHAR(36) NOT NULL REFERENCES marks_sheets(id) ON DELETE CASCADE,
  student_id   VARCHAR(36) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  roll_no      VARCHAR(20),
  student_uid  VARCHAR(20),
  student_name VARCHAR(100),
  status       VARCHAR(10) DEFAULT 'Present',
  attendance   VARCHAR(5)  DEFAULT '100',
  internal     VARCHAR(10) DEFAULT '',
  external     VARCHAR(10) DEFAULT '',
  remarks      TEXT,
  UNIQUE (sheet_id, student_id)
);

CREATE TABLE IF NOT EXISTS settings (
  id              SERIAL PRIMARY KEY,
  college_name    VARCHAR(200) DEFAULT 'Akal University',
  department_name VARCHAR(200) DEFAULT 'Department of Computer Science and Engineering'
);
INSERT INTO settings (college_name, department_name)
VALUES ('Akal University', 'Department of Computer Science and Engineering')
ON CONFLICT DO NOTHING;
