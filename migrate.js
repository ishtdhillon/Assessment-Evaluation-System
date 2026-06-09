/**
 * Supabase Schema Migration via Management API
 * Uses the pg REST endpoint directly to run DDL.
 */
const https = require("https");

const PROJECT_REF = "zepjjhefogjwcrorkedw";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcGpqaGVmb2dqd2Nyb3JrZWR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDg2MzgyOCwiZXhwIjoyMDkwNDM5ODI4fQ.tdBP7RGATdVJencaGaN1Jrm9WATf7syT-4cHYNyKLs8";

// The full migration SQL
const MIGRATION_SQL = `
-- faculty
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '';
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- semesters
ALTER TABLE semesters ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT '';
ALTER TABLE semesters ADD COLUMN IF NOT EXISTS batch TEXT NOT NULL DEFAULT '';
ALTER TABLE semesters ADD COLUMN IF NOT EXISTS program TEXT NOT NULL DEFAULT '';
ALTER TABLE semesters ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- subjects
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS semester_id TEXT NOT NULL DEFAULT '';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS credits TEXT NOT NULL DEFAULT '';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS internal_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS external_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- students
ALTER TABLE students ADD COLUMN IF NOT EXISTS semester_id TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS uid TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS roll_no TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- assignments
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS faculty_id TEXT NOT NULL DEFAULT '';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS subject_id TEXT NOT NULL DEFAULT '';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- marks_sheets
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS assignment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS faculty_id TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS sheet_mode TEXT NOT NULL DEFAULT 'final';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS assessment_label TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS exam_date TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS internal_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS external_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS sheet_note TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheets ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- marks_sheet_entries
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS sheet_id TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS student_id TEXT;
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS roll_no TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS student_uid TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS student_name TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Present';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS attendance TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS internal_value TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS external_value TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT '';
ALTER TABLE marks_sheet_entries ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
`;

function pgRequest(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request(
      {
        hostname: `${PROJECT_REF}.supabase.co`,
        path: "/rest/v1/rpc/exec_ddl",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Length": Buffer.byteLength(body),
          Prefer: "return=representation",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Use pg directly via the db endpoint
function pgDirect(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request(
      {
        hostname: "api.supabase.com",
        path: `/v1/projects/${PROJECT_REF}/database/query`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("Attempting migration via Supabase Management API…");
  const result = await pgDirect(MIGRATION_SQL);
  console.log("Status:", result.status);
  console.log("Response:", result.body.slice(0, 500));

  if (result.status === 200 || result.status === 201) {
    console.log("\n✅ Migration succeeded!");
  } else {
    console.log("\n❌ Migration failed. See response above.");
    console.log("\nPlease run this SQL manually in your Supabase SQL Editor:");
    console.log("https://supabase.com/dashboard/project/" + PROJECT_REF + "/sql/new");
    console.log("\n" + MIGRATION_SQL);
  }
}

main().catch(console.error);
