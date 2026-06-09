const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const DEFAULT_ADMIN = {
  username: "Upinder Kaur",
  password: "Upinder@1234"
};
const OTP_LIFETIME_MS = 5 * 60 * 1000;
const SESSION_COOKIE_NAME = "portal_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;


const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function toCamel(obj) {
  if (!obj) return null;
  const newObj = {};
  for (const key in obj) {
    const camelKey = key.replace(/([-_][a-z])/ig, ($1) => {
      return $1.toUpperCase().replace('-', '').replace('_', '');
    });
    newObj[camelKey] = obj[key];
  }
  return newObj;
}


const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};



function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  });
  response.end(text);
}

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request) {
  try {
    return JSON.parse(await readRequestBody(request));
  } catch (error) {
    return null;
  }
}

function isValidState(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }

  return [
    "settings",
    "admin",
    "session",
    "otp",
    "semesters",
    "faculty",
    "subjects",
    "assignments",
    "students",
    "marksSheets"
  ].every((key) => key in candidate);
}

function serializeNullableJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function parseNullableJson(value) {
  if (value == null || value === "") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function serializeMarkValue(value) {
  return value === "" || value == null ? "" : String(value);
}

function parseMarkValue(value) {
  if (value === "" || value == null) {
    return "";
  }

  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? String(value) : numericValue;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isPasswordHash(value) {
  return typeof value === "string" && value.startsWith("scrypt$");
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  if (!isPasswordHash(storedHash)) {
    return String(password || "") === storedHash;
  }

  const [, salt, expectedHash] = storedHash.split("$");

  if (!salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.scryptSync(String(password || ""), salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (actualHash.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualHash, expectedBuffer);
}

function resolveStaticFile(urlPathname) {
  const requestedPath = urlPathname === "/" ? "/index.html" : urlPathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(ROOT_DIR, safePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    return null;
  }

  return filePath;
}

function parseCookies(request) {
  const rawCookieHeader = request.headers.cookie || "";
  const cookies = {};

  rawCookieHeader.split(";").forEach((chunk) => {
    const trimmed = chunk.trim();

    if (!trimmed) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      cookies[trimmed] = "";
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function buildSessionCookie(token, maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildExpiredSessionCookie() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function toAuthSessionModel(row) {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    role: row.role || null,
    userId: row.user_id || null,
    pendingPhone: row.pending_phone || "",
    pendingCode: row.pending_code || "",
    pendingExpiresAt: row.pending_expires_at ?? null,
    pendingProfile: row.pending_profile || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createBlankAuthSession(token) {
  const now = new Date().toISOString();

  return {
    token,
    role: null,
    userId: null,
    pendingPhone: "",
    pendingCode: "",
    pendingExpiresAt: null,
    pendingProfile: null,
    createdAt: now,
    updatedAt: now
  };
}

async function saveAuthSession(session) {
  await supabase.from("auth_sessions").upsert({
    token: session.token, role: session.role, user_id: session.userId,
    pending_phone: session.pendingPhone || "", pending_code: session.pendingCode || "",
    pending_expires_at: session.pendingExpiresAt, pending_profile: session.pendingProfile,
    created_at: session.createdAt, updated_at: session.updatedAt
  });
  return session;
}

async function getAuthSession(token) {
  if (!token) return null;
  const { data } = await supabase.from("auth_sessions").select("*").eq("token", token).single();
  return toAuthSessionModel(data);
}

async function updateAuthSession(token, nextValues) {
  const existingSession = await getAuthSession(token) || createBlankAuthSession(token);
  const nextSession = { ...existingSession, ...nextValues, updatedAt: new Date().toISOString() };
  await saveAuthSession(nextSession);
  return nextSession;
}

async function deleteAuthSession(token) {
  if (token) await supabase.from("auth_sessions").delete().eq("token", token);
}

function getRequestSessionToken(request) {
  const cookies = parseCookies(request);
  return cookies[SESSION_COOKIE_NAME] || "";
}

async function clearExpiredPendingOtp(session) {
  if (!session || !session.pendingExpiresAt || session.pendingExpiresAt >= Date.now()) return session;
  return await await updateAuthSession(session.token, { pendingPhone: "", pendingCode: "", pendingExpiresAt: null, pendingProfile: null });
}

async function ensureRequestAuthSession(request) {
  const existingToken = getRequestSessionToken(request);
  const existingSession = await getAuthSession(existingToken);
  if (existingSession) return { session: await clearExpiredPendingOtp(existingSession), setCookie: null };
  const token = createSessionToken();
  const session = await saveAuthSession(createBlankAuthSession(token));
  return { session, setCookie: buildSessionCookie(token) };
}

async function getRequestAuthSession(request) {
  const token = getRequestSessionToken(request);
  if (!token) return null;
  const session = await getAuthSession(token);
  return await clearExpiredPendingOtp(session);
}

async function getAdminCredentials() {
  const { data } = await supabase.from('admin_credentials').select('*').eq('id', 1).single();
  return data || null;
}

async function syncAdminCredentials(preferredAdmin = null) {
  const existing = await getAdminCredentials();
  const nextUsername = String(
    preferredAdmin?.username ||
    existing?.username ||
    DEFAULT_ADMIN.username
  ).trim() || DEFAULT_ADMIN.username;
  const sourcePassword = preferredAdmin?.password || existing?.password || DEFAULT_ADMIN.password;
  const nextPassword = isPasswordHash(sourcePassword)
    ? sourcePassword
    : createPasswordHash(sourcePassword);

  if (!existing || existing.username !== nextUsername || existing.password !== nextPassword) {
    await supabase.from("admin_credentials").upsert({
      id: 1,
      username: nextUsername,
      password: nextPassword
    });
  }

  return { username: nextUsername, password: nextPassword };
}

async function hasStoredState() {
  const { data } = await supabase.from("settings").select("id").limit(1);
  return data && data.length > 0;
}

async function readPersistentState() {
  if (!(await hasStoredState())) return null;
  const [
    { data: s1 }, { data: s2 }, { data: s3 }, { data: s4 },
    { data: s5 }, { data: s6 }, { data: s7 }, { data: s8 }, { data: s9 }
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).single(),
    supabase.from("admin_credentials").select("username").eq("id", 1).single(),
    supabase.from("semesters").select("*").order("sort_order"),
    supabase.from("faculty").select("*").order("sort_order"),
    supabase.from("subjects").select("*").order("sort_order"),
    supabase.from("assignments").select("*").order("sort_order"),
    supabase.from("students").select("*").order("sort_order"),
    supabase.from("marks_sheets").select("*").order("sort_order"),
    supabase.from("marks_sheet_entries").select("*").order("sheet_id").order("sort_order")
  ]);

  const entriesBySheetId = new Map();
  for (const row of s9 || []) {
    const currentEntries = entriesBySheetId.get(row.sheet_id) || [];
    currentEntries.push({
      studentId: row.student_id || "", studentUid: row.student_uid, studentName: row.student_name,
      status: row.status, attendance: row.attendance, internal: parseMarkValue(row.internal_value),
      external: parseMarkValue(row.external_value), remarks: row.remarks
    });
    entriesBySheetId.set(row.sheet_id, currentEntries);
  }

  return {
    settings: { collegeName: s1?.college_name, departmentName: s1?.department_name },
    admin: s2 || { username: DEFAULT_ADMIN.username },
    semesters: (s3 || []).map(r => ({ id: r.id, name: r.name, section: r.section, batch: r.batch, program: r.program })),
    faculty: (s4 || []).map(r => ({ id: r.id, name: r.name, username: r.username, password: r.password })),
    subjects: (s5 || []).map(r => ({ id: r.id, semesterId: r.semester_id, name: r.name, code: r.code, credits: r.credits, internalMax: r.internal_max, externalMax: r.external_max })),
    assignments: (s6 || []).map(r => ({ id: r.id, facultyId: r.faculty_id, subjectId: r.subject_id })),
    students: (s7 || []).map(r => ({ id: r.id, semesterId: r.semester_id, uid: r.uid, name: r.name })),
    marksSheets: (s8 || []).map(r => ({
      id: r.id, assignmentId: r.assignment_id, facultyId: r.faculty_id, sheetMode: r.sheet_mode,
      assessmentLabel: r.assessment_label, academicYear: r.academic_year, examDate: r.exam_date,
      internalMax: r.internal_max, externalMax: r.external_max, sheetNote: r.sheet_note, status: r.status,
      createdAt: r.created_at, updatedAt: r.updated_at, entries: entriesBySheetId.get(r.id) || []
    }))
  };
}

async function readState(authSession = null) {
  const persistentState = await readPersistentState();

  if (!persistentState) {
    return null;
  }

  return {
    ...persistentState,
    session: {
      role: authSession?.role || null,
      userId: authSession?.userId || null
    },
    otp: {
      phone: authSession?.pendingPhone || "",
      code: authSession?.pendingCode || "",
      expiresAt: authSession?.pendingExpiresAt ?? null,
      pendingProfile: parseNullableJson(authSession?.pendingProfile)
    }
  };
}

async function writeState(state) {
  if (!state || !state.settings) return;

  // Clear existing data from all tables sequentially
  await supabase.from("marks_sheet_entries").delete().neq("id", 0);
  await supabase.from("marks_sheets").delete().neq("id", "");
  await supabase.from("students").delete().neq("id", "");
  await supabase.from("assignments").delete().neq("id", "");
  await supabase.from("subjects").delete().neq("id", "");
  await supabase.from("faculty").delete().neq("id", "");
  await supabase.from("semesters").delete().neq("id", "");
  await supabase.from("settings").delete().eq("id", 1);

  await supabase.from("settings").insert({
    id: 1,
    college_name: state.settings.collegeName || "Unknown College",
    department_name: state.settings.departmentName || "Unknown Department"
  });

  if (state.admin) {
    const password = isPasswordHash(state.admin.password) ? state.admin.password : createPasswordHash(state.admin.password);
    await supabase.from("admin_credentials").upsert({
      id: 1, username: state.admin.username || DEFAULT_ADMIN.username, password: password
    });
  }

  if (state.semesters?.length > 0) {
    await supabase.from("semesters").insert(state.semesters.map((s, idx) => ({
      id: s.id, name: s.name, section: s.section, batch: s.batch, program: s.program, sort_order: idx
    })));
  }

  if (state.faculty?.length > 0) {
    await supabase.from("faculty").insert(state.faculty.map((f, idx) => ({
      id: f.id, name: f.name, username: f.username, password: f.password, sort_order: idx
    })));
  }

  if (state.subjects?.length > 0) {
    await supabase.from("subjects").insert(state.subjects.map((s, idx) => ({
      id: s.id, semester_id: s.semesterId, name: s.name, code: s.code, credits: s.credits,
      internal_max: s.internalMax, external_max: s.externalMax, sort_order: idx
    })));
  }

  if (state.assignments?.length > 0) {
    await supabase.from("assignments").insert(state.assignments.map((a, idx) => ({
      id: a.id, faculty_id: a.facultyId, subject_id: a.subjectId, sort_order: idx
    })));
  }

  if (state.students?.length > 0) {
    await supabase.from("students").insert(state.students.map((s, idx) => ({
      id: s.id, semester_id: s.semesterId, roll_no: s.rollNo || s.uid, uid: s.uid, name: s.name, sort_order: idx
    })));
  }

  if (state.marksSheets?.length > 0) {
    const sheetsToInsert = [];
    const entriesToInsert = [];

    state.marksSheets.forEach((sheet, sheetIdx) => {
      sheetsToInsert.push({
        id: sheet.id, assignment_id: sheet.assignmentId, faculty_id: sheet.facultyId,
        sheet_mode: sheet.sheetMode || "final", assessment_label: sheet.assessmentLabel,
        academic_year: sheet.academicYear, exam_date: sheet.examDate || new Date().toISOString(),
        internal_max: sheet.internalMax || 0, external_max: sheet.externalMax || 0,
        sheet_note: sheet.sheetNote || "", status: sheet.status || "draft",
        created_at: sheet.createdAt || new Date().toISOString(),
        updated_at: sheet.updatedAt || new Date().toISOString(), sort_order: sheetIdx
      });

      if (sheet.entries?.length > 0) {
        sheet.entries.forEach((entry, entryIdx) => {
          entriesToInsert.push({
            sheet_id: sheet.id, student_id: entry.studentId || null,
            roll_no: entry.rollNo || entry.studentUid || "",
            student_uid: entry.studentUid || entry.rollNo || "",
            student_name: entry.studentName || "", status: entry.status || "Present",
            attendance: entry.attendance || "", internal_value: serializeMarkValue(entry.internal),
            external_value: serializeMarkValue(entry.external), remarks: entry.remarks || "",
            sort_order: entryIdx
          });
        });
      }
    });

    if (sheetsToInsert.length > 0) await supabase.from("marks_sheets").insert(sheetsToInsert);
    if (entriesToInsert.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < entriesToInsert.length; i += chunkSize) {
        await supabase.from("marks_sheet_entries").insert(entriesToInsert.slice(i, i + chunkSize));
      }
    }
  }
}

async function findFacultyByUsername(username) {
  const { data } = await supabase.from('faculty').select('*').eq('username', username).maybeSingle();
  return data || null;
}

async function requireSessionRole(request, response, allowedRoles) {
  const session = await getRequestAuthSession(request);

  if (!session?.role) {
    sendJson(response, 401, {
      error: "auth_required",
      message: "Please sign in first."
    });
    return null;
  }

  if (!allowedRoles.includes(session.role)) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "You do not have access to this action."
    });
    return null;
  }

  return session;
}

async function getNextSortOrder(tableName) {
  const { data } = await supabase.from(tableName).select('sort_order').order('sort_order', { ascending: false }).limit(1);
  return (data && data[0] ? data[0].sort_order : -1) + 1;
}

async function getFacultyById(facultyId) {
  const { data } = await supabase.from('faculty').select('*').eq('id', facultyId).single();
  return toCamel(data) || null;
}

async function getSemesterById(semesterId) {
  const { data } = await supabase.from('semesters').select('*').eq('id', semesterId).single();
  return toCamel(data) || null;
}

async function getSubjectById(subjectId) {
  const { data } = await supabase.from('subjects').select('*').eq('id', subjectId).single();
  if (data) {
    data.semesterId = data.semester_id;
    data.internalMax = data.internal_max;
    data.externalMax = data.external_max;
  }
  return toCamel(data) || null;
}

async function getAssignmentById(assignmentId) {
  const { data } = await supabase.from('assignments').select('*').eq('id', assignmentId).single();
  if (data) {
    data.facultyId = data.faculty_id;
    data.subjectId = data.subject_id;
  }
  return toCamel(data) || null;
}

async function getStudentById(studentId) {
  const { data } = await supabase.from('students').select('*').eq('id', studentId).single();
  if (data) {
    data.semesterId = data.semester_id;
    data.rollNo = data.roll_no;
  }
  return toCamel(data) || null;
}

async function getMarksSheetById(sheetId) {
  const { data } = await supabase.from('marks_sheets').select('*').eq('id', sheetId).single();
  if (!data) return null;
  return {
    id: data.id, assignmentId: data.assignment_id, facultyId: data.faculty_id, sheetMode: data.sheet_mode,
    assessmentLabel: data.assessment_label, academicYear: data.academic_year, examDate: data.exam_date,
    internalMax: data.internal_max, externalMax: data.external_max, sheetNote: data.sheet_note, status: data.status,
    createdAt: data.created_at, updatedAt: data.updated_at, sortOrder: data.sort_order
  };
}

async function handleAdminFacultyCreate(request, response) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Faculty payload is not valid JSON." });
    return true;
  }

  const name = String(payload.name || "").trim();
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();

  if (!name || !username || !password) {
    sendJson(response, 400, {
      error: "invalid_payload",
      message: "Fill in all faculty details."
    });
    return true;
  }

  if (await findFacultyByUsername(username)) {
    sendJson(response, 409, {
      error: "duplicate_username",
      message: "That username already belongs to a faculty record."
    });
    return true;
  }

  const id = `faculty-${crypto.randomBytes(4).toString("hex")}`;
  const passwordHash = createPasswordHash(password);
  const { error: dbError } = await supabase.from("faculty").insert({
    id, name, username, password: passwordHash,
    sort_order: await getNextSortOrder("faculty")
  });

  if (dbError) {
    console.error("Faculty insert error:", dbError.message);
    sendJson(response, 500, { error: "db_error", message: "Could not save faculty record: " + dbError.message });
    return true;
  }

  sendJson(response, 201, { ok: true, id });
  return true;
}

async function handleAdminFacultyDelete(request, response, facultyId) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const faculty = await getFacultyById(facultyId);

  if (!faculty) {
    sendJson(response, 404, { error: "not_found", message: "Faculty record not found." });
    return true;
  }

  await supabase.from("faculty").delete().eq("id", facultyId);
  sendJson(response, 200, { ok: true });
  return true;
}

async function handleAdminSemesterCreate(request, response) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Semester payload is not valid JSON." });
    return true;
  }

  const name = String(payload.name || "").trim();
  const section = String(payload.section || "").trim();
  const batch = String(payload.batch || "").trim();
  const program = String(payload.program || "").trim();

  if (!name || !section || !batch || !program) {
    sendJson(response, 400, {
      error: "invalid_payload",
      message: "Fill in all semester details."
    });
    return true;
  }

  const id = `semester-${crypto.randomBytes(4).toString("hex")}`;
  await supabase.from("semesters").insert({ id, name, section, batch, program, sort_order: await getNextSortOrder("semesters") });

  sendJson(response, 201, { ok: true, id });
  return true;
}

async function handleAdminSemesterDelete(request, response, semesterId) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const semester = await getSemesterById(semesterId);

  if (!semester) {
    sendJson(response, 404, { error: "not_found", message: "Semester not found." });
    return true;
  }

  await supabase.from("semesters").delete().eq("id", semesterId);
  sendJson(response, 200, { ok: true });
  return true;
}

async function handleAdminSubjectCreate(request, response) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Subject payload is not valid JSON." });
    return true;
  }

  const semesterId = String(payload.semesterId || "").trim();
  const name = String(payload.name || "").trim();
  const code = String(payload.code || "").trim().toUpperCase();
  const credits = String(payload.credits || "").trim();
  const internalMax = Math.max(Number(payload.internalMax) || 0, 0);
  const externalMax = Math.max(Number(payload.externalMax) || 0, 0);

  if (!semesterId || !name || !code || !credits) {
    sendJson(response, 400, {
      error: "invalid_payload",
      message: "Fill in all subject details."
    });
    return true;
  }

  if (!(await getSemesterById(semesterId))) {
    sendJson(response, 400, {
      error: "invalid_semester",
      message: "Select a valid semester."
    });
    return true;
  }

  if (internalMax === 0 && externalMax === 0) {
    sendJson(response, 400, {
      error: "invalid_marks",
      message: "At least one of internal or external max marks must be greater than zero."
    });
    return true;
  }

  const id = `subject-${crypto.randomBytes(4).toString("hex")}`;
  await supabase.from("subjects").insert({ id, semester_id: semesterId, name, code, credits, internal_max: internalMax, external_max: externalMax, sort_order: await getNextSortOrder("subjects") });

  sendJson(response, 201, { ok: true, id });
  return true;
}

async function handleAdminSubjectDelete(request, response, subjectId) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const subject = await getSubjectById(subjectId);

  if (!subject) {
    sendJson(response, 404, { error: "not_found", message: "Subject not found." });
    return true;
  }

  await supabase.from("subjects").delete().eq("id", subjectId);
  sendJson(response, 200, { ok: true });
  return true;
}

async function handleAdminAssignmentCreate(request, response) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Assignment payload is not valid JSON." });
    return true;
  }

  const facultyId = String(payload.facultyId || "").trim();
  const subjectId = String(payload.subjectId || "").trim();

  if (!facultyId || !subjectId) {
    sendJson(response, 400, {
      error: "invalid_payload",
      message: "Select both faculty and subject."
    });
    return true;
  }

  if (!(await getFacultyById(facultyId)) || !(await getSubjectById(subjectId))) {
    sendJson(response, 400, {
      error: "invalid_link",
      message: "Select valid faculty and subject records."
    });
    return true;
  }

  const { data: duplicate } = await supabase.from("assignments").select("id").eq("faculty_id", facultyId).eq("subject_id", subjectId).maybeSingle();
  if (duplicate) {
    sendJson(response, 409, {
      error: "duplicate_assignment",
      message: "That faculty member is already assigned to this subject."
    });
    return true;
  }

  const id = `assignment-${crypto.randomBytes(4).toString("hex")}`;
  await supabase.from("assignments").insert({ id, faculty_id: facultyId, subject_id: subjectId, sort_order: await getNextSortOrder("assignments") });

  sendJson(response, 201, { ok: true, id });
  return true;
}

async function handleAdminAssignmentDelete(request, response, assignmentId) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const assignment = await getAssignmentById(assignmentId);

  if (!assignment) {
    sendJson(response, 404, { error: "not_found", message: "Assignment not found." });
    return true;
  }

  await supabase.from("assignments").delete().eq("id", assignmentId);
  sendJson(response, 200, { ok: true });
  return true;
}

async function handleAdminStudentsCreate(request, response) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Student payload is not valid JSON." });
    return true;
  }

  const semesterId = String(payload.semesterId || "").trim();
  const additions = Array.isArray(payload.students) ? payload.students : [];

  if (!semesterId) {
    sendJson(response, 400, {
      error: "invalid_semester",
      message: "Select a class before adding students."
    });
    return true;
  }

  if (!getSemesterById(semesterId)) {
    sendJson(response, 400, {
      error: "invalid_semester",
      message: "Select a valid class before adding students."
    });
    return true;
  }

  if (!additions.length) {
    sendJson(response, 400, {
      error: "invalid_payload",
      message: "Add one student or paste a bulk roster."
    });
    return true;
  }

  const { data: existingRows } = await supabase.from("students").select("uid").eq("semester_id", semesterId);
  const usedUids = new Set((existingRows || []).map((row) => row.uid));
  let addedCount = 0;
  let sortOrder = await getNextSortOrder("students");
  const newStudents = [];

  for (const student of additions) {
    const uidValue = String(student.uid || "").trim().toUpperCase();
    const name = String(student.name || "").trim();
    if (!uidValue || !name || usedUids.has(uidValue)) continue;

    newStudents.push({
      id: `student-${crypto.randomBytes(4).toString("hex")}`,
      semester_id: semesterId,
      roll_no: uidValue,
      uid: uidValue,
      name,
      sort_order: sortOrder++
    });
    usedUids.add(uidValue);
    addedCount++;
  }

  if (newStudents.length > 0) {
    await supabase.from("students").insert(newStudents);
  }

  sendJson(response, 201, { ok: true, addedCount });
  return true;
}

async function handleAdminStudentDelete(request, response, studentId) {
  const session = await requireSessionRole(request, response, ["admin"]);
  if (!session) {
    return true;
  }

  const student = await getStudentById(studentId);

  if (!student) {
    sendJson(response, 404, { error: "not_found", message: "Student not found." });
    return true;
  }

  await supabase.from("students").delete().eq("id", studentId);
  sendJson(response, 200, { ok: true });
  return true;
}

function validateMarksSheetPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "Sheet payload is invalid.";
  }

  if (!String(payload.assignmentId || "").trim()) {
    return "Assignment is required.";
  }

  if (!String(payload.assessmentLabel || "").trim() || !String(payload.academicYear || "").trim() || !String(payload.examDate || "").trim()) {
    return "Fill in assessment label, academic year, and exam date before saving.";
  }

  if (!Array.isArray(payload.entries)) {
    return "Sheet entries are missing.";
  }

  return "";
}

async function upsertMarksSheetRecord(payload, existingSheet) {
  const now = new Date().toISOString();
  const sheetId = existingSheet?.id || `sheet-${crypto.randomBytes(4).toString("hex")}`;
  const sortOrder = existingSheet?.sortOrder ?? await getNextSortOrder("marks_sheets");
  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  const msheet = {
    id: sheetId,
    assignment_id: String(payload.assignmentId || "").trim(),
    faculty_id: String(payload.facultyId || "").trim(),
    sheet_mode: String(payload.sheetMode || "final").trim(),
    assessment_label: String(payload.assessmentLabel || "").trim(),
    academic_year: String(payload.academicYear || "").trim(),
    exam_date: String(payload.examDate || "").trim(),
    internal_max: Number(payload.internalMax || 0),
    external_max: Number(payload.externalMax || 0),
    sheet_note: String(payload.sheetNote || ""),
    status: String(payload.status || "draft").trim() || "draft",
    created_at: existingSheet?.createdAt || payload.createdAt || now,
    updated_at: now,
    sort_order: sortOrder
  };

  await supabase.from("marks_sheets").upsert(msheet);
  await supabase.from("marks_sheet_entries").delete().eq("sheet_id", sheetId);

  const insertEntries = entries.map((entry, index) => ({
    sheet_id: sheetId,
    student_id: entry.studentId || null,
    roll_no: String(entry.studentUid || ""),
    student_uid: String(entry.studentUid || ""),
    student_name: String(entry.studentName || ""),
    status: String(entry.status || "Present"),
    attendance: String(entry.attendance || ""),
    internal_value: serializeMarkValue(entry.internal),
    external_value: serializeMarkValue(entry.external),
    remarks: String(entry.remarks || ""),
    sort_order: index
  }));

  if (insertEntries.length > 0) {
    await supabase.from("marks_sheet_entries").insert(insertEntries);
  }

  return await getMarksSheetById(sheetId);
}

async function handleMarksSheetCreate(request, response) {
  const session = await requireSessionRole(request, response, ["faculty", "admin"]);
  if (!session) {
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Sheet payload is not valid JSON." });
    return true;
  }

  const validationError = validateMarksSheetPayload(payload);
  if (validationError) {
    sendJson(response, 400, { error: "invalid_payload", message: validationError });
    return true;
  }

  const assignment = await getAssignmentById(String(payload.assignmentId || "").trim());

  if (!assignment) {
    sendJson(response, 400, { error: "invalid_assignment", message: "Select a valid assignment first." });
    return true;
  }

  if (session.role === "faculty" && assignment.facultyId !== session.userId) {
    sendJson(response, 403, { error: "forbidden", message: "You can only save sheets for your assigned subjects." });
    return true;
  }

  const savedSheet = await upsertMarksSheetRecord({
    ...payload,
    assignmentId: assignment.id,
    facultyId: session.role === "faculty" ? session.userId : assignment.facultyId
  }, null);

  sendJson(response, 201, { ok: true, id: savedSheet.id });
  return true;
}

async function handleMarksSheetUpdate(request, response, sheetId) {
  const session = await requireSessionRole(request, response, ["faculty", "admin"]);
  if (!session) {
    return true;
  }

  const existingSheet = await getMarksSheetById(sheetId);

  if (!existingSheet) {
    sendJson(response, 404, { error: "not_found", message: "Marks sheet not found." });
    return true;
  }

  if (session.role === "faculty" && existingSheet.facultyId !== session.userId) {
    sendJson(response, 403, { error: "forbidden", message: "You can only edit your own marks sheets." });
    return true;
  }

  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Sheet payload is not valid JSON." });
    return true;
  }

  const validationError = validateMarksSheetPayload(payload);
  if (validationError) {
    sendJson(response, 400, { error: "invalid_payload", message: validationError });
    return true;
  }

  const assignment = await getAssignmentById(String(payload.assignmentId || "").trim());

  if (!assignment) {
    sendJson(response, 400, { error: "invalid_assignment", message: "Select a valid assignment first." });
    return true;
  }

  if (session.role === "faculty" && assignment.facultyId !== session.userId) {
    sendJson(response, 403, { error: "forbidden", message: "You can only save sheets for your assigned subjects." });
    return true;
  }

  const savedSheet = await upsertMarksSheetRecord({
    ...payload,
    id: sheetId,
    assignmentId: assignment.id,
    facultyId: session.role === "faculty" ? session.userId : assignment.facultyId
  }, existingSheet);

  sendJson(response, 200, { ok: true, id: savedSheet.id });
  return true;
}

async function handleAdminLogin(request, response) {
  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Login request is not valid JSON." });
    return true;
  }

  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();

  // Fetch stored credentials from Supabase; fall back to default if none exist
  let adminRecord = await getAdminCredentials();
  if (!adminRecord) {
    // First boot: seed the default admin
    await syncAdminCredentials(DEFAULT_ADMIN);
    adminRecord = await getAdminCredentials();
  }

  const storedUsername = adminRecord?.username || DEFAULT_ADMIN.username;
  const storedPassword = adminRecord?.password || DEFAULT_ADMIN.password;

  const usernameMatch = username === storedUsername;
  const passwordMatch = verifyPassword(password, storedPassword);

  if (!usernameMatch || !passwordMatch) {
    sendJson(response, 401, {
      error: "invalid_credentials",
      message: "Incorrect admin username or password."
    });
    return true;
  }

  const { session, setCookie } = await ensureRequestAuthSession(request);
  await updateAuthSession(session.token, {
    role: "admin",
    userId: "admin",
    pendingPhone: "",
    pendingCode: "",
    pendingExpiresAt: null,
    pendingProfile: null
  });

  sendJson(response, 200, { ok: true, role: "admin" }, setCookie ? { "Set-Cookie": setCookie } : {});
  return true;
}

async function handleFacultyLogin(request, response) {
  const payload = await readJsonBody(request);

  if (!payload) {
    sendJson(response, 400, { error: "invalid_json", message: "Login request is not valid JSON." });
    return true;
  }

  const username = String(payload.username || "").trim();
  const password = String(payload.password || "").trim();
  const faculty = await findFacultyByUsername(username);

  if (!faculty || !verifyPassword(password, faculty.password)) {
    sendJson(response, 401, {
      error: "invalid_credentials",
      message: "Incorrect faculty username or password."
    });
    return true;
  }

  const { session, setCookie } = await ensureRequestAuthSession(request);
  await updateAuthSession(session.token, {
    role: "faculty",
    userId: faculty.id,
    pendingPhone: "",
    pendingCode: "",
    pendingExpiresAt: null,
    pendingProfile: null
  });

  sendJson(response, 200, { ok: true, role: "faculty", userId: faculty.id }, setCookie ? { "Set-Cookie": setCookie } : {});
  return true;
}

async function handleLogout(request, response) {
  const token = getRequestSessionToken(request);

  if (token) {
    deleteAuthSession(token);
  }

  sendJson(response, 200, { ok: true }, { "Set-Cookie": buildExpiredSessionCookie() });
  return true;
}

async function serveStatic(response, urlPathname, method) {
  const filePath = resolveStaticFile(urlPathname);

  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const stats = await fsp.stat(filePath);

    if (!stats.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": stats.size,
      "Content-Type": getMimeType(filePath)
    });

    if (method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }

    throw error;
  }
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      storage: supabaseUrl,
      storageType: "supabase",
      authType: "cookie-session",
      timestamp: new Date().toISOString()
    });
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    const authSession = await getRequestAuthSession(request);
    const state = await readState(authSession);

    if (!state) {
      sendJson(response, 404, { error: "not_initialized" });
      return true;
    }

    sendJson(response, 200, state);
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "PUT") {
    const payload = await readJsonBody(request);
    const authSession = await getRequestAuthSession(request);

    if (!payload) {
      sendJson(response, 400, { error: "invalid_json", message: "State payload is not valid JSON." });
      return true;
    }

    if (!isValidState(payload)) {
      sendJson(response, 400, { error: "invalid_state_shape", message: "State payload is missing required fields." });
      return true;
    }

    if (await hasStoredState()) {
      if (!authSession?.role) {
        sendJson(response, 401, {
          error: "auth_required",
          message: "Please sign in before saving portal changes."
        });
        return true;
      }

      if (authSession.role !== "admin") {
        sendJson(response, 403, {
          error: "forbidden",
          message: "Only admin can replace the full backend state."
        });
        return true;
      }
    }

    await writeState(payload);
    sendJson(response, 200, {
      ok: true,
      storageType: "supabase",
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  if (url.pathname === "/api/auth/admin/login" && request.method === "POST") {
    return handleAdminLogin(request, response);
  }

  if (url.pathname === "/api/auth/faculty/login" && request.method === "POST") {
    return handleFacultyLogin(request, response);
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return handleLogout(request, response);
  }

  if (url.pathname === "/api/admin/faculty" && request.method === "POST") {
    return handleAdminFacultyCreate(request, response);
  }

  const adminFacultyDeleteMatch = url.pathname.match(/^\/api\/admin\/faculty\/([^/]+)$/);
  if (adminFacultyDeleteMatch && request.method === "DELETE") {
    // Auth already handled in handleAdminFacultyDelete now

    return handleAdminFacultyDelete(request, response, decodeURIComponent(adminFacultyDeleteMatch[1]));
  }

  if (url.pathname === "/api/admin/semesters" && request.method === "POST") {
    return handleAdminSemesterCreate(request, response);
  }

  const adminSemesterDeleteMatch = url.pathname.match(/^\/api\/admin\/semesters\/([^/]+)$/);
  if (adminSemesterDeleteMatch && request.method === "DELETE") {
    // Auth already handled in handleAdminSemesterDelete now

    return handleAdminSemesterDelete(request, response, decodeURIComponent(adminSemesterDeleteMatch[1]));
  }

  if (url.pathname === "/api/admin/subjects" && request.method === "POST") {
    return handleAdminSubjectCreate(request, response);
  }

  const adminSubjectDeleteMatch = url.pathname.match(/^\/api\/admin\/subjects\/([^/]+)$/);
  if (adminSubjectDeleteMatch && request.method === "DELETE") {
    // Auth already handled in handleAdminSubjectDelete now

    return handleAdminSubjectDelete(request, response, decodeURIComponent(adminSubjectDeleteMatch[1]));
  }

  if (url.pathname === "/api/admin/assignments" && request.method === "POST") {
    return handleAdminAssignmentCreate(request, response);
  }

  const adminAssignmentDeleteMatch = url.pathname.match(/^\/api\/admin\/assignments\/([^/]+)$/);
  if (adminAssignmentDeleteMatch && request.method === "DELETE") {
    // Auth already handled in handleAdminAssignmentDelete now

    return handleAdminAssignmentDelete(request, response, decodeURIComponent(adminAssignmentDeleteMatch[1]));
  }

  if (url.pathname === "/api/admin/students" && request.method === "POST") {
    return handleAdminStudentsCreate(request, response);
  }

  const adminStudentDeleteMatch = url.pathname.match(/^\/api\/admin\/students\/([^/]+)$/);
  if (adminStudentDeleteMatch && request.method === "DELETE") {
    // Auth already handled in handleAdminStudentDelete now

    return handleAdminStudentDelete(request, response, decodeURIComponent(adminStudentDeleteMatch[1]));
  }

  if (url.pathname === "/api/marksheets" && request.method === "POST") {
    return handleMarksSheetCreate(request, response);
  }

  const marksSheetMatch = url.pathname.match(/^\/api\/marksheets\/([^/]+)$/);
  if (marksSheetMatch && request.method === "PUT") {
    return handleMarksSheetUpdate(request, response, decodeURIComponent(marksSheetMatch[1]));
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "not_found" });
    return true;
  }

  return false;
}

async function requestListener(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (await handleApi(request, response, url)) {
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    sendText(response, 405, "Method not allowed");
    return;
  }

  await serveStatic(response, url.pathname, request.method);
}

function createServer() {
  const server = http.createServer((request, response) => {
    requestListener(request, response).catch((error) => {
      console.error(error);

      if (request.url && request.url.startsWith("/api/")) {
        sendJson(response, 500, { error: "server_error" });
        return;
      }

      sendText(response, 500, "Internal server error");
    });
  });

  return server;
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`Result portal server running at http://${displayHost}:${PORT}`);
    syncAdminCredentials().catch(console.error);
  });
}

module.exports = {
  createServer,
  readState,
  writeState
};
