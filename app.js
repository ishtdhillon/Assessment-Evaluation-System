const STORAGE_KEY = "cse-result-management-v2";
const OTP_LIFETIME_MS = 5 * 60 * 1000;
const ENTRY_LOGO_SRC = encodeURI("WhatsApp Image 2026-01-24 at 4.41.33 PM.jpeg");
const API_STATE_ENDPOINT = "/api/state";
const REMOTE_SAVE_DEBOUNCE_MS = 180;
const SHEET_MODE_OPTIONS = [
  { value: "internal", label: "Internal Only" },
  { value: "external", label: "External Only" },
  { value: "final", label: "Internal + External" }
];

const app = document.querySelector("#app");

let state = loadState();
let ui = {
  screen: state.session.role ? "workspace" : "entry",
  adminTab: "overview",
  selectedAssignmentId: null,
  currentSheet: null,
  currentSheetMode: "new",
  flash: null,
  authRole: state.session.role === "faculty" ? "faculty" : "admin",
  showSplash: !state.session.role,
  showPassword: false,
  marksSearch: "",
  adminSheetSearch: "",
  rosterSemesterFilter: state.semesters[0]?.id || "",
  studentSearch: "",
  loginUsername: "",
  loginPassword: "",
  loginLoading: false
};
let splashTimer = null;
const backend = {
  enabled: window.location.protocol === "http:" || window.location.protocol === "https:",
  initialized: false,
  lastError: null,
  pendingSnapshot: null,
  saveInFlight: false,
  saveTimer: null
};

app.addEventListener("click", handleClick);
app.addEventListener("submit", handleSubmit);
app.addEventListener("input", handleInput);
app.addEventListener("change", handleInput);

render();
void initializeApp();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    const seed = createSeedState();
    syncLocalCache(seed);
    return seed;
  }

  try {
    const normalized = normalizeState(JSON.parse(saved));
    syncLocalCache(normalized);
    return normalized;
  } catch (error) {
    const seed = createSeedState();
    syncLocalCache(seed);
    return seed;
  }
}

async function initializeApp() {
  if (!backend.enabled) {
    backend.initialized = true;
    return;
  }

  try {
    const remoteState = await readRemoteState();

    if (remoteState) {
      state = remoteState;
      syncLocalCache(state);
      syncUiWithState();
      render();
    } else {
      await persistStateToBackend(state);
    }

    backend.lastError = null;
  } catch (error) {
    backend.lastError = error instanceof Error ? error.message : "Remote sync unavailable.";
    console.warn("Backend sync unavailable. Using local storage fallback.", error);
  } finally {
    backend.initialized = true;
  }
}

function normalizeState(source) {
  const seed = createSeedState();
  const parsed = source && typeof source === "object" ? source : {};

  return {
    ...seed,
    ...parsed,
    settings: {
      ...seed.settings,
      ...(parsed.settings || {})
    },
    admin: {
      ...seed.admin,
      ...(parsed.admin || {})
    },
    session: {
      role: parsed.session?.role || null,
      userId: parsed.session?.userId || null
    },
    otp: {
      phone: "",
      code: "",
      expiresAt: null,
      pendingProfile: null
    },
    semesters: Array.isArray(parsed.semesters) ? parsed.semesters : seed.semesters,
    faculty: Array.isArray(parsed.faculty) ? parsed.faculty : seed.faculty,
    subjects: Array.isArray(parsed.subjects)
      ? parsed.subjects.map((subject) => ({
        internalMax: 30,
        externalMax: 70,
        credits: "4",
        ...subject
      }))
      : seed.subjects,
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : seed.assignments,
    students: Array.isArray(parsed.students)
      ? parsed.students.map((student) => ({
        rollNo: "",
        ...student
      }))
      : seed.students,
    marksSheets: Array.isArray(parsed.marksSheets)
      ? parsed.marksSheets.map((sheet) => ({
        sheetMode: "final",
        internalMax: 30,
        externalMax: 70,
        entries: [],
        ...sheet,
        entries: Array.isArray(sheet.entries)
          ? sheet.entries.map((entry) => ({
            attendance: "100",
            internal: "",
            external: "",
            remarks: "",
            ...entry
          }))
          : []
      }))
      : seed.marksSheets
  };
}

function syncLocalCache(nextState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function syncUiWithState() {
  ui.screen = state.session.role ? "workspace" : "entry";
  ui.rosterSemesterFilter = state.semesters.some((semester) => semester.id === ui.rosterSemesterFilter)
    ? ui.rosterSemesterFilter
    : state.semesters[0]?.id || "";

  if (state.session.role === "faculty") {
    ui.authRole = "faculty";
    return;
  }

  if (state.session.role === "admin") {
    ui.authRole = "admin";
    return;
  }
}

async function readRemoteState() {
  const response = await fetch(API_STATE_ENDPOINT, {
    credentials: "include",
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Could not load backend state (${response.status}).`);
  }

  return normalizeState(await response.json());
}

async function refreshStateFromBackend() {
  const remoteState = await readRemoteState();

  if (!remoteState) {
    return null;
  }

  state = remoteState;
  syncLocalCache(state);
  syncUiWithState();
  return state;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    throw new Error(body?.message || `Request failed (${response.status}).`);
  }

  return body;
}

async function putJson(path, payload) {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    throw new Error(body?.message || `Request failed (${response.status}).`);
  }

  return body;
}

async function deleteJson(path) {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "include",
    headers: {
      Accept: "application/json"
    }
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    throw new Error(body?.message || `Request failed (${response.status}).`);
  }

  return body;
}

function createSeedState() {
  const semester3 = uid("semester");
  const semester5 = uid("semester");
  const faculty1 = uid("faculty");
  const faculty2 = uid("faculty");
  const subject1 = uid("subject");
  const subject2 = uid("subject");
  const subject3 = uid("subject");
  const assignment1 = uid("assignment");
  const assignment2 = uid("assignment");
  const assignment3 = uid("assignment");

  const semester3Students = [
    { id: uid("student"), semesterId: semester3, rollNo: "101", uid: "CSE24001", name: "Aarav Sharma" },
    { id: uid("student"), semesterId: semester3, rollNo: "102", uid: "CSE24002", name: "Ishita Patel" },
    { id: uid("student"), semesterId: semester3, rollNo: "103", uid: "CSE24003", name: "Rohan Singh" },
    { id: uid("student"), semesterId: semester3, rollNo: "104", uid: "CSE24004", name: "Tanvi Kulkarni" },
    { id: uid("student"), semesterId: semester3, rollNo: "105", uid: "CSE24005", name: "Vedant Sinha" },
    { id: uid("student"), semesterId: semester3, rollNo: "106", uid: "CSE24006", name: "Nidhi Verma" }
  ];

  const semester5Students = [
    { id: uid("student"), semesterId: semester5, rollNo: "201", uid: "CSE23001", name: "Pranav Joshi" },
    { id: uid("student"), semesterId: semester5, rollNo: "202", uid: "CSE23002", name: "Sana Khan" },
    { id: uid("student"), semesterId: semester5, rollNo: "203", uid: "CSE23003", name: "Karthik Iyer" },
    { id: uid("student"), semesterId: semester5, rollNo: "204", uid: "CSE23004", name: "Aditi Gupta" },
    { id: uid("student"), semesterId: semester5, rollNo: "205", uid: "CSE23005", name: "Rahul Das" },
    { id: uid("student"), semesterId: semester5, rollNo: "206", uid: "CSE23006", name: "Mitali Ghosh" }
  ];

  const sampleEntries = semester3Students.map((student, index) => {
    const internalMarks = [26, 28, 22, 25, 24, 27][index];
    const externalMarks = [57, 61, 48, 55, 52, 60][index];

    return {
      studentId: student.id,
      rollNo: student.rollNo,
      studentUid: student.uid,
      studentName: student.name,
      status: index === 4 ? "Absent" : "Present",
      attendance: ["95", "92", "88", "91", "80", "96"][index],
      internal: index === 4 ? "" : internalMarks,
      external: index === 4 ? "" : externalMarks,
      remarks: index === 2 ? "Needs more practice in DS lab." : ""
    };
  });

  const now = new Date();
  const createdAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const updatedAt = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();

  return {
    settings: {
      collegeName: "Akal University",
      departmentName: "Department of Computer Science and Engineering"
    },
    admin: {
      // NOTE: Credentials should be fetched securely from backend (e.g., via Supabase auth)
      username: "",
      password: ""
    },
    session: {
      role: null,
      userId: null
    },
    otp: {
      phone: "",
      code: "",
      expiresAt: null,
      pendingProfile: null
    },
    semesters: [
      {
        id: semester3,
        name: "Semester 3",
        section: "A",
        batch: "2024-2028",
        program: "B.Tech CSE"
      },
      {
        id: semester5,
        name: "Semester 5",
        section: "A",
        batch: "2023-2027",
        program: "B.Tech CSE"
      }
    ],
    faculty: [
      {
        id: faculty1,
        name: "Dr. Meera Nair",
        // NOTE: Faculty credentials must be fetched securely from backend
        username: "",
        password: ""
      },
      {
        id: faculty2,
        name: "Arjun Rao",
        // NOTE: Faculty credentials must be fetched securely from backend
        username: "",
        password: ""
      }
    ],
    subjects: [
      {
        id: subject1,
        semesterId: semester3,
        name: "Data Structures",
        code: "CSE201",
        credits: "4",
        internalMax: 30,
        externalMax: 70
      },
      {
        id: subject2,
        semesterId: semester3,
        name: "Discrete Mathematics",
        code: "CSE203",
        credits: "3",
        internalMax: 30,
        externalMax: 70
      },
      {
        id: subject3,
        semesterId: semester5,
        name: "Database Management Systems",
        code: "CSE301",
        credits: "4",
        internalMax: 30,
        externalMax: 70
      }
    ],
    assignments: [
      {
        id: assignment1,
        facultyId: faculty1,
        subjectId: subject1
      },
      {
        id: assignment2,
        facultyId: faculty2,
        subjectId: subject2
      },
      {
        id: assignment3,
        facultyId: faculty1,
        subjectId: subject3
      }
    ],
    students: [...semester3Students, ...semester5Students],
    marksSheets: [
      {
        id: uid("sheet"),
        assignmentId: assignment1,
        facultyId: faculty1,
        sheetMode: "final",
        assessmentLabel: "Internal 1 + End Term",
        academicYear: buildAcademicYear(),
        examDate: new Date().toISOString().slice(0, 10),
        internalMax: 30,
        externalMax: 70,
        sheetNote: "Sample result sheet for dashboard preview.",
        status: "submitted",
        createdAt,
        updatedAt,
        entries: sampleEntries
      }
    ]
  };
}

function saveState() {
  syncLocalCache(state);
  scheduleRemoteSave();
}

function scheduleRemoteSave() {
  if (!backend.enabled) {
    return;
  }

  backend.pendingSnapshot = JSON.stringify(state);

  if (backend.saveTimer) {
    clearTimeout(backend.saveTimer);
  }

  backend.saveTimer = setTimeout(() => {
    backend.saveTimer = null;
    void flushRemoteSave();
  }, REMOTE_SAVE_DEBOUNCE_MS);
}

async function flushRemoteSave() {
  if (backend.saveInFlight || !backend.pendingSnapshot) {
    return;
  }

  const snapshot = backend.pendingSnapshot;
  backend.pendingSnapshot = null;
  backend.saveInFlight = true;

  try {
    await persistStateToBackend(snapshot);
    backend.lastError = null;
  } catch (error) {
    backend.lastError = error instanceof Error ? error.message : "Could not save backend state.";
    backend.pendingSnapshot = snapshot;
    console.warn("Backend save failed. Changes remain cached locally.", error);

    if (!backend.saveTimer) {
      backend.saveTimer = setTimeout(() => {
        backend.saveTimer = null;
        void flushRemoteSave();
      }, 1000);
    }
  } finally {
    backend.saveInFlight = false;

    if (backend.pendingSnapshot && !backend.saveTimer) {
      backend.saveTimer = setTimeout(() => {
        backend.saveTimer = null;
        void flushRemoteSave();
      }, REMOTE_SAVE_DEBOUNCE_MS);
    }
  }
}

async function persistStateToBackend(nextState) {
  const payload = typeof nextState === "string" ? nextState : JSON.stringify(nextState);
  const response = await fetch(API_STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`Could not save backend state (${response.status}).`);
  }

  return response.json();
}

function render() {
  const shellClass = state.session.role ? "app-shell" : "app-shell guest-shell";

  app.innerHTML = `
    <div class="${shellClass}">
      ${renderTopbar()}
      ${!state.session.role ? "" : renderFlash()}
      ${renderMain()}
    </div>
  `;

  document.body.classList.toggle("entry-mode", !state.session.role);
  document.body.classList.toggle("workspace-mode", Boolean(state.session.role));
  document.body.classList.toggle("admin-mode", state.session.role === "admin");
  document.body.classList.toggle("faculty-mode", state.session.role === "faculty");

  hydrateSheetPreview();
  queueSplashDismiss();
}

function queueSplashDismiss() {
  if (state.session.role || !ui.showSplash || splashTimer) {
    return;
  }

  splashTimer = window.setTimeout(() => {
    ui.showSplash = false;
    splashTimer = null;
    render();
  }, 1500);
}

function renderTopbar() {
  if (!state.session.role) {
    return "";
  }

  const sessionLabel = getSessionLabel();

  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-copy">
          <span class="brand-kicker">${escapeHtml(state.settings.collegeName)}</span>
          <h1>CSE Result Portal</h1>
          <p></p>
              </div>
      </div>
      <div class="topbar-actions">
        <div class="session-pill">
          <strong>${escapeHtml(sessionLabel.title)}</strong>
          <span>${escapeHtml(sessionLabel.subtitle)}</span>
        </div>
        ${state.session.role ? '<button class="button-secondary" data-action="logout">Log out</button>' : ""}
      </div>
    </header>
  `;
}

function renderFlash() {
  if (!ui.flash) {
    return "";
  }

  const icons = {
    success: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  const icon = icons[ui.flash.type] || icons.info;

  return `
    <div class="flash flash-${ui.flash.type}">
      <span class="flash-icon">${icon}</span>
      <span class="flash-text">${escapeHtml(ui.flash.text)}</span>
    </div>
  `;
}

function renderMain() {
  if (state.session.role === "admin") {
    return renderAdminWorkspace();
  }

  if (state.session.role === "faculty") {
    return renderFacultyWorkspace();
  }

  if (ui.showSplash) {
    return renderSplashScreen();
  }

  // Render flash inside the entry screen if we are there
  return renderEntryScreen();
}

function renderEntryScreen() {
  const collegeName = String(state.settings.collegeName || "Akal University").trim();
  const titleWords = collegeName.split(" ");
  const titleHighlight = titleWords.length > 1 ? titleWords.join(" ") : collegeName;

  return `
    <section class="login-screen-new">
      <!-- Background Overlay (since no background image available) -->
      <div class="login-bg-overlay"></div>

      <!-- Top Bar -->
      <header class="login-topbar">
        <div class="login-topbar-brand">
          <div class="top-logo-shield">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/>
              <path d="M12 4v13"/>
              <path d="M4 10h8"/>
            </svg>
          </div>
          <div class="top-brand-text">
            <strong>AKAL UNIVERSITY</strong>
            <span>Value-Based Education</span>
          </div>
        </div>
      </header>

      <div class="login-hero-grid">
        <!-- Left Side Copy -->
        <div class="login-hero-copy">
          <h2>Welcome to</h2>
          <h1>${escapeHtml(titleHighlight)}</h1>
          <div class="divider-line"></div>
          <p>Contemplate and reflect upon knowledge.<br/>and you will become a benefactor to others.</p>
        </div>

        <!-- Right Side Card -->
        <div class="login-glass-card">
          <div class="card-logo-center">
            <div class="large-shield">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1e3a8a" stroke-width="1.5">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" />
                <path d="M12 4v13" />
              </svg>
              <strong>AKAL<br>UNIVERSITY</strong>
            </div>
            <p>${escapeHtml(state.settings.departmentName)}</p>
          </div>

          <div class="auth-pill-switch">
             <button type="button" class="pill-btn ${ui.authRole === "admin" ? "active" : ""}" data-action="set-auth-role" data-role="admin" ${ui.loginLoading ? "disabled" : ""}>
               <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
               HOD
             </button>
             <button type="button" class="pill-btn ${ui.authRole === "faculty" ? "active" : ""}" data-action="set-auth-role" data-role="faculty" ${ui.loginLoading ? "disabled" : ""}>
               <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
               Faculty
             </button>
          </div>

          ${ui.flash ? renderFlash() : ""}

          <form id="unified-login-form" class="login-form-new">
            <div class="input-group">
              <label>Username</label>
              <div class="input-wrapper">
                <svg class="left-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <input id="login-username" name="username" placeholder="${ui.authRole === "admin" ? "hod.cse" : "faculty.username"}" value="${escapeHtml(ui.loginUsername)}" data-ui-field="loginUsername" required autofocus>
                <svg class="right-icon success-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#22c55e" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
            </div>

            <div class="input-group">
              <label>Password</label>
              <div class="input-wrapper">
                <svg class="left-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input id="login-password" name="password" type="${ui.showPassword ? "text" : "password"}" placeholder="••••••••••" value="${escapeHtml(ui.loginPassword)}" data-ui-field="loginPassword" required>
                <button type="button" class="password-toggle-btn right-icon" data-action="toggle-password" aria-label="Toggle password visibility">
                   ${ui.showPassword
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>'
    }
                </button>
              </div>
            </div>

            <div class="form-footer-row">
              <label class="remember-me">
                <input type="checkbox" name="remember" checked>
                <span>Remember me</span>
              </label>
              <a href="#" class="forgot-link">Forgot password?</a>
            </div>

            <button type="submit" class="blue-submit-btn" ${ui.loginLoading ? "disabled" : ""}>
              ${ui.loginLoading ? "Authenticating..." : "Login"}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderSplashScreen() {
  return `
    <section class="splash-screen">
      ${renderEntryLogo("large")}
      <p class="splash-loading">Loading ...</p>
    </section>
  `;
}

function renderEntryLogo(size) {
  const compact = size === "compact";
  const logoClass = compact ? "entry-logo entry-logo-compact" : "entry-logo";
  const collegeName = String(state.settings.collegeName || "Akal University").trim();

  return `
    <div class="${logoClass}">
      <img src="${ENTRY_LOGO_SRC}" class="entry-logo-mark" alt="${escapeHtml(collegeName)} logo">
      <div class="entry-logo-subtitle">${escapeHtml(state.settings.departmentName)}</div>
    </div>
  `;
}

function renderEyeIcon() {
  return `
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
    </svg>
  `;
}

function renderAdminWorkspace() {
  return `
    <section class="portal-layout admin-workspace">
      <aside class="panel portal-sidebar admin-sidebar">
        <div class="sidebar-head">
          <span class="eyebrow eyebrow-small">Admin Panel</span>
          <h2>HOD Dashboard</h2>
          <p>Manage CSE records.</p>
        </div>
        <nav class="sidebar-nav">
          ${renderAdminNavButton("overview", "Dashboard")}
          ${renderAdminNavButton("semesters", "Semesters")}
          ${renderAdminNavButton("subjects", "Subjects")}
          ${renderAdminNavButton("faculty", "Faculty")}
          ${renderAdminNavButton("assignments", "Assignments")}
          ${renderAdminNavButton("students", "Students")}
          ${renderAdminNavButton("sheets", "Results")}
        </nav>

      </aside>

      <main class="stack portal-main admin-main">
        ${renderAdminPanel()}
      </main>
    </section>
  `;
}

function renderAdminNavButton(tab, label) {
  const active = ui.adminTab === tab ? "active" : "";
  return `<button class="nav-chip ${active}" data-action="admin-tab" data-tab="${tab}">${label}</button>`;
}

function renderAdminPanel() {
  switch (ui.adminTab) {
    case "semesters":
      return renderSemesterManager();
    case "subjects":
      return renderSubjectManager();
    case "faculty":
      return renderFacultyManager();
    case "assignments":
      return renderAssignmentManager();
    case "students":
      return renderStudentManager();
    case "sheets":
      return renderAdminSheets();
    default:
      return renderAdminOverview();
  }
}

function renderAdminOverview() {
  const submittedSheets = state.marksSheets.filter((sheet) => sheet.status === "submitted");
  const assignedSubjectIds = new Set(state.assignments.map((assignment) => assignment.subjectId));
  const recentSheets = state.marksSheets
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 4);

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>Dashboard</h2>
        </div>
      </div>

      <div class="metrics-grid">
        ${renderMetricCard("Students", state.students.length, "")}
        ${renderMetricCard("Subjects", state.subjects.length, `${assignedSubjectIds.size} assigned`)}
        ${renderMetricCard("Faculty", state.faculty.length, "Records")}
        ${renderMetricCard("Submitted", submittedSheets.length, `${state.marksSheets.length} sheets`)}
      </div>
    </section>

    <section class="grid-2">
      <div class="panel">
        <div class="section-title">
          <h2>Semester Readiness</h2>
        </div>
        <div class="stack compact-stack mt-18">
          ${state.semesters.length
      ? state.semesters.map((semester) => {
        const subjects = getSubjectsForSemester(semester.id);
        const students = getStudentsForSemester(semester.id);
        const mappedSubjects = subjects.filter((subject) => state.assignments.some((assignment) => assignment.subjectId === subject.id));

        return `
                    <div class="info-row">
                      <div>
                        <strong>${escapeHtml(formatSemester(semester))}</strong>
                      </div>
                      <div class="chips">
                        <span class="badge-chip badge-chip-muted">${subjects.length} subjects</span>
                        <span class="badge-chip badge-chip-muted">${students.length} students</span>
                        <span class="badge-chip ${mappedSubjects.length === subjects.length && subjects.length ? "badge-chip-success" : "badge-chip-warning"}">${mappedSubjects.length}/${subjects.length} mapped</span>
                      </div>
                    </div>
                  `;
      }).join("")
      : renderEmpty("No semesters added yet.")
    }
        </div>
      </div>

      <div class="panel">
        <div class="section-title">
          <h2>Recent Activity</h2>
        </div>
        <div class="stack compact-stack mt-18">
          ${recentSheets.length
      ? recentSheets.map((sheet) => {
        const context = getSheetContext(sheet);
        return `
                    <div class="activity-item">
                      <strong>${escapeHtml(sheet.assessmentLabel)}</strong>
                      <span>${escapeHtml(context.subject?.name || "Unknown subject")} | ${escapeHtml(context.faculty?.name || "Unknown faculty")}</span>
                      <span>${escapeHtml(formatDateTime(sheet.updatedAt))}</span>
                    </div>
                  `;
      }).join("")
      : renderEmpty("No marks sheets submitted yet.")
    }
        </div>
      </div>
    </section>
  `;
}

function renderFacultyManager() {
  const faculty = state.faculty.slice().sort((a, b) => a.name.localeCompare(b.name));

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>Faculty</h2>
        </div>
      </div>

      <div class="grid-2">
        <form id="faculty-form" class="form-card form-grid">
          <div class="section-title">
            <h2>Add Faculty</h2>
          </div>
          <div class="field">
            <label for="faculty-record-name">Full Name</label>
            <input id="faculty-record-name" name="name" placeholder="Faculty name" required>
          </div>
          <div class="field">
            <label for="faculty-record-username">Username</label>
            <input id="faculty-record-username" name="username" placeholder="faculty.name" required>
          </div>
          <div class="field">
            <label for="faculty-record-password">Password</label>
            <input id="faculty-record-password" type="password" name="password" placeholder="Pass123!" required>
          </div>
          <button class="button-primary" type="submit">Add Faculty</button>
        </form>

        <div class="panel inset-panel">
          <div class="section-title">
            <h2>Faculty Directory</h2>
          </div>
          <div class="cards-grid mt-18">
            ${faculty.length
      ? faculty.map((member) => `
                  <article class="directory-card">
                    <div class="row-between">
                      <div>
                        <h3>${escapeHtml(member.name)}</h3>
                        <p>${escapeHtml(member.designation)}</p>
                      </div>
                      <button class="button-ghost danger-text" data-action="delete-faculty" data-id="${member.id}">Remove</button>
                    </div>
                    <div class="detail-pairs">
                      <span>Username</span>
                      <strong>${escapeHtml(member.username)}</strong>
                      <span>Assigned Subjects</span>
                      <strong>${countAssignmentsForFaculty(member.id)}</strong>
                    </div>
                  </article>
                `).join("")
      : renderEmpty("No faculty records available.")
    }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSemesterManager() {
  const semesters = state.semesters.slice();

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>Semesters</h2>
        </div>
      </div>
      <div class="grid-2">
        <form id="semester-form" class="form-card form-grid">
          <div class="section-title">
            <h2>Add Semester</h2>
          </div>
          <div class="field">
            <label for="semester-name">Semester</label>
            <input id="semester-name" name="name" placeholder="Semester 1 / Semester 3" required>
          </div>
          <div class="grid-3">
            <div class="field">
              <label for="semester-section">Section</label>
              <input id="semester-section" name="section" placeholder="A" required>
            </div>
            <div class="field">
              <label for="semester-batch">Batch</label>
              <input id="semester-batch" name="batch" placeholder="2024-2028" required>
            </div>
            <div class="field">
              <label for="semester-program">Program</label>
              <input id="semester-program" name="program" placeholder="B.Tech CSE" required>
            </div>
          </div>
          <button class="button-primary" type="submit">Add Semester</button>
        </form>

        <div class="panel inset-panel">
          <div class="section-title">
            <h2>Current Classes</h2>
          </div>
          <div class="table-wrap mt-18">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Subjects</th>
                  <th>Students</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${semesters.length
      ? semesters.map((semester) => `
                      <tr>
                        <td>
                          <strong>${escapeHtml(formatSemester(semester))}</strong>
                        </td>
                        <td>${getSubjectsForSemester(semester.id).length}</td>
                        <td>${getStudentsForSemester(semester.id).length}</td>
                        <td><button class="button-ghost danger-text" data-action="delete-semester" data-id="${semester.id}">Remove</button></td>
                      </tr>
                    `).join("")
      : `<tr><td colspan="6">${renderInlineEmpty("No semesters added yet.")}</td></tr>`
    }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSubjectManager() {
  const subjects = state.subjects
    .slice()
    .sort((a, b) => {
      const semesterA = getSemester(a.semesterId)?.name || "";
      const semesterB = getSemester(b.semesterId)?.name || "";
      return `${semesterA}${a.name}`.localeCompare(`${semesterB}${b.name}`);
    });

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>Subjects</h2>
        </div>
      </div>

      <div class="grid-2">
        <form id="subject-form" class="form-card form-grid">
          <div class="section-title">
            <h2>Add Subject</h2>
          </div>
          <div class="field">
            <label for="subject-semester">Semester</label>
            <select id="subject-semester" name="semesterId" required>
              <option value="">Select semester</option>
              ${renderSemesterOptions()}
            </select>
          </div>
          <div class="field">
            <label for="subject-name">Subject Name</label>
            <input id="subject-name" name="name" placeholder="Operating Systems" required>
          </div>
          <div class="grid-4">
            <div class="field">
              <label for="subject-code">Course Code</label>
              <input id="subject-code" name="code" placeholder="CSE305" required>
            </div>
            <div class="field">
              <label for="subject-credits">Credits</label>
              <input id="subject-credits" name="credits" type="number" min="1" placeholder="4" required>
            </div>
            <div class="field">
              <label for="subject-internal-max">Internal Max</label>
              <input id="subject-internal-max" name="internalMax" type="number" min="0" placeholder="30" required>
            </div>
            <div class="field">
              <label for="subject-external-max">External Max</label>
              <input id="subject-external-max" name="externalMax" type="number" min="0" placeholder="70" required>
            </div>
          </div>
          <button class="button-primary" type="submit">Add Subject</button>
        </form>

        <div class="panel inset-panel">
          <div class="section-title">
            <h2>Configured Subjects</h2>
          </div>
          <div class="cards-grid mt-18">
            ${subjects.length
      ? subjects.map((subject) => {
        const semester = getSemester(subject.semesterId);
        const assigned = state.assignments.some((assignment) => assignment.subjectId === subject.id);
        return `
                      <article class="directory-card">
                        <div class="row-between">
                          <div>
                            <h3>${escapeHtml(subject.name)}</h3>
                            <p>${escapeHtml(subject.code)} | ${escapeHtml(semester ? formatSemester(semester) : "Unknown class")}</p>
                          </div>
                          <button class="button-ghost danger-text" data-action="delete-subject" data-id="${subject.id}">Remove</button>
                        </div>
                        <div class="chips">
                          <span class="badge-chip badge-chip-muted">${escapeHtml(subject.credits)} credits</span>
                          <span class="badge-chip badge-chip-muted">Internal ${escapeHtml(String(subject.internalMax))}</span>
                          <span class="badge-chip badge-chip-muted">External ${escapeHtml(String(subject.externalMax))}</span>
                          <span class="badge-chip ${assigned ? "badge-chip-success" : "badge-chip-warning"}">${assigned ? "Assigned" : "Not assigned"}</span>
                        </div>
                      </article>
                    `;
      }).join("")
      : renderEmpty("No subjects configured yet.")
    }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAssignmentManager() {
  const assignmentCards = state.assignments
    .slice()
    .sort((a, b) => {
      const subjectA = getSubject(a.subjectId)?.name || "";
      const subjectB = getSubject(b.subjectId)?.name || "";
      return subjectA.localeCompare(subjectB);
    });

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>Assignments</h2>
        </div>
      </div>

      <div class="grid-2">
        <form id="assignment-form" class="form-card form-grid">
          <div class="section-title">
            <h2>New Assignment</h2>
          </div>
          <div class="field">
            <label for="assignment-faculty">Faculty</label>
            <select id="assignment-faculty" name="facultyId" required>
              <option value="">Select faculty</option>
              ${state.faculty.map((member) => `<option value="${member.id}">${escapeHtml(member.name)} - ${escapeHtml(member.designation)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="assignment-subject">Subject</label>
            <select id="assignment-subject" name="subjectId" required>
              <option value="">Select subject</option>
              ${state.subjects.map((subject) => {
    const semester = getSemester(subject.semesterId);
    return `<option value="${subject.id}">${escapeHtml(subject.name)} - ${escapeHtml(semester ? formatSemester(semester) : "Unknown class")}</option>`;
  }).join("")}
            </select>
          </div>
          <button class="button-primary" type="submit">Assign Subject</button>
        </form>

        <div class="panel inset-panel">
          <div class="section-title">
            <h2>Assignment Map</h2>
          </div>
          <div class="cards-grid mt-18">
            ${assignmentCards.length
      ? assignmentCards.map((assignment) => renderAssignmentAdminCard(assignment)).join("")
      : renderEmpty("No assignments created yet.")
    }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAssignmentAdminCard(assignment) {
  const context = getAssignmentContext(assignment);
  return `
    <article class="directory-card">
      <div class="row-between">
        <div>
          <h3>${escapeHtml(context.subject?.name || "Unknown subject")}</h3>
          <p>${escapeHtml(context.subject?.code || "N/A")} | ${escapeHtml(context.semester ? formatSemester(context.semester) : "Unknown class")}</p>
        </div>
        <button class="button-ghost danger-text" data-action="delete-assignment" data-id="${assignment.id}">Remove</button>
      </div>
      <div class="detail-pairs">
        <span>Faculty</span>
        <strong>${escapeHtml(context.faculty?.name || "Unknown faculty")}</strong>
        <span>Students</span>
        <strong>${getStudentsForSemester(context.subject?.semesterId).length}</strong>
      </div>
    </article>
  `;
}

function renderStudentManager() {
  const activeSemesterId = ui.rosterSemesterFilter || state.semesters[0]?.id || "";
  const activeSemester = getSemester(activeSemesterId);
  const visibleStudents = filterStudents(getStudentsForSemester(activeSemesterId), ui.studentSearch);

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2></h2>
        </div>
      </div>

      <div class="grid-2">
        <form id="student-form" class="form-card form-grid">
          <div class="section-title">
            <h2>Add Students</h2>
          </div>
          <div class="field">
            <label for="student-semester">Semester</label>
            <select id="student-semester" name="semesterId" required>
              <option value="">Select semester</option>
              ${renderSemesterOptions()}
            </select>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="student-uid">UID</label>
              <input id="student-uid" name="uid" placeholder="CSE24001">
            </div>
            <div class="field">
              <label for="student-name">Student Name</label>
              <input id="student-name" name="name" placeholder="Student full name">
            </div>
          </div>
          <div class="field">
            <label for="student-csv">Bulk Upload (CSV or Text)</label>
            <textarea id="student-bulk" name="bulk" placeholder="UID,NAME&#10;CSE24001,Aarav Sharma&#10;CSE24002,Ishita Patel"></textarea>
            <div style="margin-top: 8px;">
              <input type="file" id="student-csv" name="csvFile" accept=".csv">
            </div>
            <span class="helper" style="margin-top: 4px; display: block;">Paste text above OR upload a <code>.csv</code> file. Format: <code>UID,NAME</code>.</span>
          </div>
          <button class="button-primary" type="submit">Save Roster</button>
        </form>

        <div class="panel inset-panel">
          <div class="section-head">
            <div class="section-title">
              <h2></h2>
            </div>
          </div>
          <div class="toolbar">
            <div class="field">
              <label for="roster-filter">Semester</label>
              <select id="roster-filter" data-ui-field="rosterSemesterFilter">
                ${state.semesters.map((semester) => `<option value="${semester.id}" ${semester.id === activeSemesterId ? "selected" : ""}>${escapeHtml(formatSemester(semester))}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="student-search">Search Student</label>
              <input id="student-search" data-ui-field="studentSearch" value="${escapeHtml(ui.studentSearch)}" placeholder="Search by UID or name">
            </div>
          </div>
          <div class="helper mt-12">
            ${activeSemester ? `${escapeHtml(formatSemester(activeSemester))} roster` : "No semester selected."}
          </div>
          <div class="table-wrap mt-18">
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Name</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="roster-table-body">
                ${renderRosterRowsMarkup(visibleStudents, activeSemesterId)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAdminSheets() {
  const sheets = state.marksSheets
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .filter((sheet) => {
      if (!ui.adminSheetSearch.trim()) {
        return true;
      }
      const context = getSheetContext(sheet);
      const haystack = [
        sheet.assessmentLabel,
        context.subject?.name,
        context.subject?.code,
        context.faculty?.name,
        context.semester ? formatSemester(context.semester) : ""
      ].join(" ").toLowerCase();
      return haystack.includes(ui.adminSheetSearch.trim().toLowerCase());
    });

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>Result Sheets</h2>
        </div>
      </div>

      <div class="toolbar">
        <div class="field">
          <label for="admin-sheet-search">Search</label>
          <input id="admin-sheet-search" data-ui-field="adminSheetSearch" value="${escapeHtml(ui.adminSheetSearch)}" placeholder="Search by faculty, subject, code, or class">
        </div>
      </div>

      <div class="table-wrap mt-18">
        <table>
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Subject</th>
              <th>Faculty</th>
              <th>Class</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Average</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="admin-sheets-body">
            ${renderAdminSheetRowsMarkup(sheets)}
          </tbody>
        </table>
      </div>
    </section>

    ${ui.currentSheet
      ? `
          <section class="panel">
            <div class="section-head">
              <div class="section-title">
                <h2>Preview</h2>
              </div>
              <div class="button-row">
                <button class="button-secondary" data-action="download-current-sheet">Download PDF</button>
              </div>
            </div>
            <div class="sheet-card" id="admin-sheet-preview-host"></div>
          </section>
        `
      : ""
    }
  `;
}

function renderFacultyWorkspace() {
  const faculty = getLoggedInFaculty();

  if (!faculty) {
    state.session = { role: null, userId: null };
    state.otp = { phone: "", code: "", expiresAt: null, pendingProfile: null };
    if (backend.enabled) {
      syncLocalCache(state);
    } else {
      saveState();
    }
    ui.screen = "entry";
    ui.showSplash = false;
    flash("error", "Your faculty session expired. Please sign in again.");
    return renderEntryScreen();
  }

  const assignments = getAssignmentsForFaculty(faculty.id);
  const selectedAssignment = ui.selectedAssignmentId ? getAssignment(ui.selectedAssignmentId) : null;
  const submittedCount = state.marksSheets.filter((sheet) => sheet.facultyId === faculty.id && sheet.status === "submitted").length;

  return `
    <section class="stack">
      <section class="panel">
        <div class="section-head">
          <div class="section-title">
            <h2>${escapeHtml(faculty.name)}</h2>
            <p>@${escapeHtml(faculty.username)}</p>
          </div>
        </div>
        <div class="metrics-grid">
          ${renderMetricCard("Assigned Subjects", assignments.length, "Visible on your dashboard")}
          ${renderMetricCard("Submitted Sheets", submittedCount, "Already sent to admin")}
          ${renderMetricCard("Draft Sheets", state.marksSheets.filter((sheet) => sheet.facultyId === faculty.id && sheet.status === "draft").length, "Saved but not submitted")}
          ${renderMetricCard("Roster Search", "On", "Search by roll no, UID, name")}
        </div>
      </section>

      ${selectedAssignment
      ? renderFacultyAssignmentDetail(selectedAssignment)
      : `
            <section class="panel">
              <div class="section-head">
                <div class="section-title">
                  <h2>Your Classes and Subjects</h2>
                  <p>Open any assigned subject to prepare internal or external marks sheets.</p>
                </div>
              </div>
              <div class="cards-grid">
                ${assignments.length
        ? assignments.map((assignment) => renderAssignmentFacultyCard(assignment)).join("")
        : renderEmpty("No assignments are mapped to this faculty yet. Ask the HOD to assign a subject.")
      }
              </div>
            </section>
          `
    }
    </section>
  `;
}

function renderAssignmentFacultyCard(assignment) {
  const context = getAssignmentContext(assignment);
  const sheetCount = getSheetsForAssignment(assignment.id).length;

  return `
    <article class="directory-card">
      <div class="row-between">
        <div>
          <h3>${escapeHtml(context.subject?.name || "Unknown subject")}</h3>
          <p>${escapeHtml(context.subject?.code || "N/A")} | ${escapeHtml(context.semester ? formatSemester(context.semester) : "Unknown class")}</p>
        </div>
        <button class="button-primary" data-action="open-assignment" data-id="${assignment.id}">Open</button>
      </div>
      <div class="chips">
        <span class="badge-chip badge-chip-muted">${getStudentsForSemester(context.subject?.semesterId).length} students</span>
        <span class="badge-chip badge-chip-muted">${sheetCount} sheet${sheetCount === 1 ? "" : "s"}</span>
        <span class="badge-chip badge-chip-muted">Credits ${escapeHtml(String(context.subject?.credits || "-"))}</span>
      </div>
    </article>
  `;
}

function renderFacultyAssignmentDetail(assignment) {
  const context = getAssignmentContext(assignment);
  const sheets = getSheetsForAssignment(assignment.id)
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

  return `
    <section class="panel">
      <div class="section-head">
        <div class="section-title">
          <h2>${escapeHtml(context.subject?.name || "Unknown subject")}</h2>
          <p>${escapeHtml(context.subject?.code || "N/A")} | ${escapeHtml(context.semester ? formatSemester(context.semester) : "Unknown class")}</p>
        </div>
        <div class="button-row">
          <button class="button-ghost" data-action="back-to-assignments">Back to subjects</button>
          <button class="button-primary" data-action="new-sheet" data-assignment-id="${assignment.id}">New Marks Sheet</button>
        </div>
      </div>

      <div class="cards-grid history-panel">
        ${sheets.length
      ? sheets.map((sheet) => `
              <article class="directory-card">
                <div class="row-between">
                  <div>
                    <h3>${escapeHtml(sheet.assessmentLabel)}</h3>
                    <p>${escapeHtml(formatSheetMode(sheet.sheetMode))} | ${escapeHtml(formatDate(sheet.examDate))}</p>
                  </div>
                  <span class="badge-chip ${sheet.status === "submitted" ? "badge-chip-success" : "badge-chip-warning"}">${escapeHtml(capitalize(sheet.status))}</span>
                </div>
                <div class="chips">
                  <span class="badge-chip badge-chip-muted">Internal ${escapeHtml(String(sheet.internalMax))}</span>
                  <span class="badge-chip badge-chip-muted">External ${escapeHtml(String(sheet.externalMax))}</span>
                  <span class="badge-chip badge-chip-muted">${escapeHtml(formatDateTime(sheet.updatedAt))}</span>
                </div>
                <div class="button-row mt-16">
                  <button class="button-ghost" data-action="edit-sheet" data-id="${sheet.id}" data-assignment-id="${assignment.id}">Edit</button>
                  <button class="button-secondary" data-action="download-sheet" data-id="${sheet.id}">Download PDF</button>
                </div>
              </article>
            `).join("")
      : renderEmpty("No marks sheet created for this subject yet.")
    }
      </div>

      ${ui.currentSheet && ui.currentSheet.assignmentId === assignment.id
      ? renderSheetEditor(context)
      : ""
    }
    </section>
  `;
}

function renderSheetEditor(context) {
  const sheet = ui.currentSheet;
  const visibleEntries = filterSheetEntries(sheet.entries, ui.marksSearch);

  return `
    <div class="editor-layout">
      <div class="form-card editor-form-panel">
        <div class="section-title">
          <h2>Marks Entry</h2>
          <p>Teacher, class, subject, and course code are filled automatically. You only enter marks and submit.</p>
        </div>

        <form id="sheet-editor-form" class="form-grid mt-18">
          <div class="grid-2">
            <div class="field">
              <label for="sheet-mode">Marks Mode</label>
              <select id="sheet-mode" data-draft-field="sheetMode" required>
                ${renderSelectOptions(SHEET_MODE_OPTIONS, sheet.sheetMode)}
              </select>
            </div>
            <div class="field">
              <label for="sheet-assessment-label">Assessment Label</label>
              <input id="sheet-assessment-label" data-draft-field="assessmentLabel" value="${escapeHtml(sheet.assessmentLabel)}" placeholder="Internal 1 / End Semester" required>
            </div>
          </div>

          <div class="grid-4">
            <div class="field">
              <label for="sheet-academic-year">Academic Year</label>
              <input id="sheet-academic-year" data-draft-field="academicYear" value="${escapeHtml(sheet.academicYear)}" placeholder="2025-2026" required>
            </div>
            <div class="field">
              <label for="sheet-exam-date">Exam Date</label>
              <input id="sheet-exam-date" type="date" data-draft-field="examDate" value="${escapeHtml(sheet.examDate)}" required>
            </div>
            <div class="field">
              <label for="sheet-internal-max">Internal Max</label>
              <input id="sheet-internal-max" type="number" min="0" data-draft-field="internalMax" value="${escapeHtml(String(sheet.internalMax))}" required>
            </div>
            <div class="field">
              <label for="sheet-external-max">External Max</label>
              <input id="sheet-external-max" type="number" min="0" data-draft-field="externalMax" value="${escapeHtml(String(sheet.externalMax))}" required>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="marks-search">Search Student</label>
              <input id="marks-search" data-ui-field="marksSearch" value="${escapeHtml(ui.marksSearch)}" placeholder="Roll no, UID, or name">
              <span class="helper">Use this during entry to find a student quickly.</span>
            </div>
            <div class="field">
              <label for="sheet-note">Sheet Note</label>
              <input id="sheet-note" data-draft-field="sheetNote" value="${escapeHtml(sheet.sheetNote)}" placeholder="Optional note for this sheet">
            </div>
          </div>

          <div class="table-wrap mt-8">
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Internal</th>
                  <th>External</th>
                  <th>Total</th>
                  <th>Grade</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody id="sheet-rows-body">
                ${renderSheetRowsMarkup(sheet, visibleEntries)}
              </tbody>
            </table>
          </div>

          <div class="button-row mt-18">
            <button class="button-ghost" type="button" data-action="save-sheet">Save Draft</button>
            <button class="button-primary" type="button" data-action="submit-sheet">Submit Sheet</button>
            <button class="button-secondary" type="button" data-action="download-current-sheet">Download PDF</button>
          </div>
        </form>
      </div>

      <div class="sheet-card" id="sheet-preview-host"></div>
    </div>
  `;
}

function renderSheetEntryRow(sheet, entry) {
  const internalEnabled = shouldUseInternal(sheet) && entry.status !== "Absent";
  const externalEnabled = shouldUseExternal(sheet) && entry.status !== "Absent";

  return `
    <tr>
      <td>${escapeHtml(entry.studentUid)}</td>
      <td>${escapeHtml(entry.studentName)}</td>
      <td>
        <select data-entry-field="status" data-student-id="${entry.studentId}">
          ${renderSelectOptions(["Present", "Absent"], entry.status)}
        </select>
      </td>
      <td>
        <input
          class="small-input"
          type="number"
          min="0"
          max="${escapeHtml(String(sheet.internalMax))}"
          data-entry-field="internal"
          data-student-id="${entry.studentId}"
          value="${entry.internal === "" ? "" : escapeHtml(String(entry.internal))}"
          ${internalEnabled ? "" : "disabled"}
        >
      </td>
      <td>
        <input
          class="small-input"
          type="number"
          min="0"
          max="${escapeHtml(String(sheet.externalMax))}"
          data-entry-field="external"
          data-student-id="${entry.studentId}"
          value="${entry.external === "" ? "" : escapeHtml(String(entry.external))}"
          ${externalEnabled ? "" : "disabled"}
        >
      </td>
      <td data-row-total="${entry.studentId}">${escapeHtml(getEntryDisplayTotal(sheet, entry))}</td>
      <td data-row-grade="${entry.studentId}">${escapeHtml(getEntryDisplayGrade(sheet, entry))}</td>
      <td>
        <input
          class="remarks-input"
          data-entry-field="remarks"
          data-student-id="${entry.studentId}"
          value="${escapeHtml(entry.remarks)}"
          placeholder="Optional"
        >
      </td>
    </tr>
  `;
}

function renderSheetRowsMarkup(sheet, visibleEntries) {
  if (!visibleEntries.length) {
    return `<tr><td colspan="10">${renderInlineEmpty("No students match the current search.")}</td></tr>`;
  }

  return visibleEntries.map((entry) => renderSheetEntryRow(sheet, entry)).join("");
}

function renderRosterRowsMarkup(visibleStudents, activeSemesterId) {
  if (!visibleStudents.length) {
    return `<tr><td colspan="4">${renderInlineEmpty(activeSemesterId ? "No matching students found for this class." : "Add a semester to load student records.")}</td></tr>`;
  }

  return visibleStudents.map((student) => `
    <tr>
      <td>${escapeHtml(student.uid)}</td>
      <td>${escapeHtml(student.name)}</td>
      <td><button class="button-ghost danger-text" data-action="delete-student" data-id="${student.id}">Remove</button></td>
    </tr>
  `).join("");
}

function renderAdminSheetRowsMarkup(sheets) {
  if (!sheets.length) {
    return `<tr><td colspan="9">${renderInlineEmpty("No result sheets match the current filter.")}</td></tr>`;
  }

  return sheets.map((sheet) => {
    const context = getSheetContext(sheet);
    const summary = getSheetSummary(sheet);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(sheet.assessmentLabel)}</strong>
          <div class="cell-subtext">${escapeHtml(formatDate(sheet.examDate))}</div>
        </td>
        <td>${escapeHtml(context.subject?.name || "Unknown subject")}</td>
        <td>${escapeHtml(context.faculty?.name || "Unknown faculty")}</td>
        <td>${escapeHtml(context.semester ? formatSemester(context.semester) : "Unknown class")}</td>
        <td>${escapeHtml(formatSheetMode(sheet.sheetMode))}</td>
        <td><span class="badge-chip ${sheet.status === "submitted" ? "badge-chip-success" : "badge-chip-warning"}">${escapeHtml(capitalize(sheet.status))}</span></td>
        <td>${escapeHtml(summary.averagePercent)}%</td>
        <td>${escapeHtml(formatDateTime(sheet.updatedAt))}</td>
        <td>
          <div class="button-cluster">
            <button class="button-ghost" data-action="preview-admin-sheet" data-id="${sheet.id}">Preview</button>
            <button class="button-secondary" data-action="download-sheet" data-id="${sheet.id}">PDF</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function hydrateSheetPreview() {
  const facultyHost = document.querySelector("#sheet-preview-host");
  const adminHost = document.querySelector("#admin-sheet-preview-host");

  if (facultyHost && ui.currentSheet) {
    facultyHost.innerHTML = renderSheetPreviewMarkup(ui.currentSheet, getSheetContext(ui.currentSheet), true);
  }

  if (adminHost && ui.currentSheet) {
    adminHost.innerHTML = renderSheetPreviewMarkup(ui.currentSheet, getSheetContext(ui.currentSheet), false);
  }
}

function renderSheetPreviewMarkup(sheet, context, showHint) {
  const isInternal = shouldUseInternal(sheet) && !shouldUseExternal(sheet);
  const isExternal = shouldUseExternal(sheet) && !shouldUseInternal(sheet);
  const assessmentTypeLabel = isInternal
    ? "INTERNAL ASSESSMENT AWARD SHEET"
    : isExternal
      ? "EXTERNAL ASSESSMENT AWARD SHEET"
      : "INTERNAL + EXTERNAL AWARD SHEET";
  const maxMarks = isInternal
    ? sheet.internalMax
    : isExternal
      ? sheet.externalMax
      : getSheetMaxTotal(sheet);
  const collegeName = String(state.settings.collegeName || "").toUpperCase();
  const semester = context.semester;
  const subject = context.subject;
  const faculty = context.faculty;

  return `
    <div class="award-sheet">

      <div class="award-header">
        <p class="award-college">${escapeHtml(collegeName)}</p>
        <p class="award-sheet-type">${escapeHtml(assessmentTypeLabel)}</p>
        <p class="award-session">SESSION: ${escapeHtml(sheet.academicYear || "")}</p>
        <p class="award-sem-label">Semester: ${escapeHtml(semester?.name || "N/A")}</p>
      </div>

      <div class="award-meta-grid">
        <div class="award-meta-row">
          <span><strong>Department:</strong> ${escapeHtml(state.settings.departmentName)}</span>
          <span><strong>Programme:</strong> ${escapeHtml(semester?.program || "N/A")}</span>
        </div>
        <div class="award-meta-row">
          <span><strong>Semester:</strong> ${escapeHtml(semester?.name || "N/A")}</span>
          <span><strong>Course Credits:</strong> ${escapeHtml(String(subject?.credits || "N/A"))}</span>
        </div>
        <div class="award-meta-row">
          <span><strong>Course Title:</strong> ${escapeHtml(subject?.name || "Unknown Subject")}</span>
          <span><strong>Course Type:</strong> ${escapeHtml(isInternal ? "Internal" : isExternal ? "External" : "Core")}</span>
        </div>
        <div class="award-meta-row">
          <span><strong>Course Code:</strong> ${escapeHtml(subject?.code || "N/A")}</span>
          <span><strong>Max. Marks:</strong> ${escapeHtml(String(maxMarks))}</span>
        </div>
      </div>

      <div class="table-wrap">
        <table class="award-table">
          <thead>
            <tr>
              <th class="col-sno">S.No.</th>
              <th class="col-auid">AUID</th>
              <th class="col-name">Name</th>
              <th class="col-marks-fig">Marks Obtained<br>(Fig.)</th>
              <th class="col-marks-words">Marks Obtained<br>(Words)</th>
            </tr>
          </thead>
          <tbody>
            ${sheet.entries.map((entry, index) => {
    const marksValue = isInternal
      ? entry.internal
      : isExternal
        ? entry.external
        : (entry.internal !== "" || entry.external !== "")
          ? getEntryNumericTotal(sheet, entry)
          : "";
    const marksDisplay = entry.status === "Absent"
      ? "AB"
      : marksValue === "" ? "-" : String(marksValue);
    const marksWords = entry.status === "Absent"
      ? "Absent"
      : marksValue === "" ? "-" : numberToWords(Number(marksValue));
    return `
              <tr>
                <td class="col-sno">${index + 1}</td>
                <td class="col-auid"><strong>${escapeHtml(entry.studentUid)}</strong></td>
                <td class="col-name">${escapeHtml(entry.studentName)}</td>
                <td class="col-marks-fig">${escapeHtml(marksDisplay)}</td>
                <td class="col-marks-words">${escapeHtml(marksWords)}</td>
              </tr>`;
  }).join("")}
          </tbody>
        </table>
      </div>

      <div class="award-footer">
        <p class="award-sig-line">
          <strong>Name of the Concerned Faculty Member:</strong>
          <span class="sig-underline">${escapeHtml(faculty?.name || "")}</span>
        </p>
        <div class="award-sig-row">
          <div class="award-sig-field">
            <strong>Signature:</strong><span class="sig-underline sig-underline-long"></span>
          </div>
          <div class="award-sig-field">
            <strong>Date of Submission</strong><span class="sig-underline sig-underline-medium">${escapeHtml(formatDate(sheet.examDate))}</span>
          </div>
        </div>
        <p class="award-sig-line">
          <strong>Signature of HOD/Incharge:</strong>
          <span class="sig-underline sig-underline-long"></span>
        </p>
      </div>

      ${showHint
      ? '<p class="preview-note" style="margin-top:18px">Use the Download PDF button to open a print-ready document and save it as PDF.</p>'
      : ""
    }
    </div>
  `;
}

async function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;

  if (action === "open-admin-login") {
    ui.authRole = "admin";
    ui.showSplash = false;
    clearFlash();
    render();
    return;
  }

  if (action === "open-faculty-auth") {
    ui.authRole = "faculty";
    ui.showSplash = false;
    clearFlash();
    render();
    return;
  }

  if (action === "set-auth-role") {
    ui.authRole = target.dataset.role === "faculty" ? "faculty" : "admin";
    ui.showPassword = false;
    clearFlash();
    render();
    return;
  }

  if (action === "toggle-password") {
    ui.showPassword = !ui.showPassword;
    render();
    return;
  }



  if (action === "go-home") {
    resetTransientUi();
    ui.screen = "entry";
    ui.showSplash = false;
    clearFlash();
    render();
    return;
  }

  if (action === "logout") {
    if (backend.enabled) {
      try {
        await postJson("/api/auth/logout", {});
        resetTransientUi();
        await refreshStateFromBackend();
        ui.screen = "entry";
        ui.authRole = "admin";
        ui.showSplash = false;
        flash("success", "Signed out successfully.");
      } catch (error) {
        flash("error", error instanceof Error ? error.message : "Could not sign out.");
      }

      render();
      return;
    }

    state.session = { role: null, userId: null };
    state.otp = { phone: "", code: "", expiresAt: null, pendingProfile: null };
    resetTransientUi();
    ui.screen = "entry";
    ui.authRole = "admin";
    ui.showSplash = false;
    saveState();
    flash("success", "Signed out successfully.");
    render();
    return;
  }

  if (action === "admin-tab") {
    ui.adminTab = target.dataset.tab;
    ui.currentSheet = null;
    clearFlash();
    render();
    return;
  }



  if (action === "delete-faculty") {
    await deleteFaculty(target.dataset.id);
    return;
  }

  if (action === "delete-semester") {
    await deleteSemester(target.dataset.id);
    return;
  }

  if (action === "delete-subject") {
    await deleteSubject(target.dataset.id);
    return;
  }

  if (action === "delete-assignment") {
    await deleteAssignment(target.dataset.id);
    return;
  }

  if (action === "delete-student") {
    await deleteStudent(target.dataset.id);
    return;
  }

  if (action === "open-assignment") {
    ui.selectedAssignmentId = target.dataset.id;
    ui.currentSheet = null;
    ui.currentSheetMode = "new";
    ui.marksSearch = "";
    clearFlash();
    render();
    return;
  }

  if (action === "back-to-assignments") {
    ui.selectedAssignmentId = null;
    ui.currentSheet = null;
    ui.currentSheetMode = "new";
    ui.marksSearch = "";
    clearFlash();
    render();
    return;
  }

  if (action === "new-sheet") {
    const assignmentId = target.dataset.assignmentId;
    ui.selectedAssignmentId = assignmentId;
    ui.currentSheet = createSheetDraft(assignmentId);
    ui.currentSheetMode = "new";
    ui.marksSearch = "";
    clearFlash();
    render();
    return;
  }

  if (action === "edit-sheet") {
    const sheet = getSheet(target.dataset.id);
    if (!sheet) {
      flash("error", "The selected result sheet could not be found.");
      render();
      return;
    }

    ui.selectedAssignmentId = target.dataset.assignmentId;
    ui.currentSheet = cloneSheet(sheet);
    ui.currentSheetMode = "edit";
    ui.marksSearch = "";
    clearFlash();
    render();
    return;
  }

  if (action === "preview-admin-sheet") {
    const sheet = getSheet(target.dataset.id);
    if (!sheet) {
      flash("error", "The selected result sheet could not be found.");
      render();
      return;
    }

    ui.currentSheet = cloneSheet(sheet);
    ui.currentSheetMode = "edit";
    clearFlash();
    render();
    return;
  }

  if (action === "save-sheet") {
    await persistCurrentSheet("draft");
    return;
  }

  if (action === "submit-sheet") {
    await persistCurrentSheet("submitted");
    return;
  }

  if (action === "download-current-sheet") {
    if (!ui.currentSheet) {
      flash("error", "Open or create a result sheet first.");
      render();
      return;
    }
    printSheet(ui.currentSheet);
    return;
  }

  if (action === "download-sheet") {
    const sheet = getSheet(target.dataset.id);
    if (!sheet) {
      flash("error", "The selected result sheet could not be found.");
      render();
      return;
    }
    printSheet(sheet);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const formId = event.target.id;
  const formData = new FormData(event.target);

  if (formId === "unified-login-form") {
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "").trim();

    if (ui.authRole === "admin") {
      if (backend.enabled) {
        ui.loginLoading = true;
        clearFlash();
        render();

        try {
          await postJson("/api/auth/admin/login", { username, password });
          await refreshStateFromBackend();
          ui.screen = "workspace";
          ui.adminTab = "overview";
          ui.showSplash = false;
          flash("success", "HOD dashboard opened.");
        } catch (error) {
          flash("error", error instanceof Error ? error.message : "Incorrect admin username or password.");
        } finally {
          ui.loginLoading = false;
        }
        render();
        return;
      }

      if (username === state.admin.username && password === state.admin.password) {
        state.session = { role: "admin", userId: "admin" };
        ui.screen = "workspace";
        ui.adminTab = "overview";
        saveState();
        flash("success", "HOD dashboard opened.");
        render();
        return;
      }

      flash("error", "Incorrect admin username or password.");
      render();
      return;
    } else if (ui.authRole === "faculty") {
      if (backend.enabled) {
        ui.loginLoading = true;
        clearFlash();
        render();

        try {
          await postJson("/api/auth/faculty/login", { username, password });
          await refreshStateFromBackend();
          ui.screen = "workspace";
          ui.selectedAssignmentId = null;
          ui.currentSheet = null;
          ui.currentSheetMode = "new";
          ui.marksSearch = "";
          const faculty = getLoggedInFaculty();
          flash("success", faculty ? `Welcome, ${faculty.name}.` : "Faculty access granted.");
        } catch (error) {
          flash("error", error instanceof Error ? error.message : "Incorrect faculty username or password.");
        } finally {
          ui.loginLoading = false;
        }
        render();
        return;
      }

      const faculty = state.faculty.find((member) => member.username === username && member.password === password);
      if (faculty) {
        state.session = { role: "faculty", userId: faculty.id };
        ui.screen = "workspace";
        ui.selectedAssignmentId = null;
        ui.currentSheet = null;
        ui.currentSheetMode = "new";
        ui.marksSearch = "";
        saveState();
        flash("success", `Welcome, ${faculty.name}.`);
        render();
        return;
      }

      flash("error", "Incorrect faculty username or password.");
      render();
      return;
    }
  }

  if (formId === "faculty-form") {
    const payload = {
      name: String(formData.get("name") || "").trim(),
      username: String(formData.get("username") || "").trim(),
      password: String(formData.get("password") || "").trim()
    };

    if (!payload.name || !payload.username || !payload.password) {
      flash("error", "Fill in all faculty details.");
      render();
      return;
    }

    if (backend.enabled) {
      try {
        await postJson("/api/admin/faculty", payload);
        await refreshStateFromBackend();
        flash("success", `${payload.name} added to faculty list.`);
      } catch (error) {
        flash("error", error instanceof Error ? error.message : "Could not add faculty.");
      }

      render();
      return;
    }

    if (state.faculty.some((member) => member.username === payload.username)) {
      flash("error", "That username already belongs to a faculty record.");
      render();
      return;
    }

    state.faculty.push({ id: uid("faculty"), ...payload });
    saveState();
    flash("success", `${payload.name} added to faculty list.`);
    render();
    return;
  }

  if (formId === "semester-form") {
    const payload = {
      name: String(formData.get("name") || "").trim(),
      section: String(formData.get("section") || "").trim(),
      batch: String(formData.get("batch") || "").trim(),
      program: String(formData.get("program") || "").trim()
    };

    if (!payload.name || !payload.section || !payload.batch || !payload.program) {
      flash("error", "Fill in all semester details.");
      render();
      return;
    }

    if (backend.enabled) {
      try {
        const result = await postJson("/api/admin/semesters", payload);
        await refreshStateFromBackend();
        if (!ui.rosterSemesterFilter && result?.id) {
          ui.rosterSemesterFilter = result.id;
        }
        flash("success", `${payload.name} / Section ${payload.section} added.`);
      } catch (error) {
        flash("error", error instanceof Error ? error.message : "Could not add semester.");
      }

      render();
      return;
    }

    state.semesters.push({ id: uid("semester"), ...payload });
    if (!ui.rosterSemesterFilter) {
      ui.rosterSemesterFilter = state.semesters[state.semesters.length - 1].id;
    }
    saveState();
    flash("success", `${payload.name} / Section ${payload.section} added.`);
    render();
    return;
  }

  if (formId === "subject-form") {
    const payload = {
      semesterId: String(formData.get("semesterId") || "").trim(),
      name: String(formData.get("name") || "").trim(),
      code: String(formData.get("code") || "").trim().toUpperCase(),
      credits: String(formData.get("credits") || "").trim(),
      internalMax: Math.max(Number(formData.get("internalMax")) || 0, 0),
      externalMax: Math.max(Number(formData.get("externalMax")) || 0, 0)
    };

    if (!payload.semesterId || !payload.name || !payload.code || !payload.credits) {
      flash("error", "Fill in all subject details.");
      render();
      return;
    }

    if (payload.internalMax === 0 && payload.externalMax === 0) {
      flash("error", "At least one of internal or external max marks must be greater than zero.");
      render();
      return;
    }

    if (backend.enabled) {
      try {
        await postJson("/api/admin/subjects", payload);
        await refreshStateFromBackend();
        flash("success", `${payload.name} added successfully.`);
      } catch (error) {
        flash("error", error instanceof Error ? error.message : "Could not add subject.");
      }

      render();
      return;
    }

    state.subjects.push({ id: uid("subject"), ...payload });
    saveState();
    flash("success", `${payload.name} added successfully.`);
    render();
    return;
  }

  if (formId === "assignment-form") {
    const facultyId = String(formData.get("facultyId") || "").trim();
    const subjectId = String(formData.get("subjectId") || "").trim();

    if (!facultyId || !subjectId) {
      flash("error", "Select both faculty and subject.");
      render();
      return;
    }

    if (backend.enabled) {
      try {
        await postJson("/api/admin/assignments", { facultyId, subjectId });
        await refreshStateFromBackend();
        flash("success", "Subject assigned successfully.");
      } catch (error) {
        flash("error", error instanceof Error ? error.message : "Could not create assignment.");
      }

      render();
      return;
    }

    if (state.assignments.some((assignment) => assignment.facultyId === facultyId && assignment.subjectId === subjectId)) {
      flash("error", "That faculty member is already assigned to this subject.");
      render();
      return;
    }

    state.assignments.push({ id: uid("assignment"), facultyId, subjectId });
    saveState();
    flash("success", "Subject assigned successfully.");
    render();
    return;
  }

  if (formId === "student-form") {
    const semesterId = String(formData.get("semesterId") || "").trim();
    const singleUid = String(formData.get("uid") || "").trim().toUpperCase();
    const singleName = String(formData.get("name") || "").trim();
    const bulk = String(formData.get("bulk") || "").trim();
    const csvFile = formData.get("csvFile");

    if (!semesterId) {
      flash("error", "Select a class before adding students.");
      render();
      return;
    }

    const additions = [];

    if (singleUid && singleName) {
      additions.push({ rollNo: "", uid: singleUid, name: singleName });
    }

    let joinedBulkOrCsvText = bulk;

    if (csvFile && csvFile.size > 0) {
      try {
        const fileContent = await csvFile.text();
        joinedBulkOrCsvText = joinedBulkOrCsvText ? joinedBulkOrCsvText + "\n" + fileContent : fileContent;
      } catch (err) {
        flash("error", "Could not read the uploaded CSV file.");
        render();
        return;
      }
    }

    if (joinedBulkOrCsvText) {
      joinedBulkOrCsvText.split(/\r?\n/).forEach((line) => {
        const [uidValue, ...nameParts] = line.split(",");
        const uidValueClean = String(uidValue || "").trim().toUpperCase();
        const name = nameParts.join(",").trim();

        // Check if there is data, and ignore a possible header row
        if (uidValueClean && name && uidValueClean.toLowerCase() !== "uid") {
          additions.push({ rollNo: "", uid: uidValueClean, name });
        }
      });
    }

    if (!additions.length) {
      flash("error", "Add one student or paste a bulk roster.");
      render();
      return;
    }

    if (backend.enabled) {
      try {
        const result = await postJson("/api/admin/students", { semesterId, students: additions });
        ui.rosterSemesterFilter = semesterId;
        await refreshStateFromBackend();
        const addedCount = Number(result?.addedCount || 0);
        flash("success", `${addedCount} student${addedCount === 1 ? "" : "s"} added to the roster.`);
      } catch (error) {
        flash("error", error instanceof Error ? error.message : "Could not add students.");
      }

      render();
      return;
    }

    let addedCount = 0;
    additions.forEach((item) => {
      const exists = state.students.some((student) => student.semesterId === semesterId && student.uid === item.uid);
      if (!exists) {
        state.students.push({
          id: uid("student"),
          semesterId,
          rollNo: "",
          uid: item.uid,
          name: item.name
        });
        addedCount += 1;
      }
    });

    ui.rosterSemesterFilter = semesterId;
    saveState();
    flash("success", `${addedCount} student${addedCount === 1 ? "" : "s"} added to the roster.`);
    render();
  }
}

function handleInput(event) {
  const target = event.target;
  const uiField = target.dataset.uiField;

  if (uiField) {
    ui[uiField] = target.value;
    if (uiField === "marksSearch") {
      refreshSheetRows();
      return;
    }

    if (uiField === "studentSearch") {
      refreshRosterRows();
      return;
    }

    if (uiField === "adminSheetSearch") {
      refreshAdminSheetRows();
      return;
    }

    if (uiField === "loginUsername" || uiField === "loginPassword") {
      return;
    }

    render();
    return;
  }

  if (!ui.currentSheet || !target.closest("#sheet-editor-form")) {
    return;
  }

  const draftField = target.dataset.draftField;
  const entryField = target.dataset.entryField;
  const studentId = target.dataset.studentId;

  if (draftField) {
    if (draftField === "sheetMode") {
      ui.currentSheet.sheetMode = target.value;
      render();
      return;
    }

    if (draftField === "internalMax" || draftField === "externalMax") {
      ui.currentSheet[draftField] = Math.max(Number(target.value) || 0, 0);
      render();
      return;
    }

    ui.currentSheet[draftField] = target.value;
    hydrateSheetPreview();
    return;
  }

  if (!entryField || !studentId) {
    return;
  }

  const entry = ui.currentSheet.entries.find((item) => item.studentId === studentId);
  if (!entry) {
    return;
  }

  if (entryField === "status") {
    entry.status = target.value;
    if (entry.status === "Absent") {
      entry.internal = "";
      entry.external = "";
      entry.remarks = entry.remarks || "Absent";
    }
    render();
    return;
  }

  if (entryField === "attendance") {
    entry.attendance = clampToRange(target.value, 0, 100);
    hydrateSheetPreview();
    return;
  }

  if (entryField === "internal") {
    entry.internal = target.value === "" ? "" : clampToRange(target.value, 0, ui.currentSheet.internalMax);
    refreshEditorRow(studentId);
    hydrateSheetPreview();
    return;
  }

  if (entryField === "external") {
    entry.external = target.value === "" ? "" : clampToRange(target.value, 0, ui.currentSheet.externalMax);
    refreshEditorRow(studentId);
    hydrateSheetPreview();
    return;
  }

  if (entryField === "remarks") {
    entry.remarks = target.value;
    hydrateSheetPreview();
  }
}

function refreshEditorRow(studentId) {
  if (!ui.currentSheet) {
    return;
  }

  const entry = ui.currentSheet.entries.find((item) => item.studentId === studentId);
  if (!entry) {
    return;
  }

  const totalCell = document.querySelector(`[data-row-total="${studentId}"]`);
  const gradeCell = document.querySelector(`[data-row-grade="${studentId}"]`);

  if (totalCell) {
    totalCell.textContent = getEntryDisplayTotal(ui.currentSheet, entry);
  }

  if (gradeCell) {
    gradeCell.textContent = getEntryDisplayGrade(ui.currentSheet, entry);
  }
}

function refreshSheetRows() {
  if (!ui.currentSheet) {
    return;
  }

  const body = document.querySelector("#sheet-rows-body");
  if (!body) {
    return;
  }

  const visibleEntries = filterSheetEntries(ui.currentSheet.entries, ui.marksSearch);
  body.innerHTML = renderSheetRowsMarkup(ui.currentSheet, visibleEntries);
}

function refreshRosterRows() {
  const body = document.querySelector("#roster-table-body");
  if (!body) {
    return;
  }

  const visibleStudents = filterStudents(getStudentsForSemester(ui.rosterSemesterFilter), ui.studentSearch);
  body.innerHTML = renderRosterRowsMarkup(visibleStudents, ui.rosterSemesterFilter);
}

function refreshAdminSheetRows() {
  const body = document.querySelector("#admin-sheets-body");
  if (!body) {
    return;
  }

  const sheets = state.marksSheets
    .slice()
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .filter((sheet) => {
      if (!ui.adminSheetSearch.trim()) {
        return true;
      }
      const context = getSheetContext(sheet);
      const haystack = [
        sheet.assessmentLabel,
        context.subject?.name,
        context.subject?.code,
        context.faculty?.name,
        context.semester ? formatSemester(context.semester) : ""
      ].join(" ").toLowerCase();
      return haystack.includes(ui.adminSheetSearch.trim().toLowerCase());
    });

  body.innerHTML = renderAdminSheetRowsMarkup(sheets);
}

async function persistCurrentSheet(status) {
  if (!ui.currentSheet) {
    flash("error", "Create a result sheet first.");
    render();
    return;
  }

  const validationError = validateSheet(ui.currentSheet);
  if (validationError) {
    flash("error", validationError);
    render();
    return;
  }

  const now = new Date().toISOString();
  const payload = {
    ...cloneSheet(ui.currentSheet),
    status,
    updatedAt: now
  };

  if (backend.enabled) {
    try {
      let result;

      if (ui.currentSheetMode === "edit" && state.marksSheets.some((sheet) => sheet.id === payload.id)) {
        result = await putJson(`/api/marksheets/${encodeURIComponent(payload.id)}`, payload);
      } else {
        result = await postJson("/api/marksheets", payload);
        if (result?.id) {
          payload.id = result.id;
        }
      }

      await refreshStateFromBackend();
      if (payload.id) {
        const savedSheet = getSheet(payload.id);
        if (savedSheet) {
          ui.currentSheet = cloneSheet(savedSheet);
          ui.currentSheetMode = "edit";
        }
      }
      flash("success", status === "submitted" ? "Result sheet submitted successfully." : "Draft saved successfully.");
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not save result sheet.");
    }

    render();
    return;
  }

  if (ui.currentSheetMode === "edit" && state.marksSheets.some((sheet) => sheet.id === payload.id)) {
    state.marksSheets = state.marksSheets.map((sheet) => (sheet.id === payload.id ? payload : sheet));
  } else {
    payload.id = uid("sheet");
    payload.createdAt = now;
    state.marksSheets.push(payload);
    ui.currentSheetMode = "edit";
  }

  ui.currentSheet = cloneSheet(payload);
  saveState();
  flash("success", status === "submitted" ? "Result sheet submitted successfully." : "Draft saved successfully.");
  render();
}

function validateSheet(sheet) {
  if (!sheet.assessmentLabel || !sheet.academicYear || !sheet.examDate) {
    return "Fill in assessment label, academic year, and exam date before saving.";
  }

  if (shouldUseInternal(sheet) && Number(sheet.internalMax) <= 0) {
    return "Internal max marks must be greater than zero for this sheet mode.";
  }

  if (shouldUseExternal(sheet) && Number(sheet.externalMax) <= 0) {
    return "External max marks must be greater than zero for this sheet mode.";
  }

  for (const entry of sheet.entries) {
    if (entry.status === "Absent") {
      continue;
    }

    if (shouldUseInternal(sheet) && entry.internal === "") {
      return `Enter internal marks for ${entry.studentName} or mark the student absent.`;
    }

    if (shouldUseExternal(sheet) && entry.external === "") {
      return `Enter external marks for ${entry.studentName} or mark the student absent.`;
    }

    if (entry.internal !== "" && Number(entry.internal) > Number(sheet.internalMax)) {
      return `Internal marks for ${entry.studentName} exceed the allowed maximum.`;
    }

    if (entry.external !== "" && Number(entry.external) > Number(sheet.externalMax)) {
      return `External marks for ${entry.studentName} exceed the allowed maximum.`;
    }
  }

  return "";
}

function createSheetDraft(assignmentId) {
  const assignment = getAssignment(assignmentId);
  const context = getAssignmentContext(assignment);
  const subject = context.subject;

  return {
    id: uid("draft"),
    assignmentId,
    facultyId: context.faculty?.id || "",
    sheetMode: "final",
    assessmentLabel: "Internal 1",
    academicYear: buildAcademicYear(),
    examDate: new Date().toISOString().slice(0, 10),
    internalMax: Number(subject?.internalMax || 30),
    externalMax: Number(subject?.externalMax || 70),
    sheetNote: "",
    status: "draft",
    entries: getStudentsForSemester(subject?.semesterId).map((student) => ({
      studentId: student.id,
      rollNo: student.rollNo,
      studentUid: student.uid,
      studentName: student.name,
      status: "Present",
      attendance: "100",
      internal: "",
      external: "",
      remarks: ""
    }))
  };
}

function printSheet(sheet) {
  const context = getSheetContext(sheet);
  const printWindow = window.open("", "_blank", "width=1100,height=900");

  if (!printWindow) {
    flash("error", "Allow pop-ups in the browser to generate the PDF sheet.");
    render();
    return;
  }

  printWindow.document.write(renderPrintableDocument(sheet, context));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
}

function renderPrintableDocument(sheet, context) {
  const isInternal = shouldUseInternal(sheet) && !shouldUseExternal(sheet);
  const isExternal = shouldUseExternal(sheet) && !shouldUseInternal(sheet);
  const assessmentTypeLabel = isInternal
    ? "INTERNAL ASSESSMENT AWARD SHEET"
    : isExternal
      ? "EXTERNAL ASSESSMENT AWARD SHEET"
      : "INTERNAL + EXTERNAL AWARD SHEET";
  const maxMarks = isInternal
    ? sheet.internalMax
    : isExternal
      ? sheet.externalMax
      : getSheetMaxTotal(sheet);
  const collegeName = String(state.settings.collegeName || "").toUpperCase();
  const semester = context.semester;
  const subject = context.subject;
  const faculty = context.faculty;

  const rowsHtml = sheet.entries.map((entry, index) => {
    const marksValue = isInternal
      ? entry.internal
      : isExternal
        ? entry.external
        : (entry.internal !== "" && entry.external !== "")
          ? getEntryNumericTotal(sheet, entry)
          : "";
    const marksDisplay = entry.status === "Absent"
      ? "AB"
      : marksValue === "" ? "" : String(marksValue);
    const marksWords = entry.status === "Absent"
      ? "Absent"
      : marksValue === "" ? "" : numberToWords(Number(marksValue));
    return `
      <tr>
        <td style="text-align:center">${index + 1}</td>
        <td style="text-align:center;font-weight:700">${escapeHtml(entry.studentUid)}</td>
        <td>${escapeHtml(entry.studentName)}</td>
        <td style="text-align:center">${escapeHtml(marksDisplay)}</td>
        <td>${escapeHtml(marksWords)}</td>
      </tr>`;
  }).join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(`${subject?.code || "Award"} - ${assessmentTypeLabel}`)}</title>
        <style>
          :root { color-scheme: light; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: "Times New Roman", Times, serif;
            color: #000;
            background: #fff;
            padding: 32px 40px;
            font-size: 13pt;
          }
          .print-shell { max-width: 920px; margin: 0 auto; }

          .award-header {
            text-align: center;
            border-bottom: 2.5px solid #000;
            padding-bottom: 14px;
            margin-bottom: 20px;
          }
          .award-college {
            font-size: 19pt;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
          }
          .award-sheet-type {
            font-size: 13pt;
            font-weight: 700;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .award-session, .award-sem-label {
            font-size: 12pt;
            font-weight: 700;
            margin-bottom: 2px;
          }

          .award-meta {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 22px;
            font-size: 12pt;
          }
          .award-meta td {
            padding: 7px 10px;
            vertical-align: top;
            border: 1px solid #999;
          }

          .award-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 32px;
            font-size: 12pt;
          }
          .award-table th, .award-table td {
            border: 1px solid #000;
            padding: 10px 12px;
            vertical-align: middle;
          }
          .award-table th {
            font-weight: 700;
            text-align: center;
            background: #ebebeb;
          }
          .award-table td:nth-child(1),
          .award-table td:nth-child(2),
          .award-table td:nth-child(4) { text-align: center; }

          .award-footer {
            margin-top: 28px;
            font-size: 12pt;
            line-height: 2.6;
          }
          .sig-row {
            display: flex;
            justify-content: space-between;
            gap: 24px;
          }
          .sig-underline {
            display: inline-block;
            min-width: 200px;
            border-bottom: 1px solid #000;
            margin-left: 8px;
          }

          @media print {
            body { padding: 14px 20px; }
            .print-shell { max-width: none; }
          }
        </style>
      </head>
      <body>
        <main class="print-shell">
          <div class="award-header">
            <p class="award-college">${escapeHtml(collegeName)}</p>
            <p class="award-sheet-type">${escapeHtml(assessmentTypeLabel)}</p>
            <p class="award-session">SESSION: ${escapeHtml(sheet.academicYear || "")}</p>
            <p class="award-sem-label">Semester: ${escapeHtml(semester?.name || "N/A")}</p>
          </div>

          <table class="award-meta">
            <tr>
              <td><strong>Department:</strong> ${escapeHtml(state.settings.departmentName)}</td>
              <td><strong>Programme:</strong> ${escapeHtml(semester?.program || "N/A")}</td>
            </tr>
            <tr>
              <td><strong>Semester:</strong> ${escapeHtml(semester?.name || "N/A")}</td>
              <td><strong>Course Credits:</strong> ${escapeHtml(String(subject?.credits || "N/A"))}</td>
            </tr>
            <tr>
              <td><strong>Course Title:</strong> ${escapeHtml(subject?.name || "Unknown Subject")}</td>
              <td><strong>Course Type:</strong> ${escapeHtml(isInternal ? "Internal" : isExternal ? "External" : "Core")}</td>
            </tr>
            <tr>
              <td><strong>Course Code:</strong> ${escapeHtml(subject?.code || "N/A")}</td>
              <td><strong>Max. Marks:</strong> ${escapeHtml(String(maxMarks))}</td>
            </tr>
          </table>

          <table class="award-table">
            <thead>
              <tr>
                <th style="width:60px">S.No.</th>
                <th style="width:140px">AUID</th>
                <th>Name</th>
                <th style="width:140px">Marks Obtained<br>(Fig.)</th>
                <th style="width:190px">Marks Obtained<br>(Words)</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div class="award-footer">
            <p><strong>Name of the Concerned Faculty Member:</strong><span class="sig-underline" style="min-width:280px">${escapeHtml(faculty?.name || "")}</span></p>
            <div class="sig-row">
              <p><strong>Signature:</strong><span class="sig-underline" style="min-width:220px"></span></p>
              <p><strong>Date of Submission</strong><span class="sig-underline">${escapeHtml(formatDate(sheet.examDate))}</span></p>
            </div>
            <p><strong>Signature of HOD/Incharge:</strong><span class="sig-underline" style="min-width:260px"></span></p>
          </div>
        </main>
      </body>
    </html>
  `;
}

async function deleteFaculty(facultyId) {
  const faculty = getFaculty(facultyId);
  if (!faculty) {
    return;
  }

  if (!window.confirm(`Remove ${faculty.name} and all linked assignments and sheets?`)) {
    return;
  }

  if (backend.enabled) {
    try {
      await deleteJson(`/api/admin/faculty/${encodeURIComponent(facultyId)}`);
      await refreshStateFromBackend();
      flash("success", `${faculty.name} removed.`);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not remove faculty.");
    }

    render();
    return;
  }

  const assignmentIds = state.assignments.filter((assignment) => assignment.facultyId === facultyId).map((assignment) => assignment.id);
  state.faculty = state.faculty.filter((member) => member.id !== facultyId);
  state.assignments = state.assignments.filter((assignment) => assignment.facultyId !== facultyId);
  state.marksSheets = state.marksSheets.filter((sheet) => !assignmentIds.includes(sheet.assignmentId));
  saveState();
  flash("success", `${faculty.name} removed.`);
  render();
}

async function deleteSemester(semesterId) {
  const semester = getSemester(semesterId);
  if (!semester) {
    return;
  }

  if (!window.confirm(`Remove ${formatSemester(semester)} and all linked subjects, students, assignments, and sheets?`)) {
    return;
  }

  if (backend.enabled) {
    try {
      await deleteJson(`/api/admin/semesters/${encodeURIComponent(semesterId)}`);
      await refreshStateFromBackend();
      if (ui.rosterSemesterFilter === semesterId) {
        ui.rosterSemesterFilter = state.semesters[0]?.id || "";
      }
      flash("success", `${formatSemester(semester)} removed.`);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not remove semester.");
    }

    render();
    return;
  }

  const subjectIds = state.subjects.filter((subject) => subject.semesterId === semesterId).map((subject) => subject.id);
  const assignmentIds = state.assignments.filter((assignment) => subjectIds.includes(assignment.subjectId)).map((assignment) => assignment.id);

  state.semesters = state.semesters.filter((item) => item.id !== semesterId);
  state.subjects = state.subjects.filter((subject) => subject.semesterId !== semesterId);
  state.students = state.students.filter((student) => student.semesterId !== semesterId);
  state.assignments = state.assignments.filter((assignment) => !subjectIds.includes(assignment.subjectId));
  state.marksSheets = state.marksSheets.filter((sheet) => !assignmentIds.includes(sheet.assignmentId));

  if (ui.rosterSemesterFilter === semesterId) {
    ui.rosterSemesterFilter = state.semesters[0]?.id || "";
  }

  saveState();
  flash("success", `${formatSemester(semester)} removed.`);
  render();
}

async function deleteSubject(subjectId) {
  const subject = getSubject(subjectId);
  if (!subject) {
    return;
  }

  if (!window.confirm(`Remove ${subject.name} and all linked assignments and sheets?`)) {
    return;
  }

  if (backend.enabled) {
    try {
      await deleteJson(`/api/admin/subjects/${encodeURIComponent(subjectId)}`);
      await refreshStateFromBackend();
      flash("success", `${subject.name} removed.`);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not remove subject.");
    }

    render();
    return;
  }

  const assignmentIds = state.assignments.filter((assignment) => assignment.subjectId === subjectId).map((assignment) => assignment.id);
  state.subjects = state.subjects.filter((item) => item.id !== subjectId);
  state.assignments = state.assignments.filter((assignment) => assignment.subjectId !== subjectId);
  state.marksSheets = state.marksSheets.filter((sheet) => !assignmentIds.includes(sheet.assignmentId));
  saveState();
  flash("success", `${subject.name} removed.`);
  render();
}

async function deleteAssignment(assignmentId) {
  const assignment = getAssignment(assignmentId);
  if (!assignment) {
    return;
  }

  const context = getAssignmentContext(assignment);
  if (!window.confirm(`Remove assignment for ${context.subject?.name || "Unknown subject"}?`)) {
    return;
  }

  if (backend.enabled) {
    try {
      await deleteJson(`/api/admin/assignments/${encodeURIComponent(assignmentId)}`);
      await refreshStateFromBackend();
      if (ui.selectedAssignmentId === assignmentId) {
        ui.selectedAssignmentId = null;
        ui.currentSheet = null;
      }
      flash("success", "Assignment removed.");
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not remove assignment.");
    }

    render();
    return;
  }

  state.assignments = state.assignments.filter((item) => item.id !== assignmentId);
  state.marksSheets = state.marksSheets.filter((sheet) => sheet.assignmentId !== assignmentId);

  if (ui.selectedAssignmentId === assignmentId) {
    ui.selectedAssignmentId = null;
    ui.currentSheet = null;
  }

  saveState();
  flash("success", "Assignment removed.");
  render();
}

async function deleteStudent(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) {
    return;
  }

  if (!window.confirm(`Remove ${student.name} from the roster?`)) {
    return;
  }

  if (backend.enabled) {
    try {
      await deleteJson(`/api/admin/students/${encodeURIComponent(studentId)}`);
      await refreshStateFromBackend();
      flash("success", `${student.name} removed from roster.`);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : "Could not remove student.");
    }

    render();
    return;
  }

  state.students = state.students.filter((item) => item.id !== studentId);
  saveState();
  flash("success", `${student.name} removed from roster.`);
  render();
}

function getSessionLabel() {
  if (state.session.role === "admin") {
    return { title: "HOD Session", subtitle: "Dashboard controls active" };
  }

  if (state.session.role === "faculty") {
    const faculty = getLoggedInFaculty();
    return { title: "Faculty Session", subtitle: faculty ? faculty.name : "Signed in" };
  }

  return { title: "Guest Mode", subtitle: "Open admin or faculty access" };
}

function getLoggedInFaculty() {
  return state.faculty.find((member) => member.id === state.session.userId) || null;
}

function getSemester(id) {
  return state.semesters.find((item) => item.id === id) || null;
}

function getFaculty(id) {
  return state.faculty.find((item) => item.id === id) || null;
}

function getSubject(id) {
  return state.subjects.find((item) => item.id === id) || null;
}

function getAssignment(id) {
  return state.assignments.find((item) => item.id === id) || null;
}

function getSheet(id) {
  return state.marksSheets.find((item) => item.id === id) || null;
}

function getSubjectsForSemester(semesterId) {
  return state.subjects.filter((subject) => subject.semesterId === semesterId);
}

function getStudentsForSemester(semesterId) {
  return state.students
    .filter((student) => student.semesterId === semesterId)
    .slice()
    .sort((a, b) => {
      return a.uid.localeCompare(b.uid, undefined, { numeric: true });
    });
}

function getAssignmentsForFaculty(facultyId) {
  return state.assignments.filter((assignment) => assignment.facultyId === facultyId);
}

function getSheetsForAssignment(assignmentId) {
  return state.marksSheets.filter((sheet) => sheet.assignmentId === assignmentId);
}

function getAssignmentContext(assignment) {
  const subject = assignment ? getSubject(assignment.subjectId) : null;
  const faculty = assignment ? getFaculty(assignment.facultyId) : null;
  const semester = subject ? getSemester(subject.semesterId) : null;

  return { assignment, subject, faculty, semester };
}

function getSheetContext(sheet) {
  return getAssignmentContext(getAssignment(sheet.assignmentId));
}

function countAssignmentsForFaculty(facultyId) {
  return state.assignments.filter((assignment) => assignment.facultyId === facultyId).length;
}

function getSheetSummary(sheet) {
  const presentEntries = sheet.entries.filter((entry) => entry.status === "Present");
  const completedEntries = presentEntries.filter((entry) => hasRequiredMarks(sheet, entry));
  const absentEntries = sheet.entries.filter((entry) => entry.status === "Absent").length;
  const totalMarks = completedEntries.reduce((sum, entry) => sum + getEntryNumericTotal(sheet, entry), 0);
  const maxTotal = getSheetMaxTotal(sheet);
  const averagePercent = completedEntries.length && maxTotal
    ? ((totalMarks / (completedEntries.length * maxTotal)) * 100).toFixed(1)
    : "0.0";

  return {
    totalStudents: sheet.entries.length,
    completedEntries: completedEntries.length,
    absentEntries,
    averagePercent
  };
}

function renderMetricCard(label, value, caption) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${caption ? `<p>${escapeHtml(caption)}</p>` : ""}
    </article>
  `;
}

function shouldUseInternal(sheet) {
  return sheet.sheetMode === "internal" || sheet.sheetMode === "final";
}

function shouldUseExternal(sheet) {
  return sheet.sheetMode === "external" || sheet.sheetMode === "final";
}

function getSheetMaxTotal(sheet) {
  let total = 0;
  if (shouldUseInternal(sheet)) {
    total += Number(sheet.internalMax) || 0;
  }
  if (shouldUseExternal(sheet)) {
    total += Number(sheet.externalMax) || 0;
  }
  return total;
}

function hasRequiredMarks(sheet, entry) {
  if (entry.status === "Absent") {
    return true;
  }

  if (shouldUseInternal(sheet) && entry.internal === "") {
    return false;
  }

  if (shouldUseExternal(sheet) && entry.external === "") {
    return false;
  }

  return true;
}

function getEntryNumericTotal(sheet, entry) {
  if (entry.status === "Absent") {
    return 0;
  }

  let total = 0;
  if (shouldUseInternal(sheet)) {
    total += Number(entry.internal || 0);
  }
  if (shouldUseExternal(sheet)) {
    total += Number(entry.external || 0);
  }
  return total;
}

function getEntryDisplayTotal(sheet, entry) {
  if (entry.status === "Absent") {
    return "AB";
  }

  const hasInternalMarks = shouldUseInternal(sheet) && entry.internal !== "";
  const hasExternalMarks = shouldUseExternal(sheet) && entry.external !== "";

  if (hasInternalMarks || hasExternalMarks) {
    return String(getEntryNumericTotal(sheet, entry));
  }

  return "-";
}

function getEntryDisplayGrade(sheet, entry) {
  if (entry.status === "Absent") {
    return "AB";
  }

  if (!hasRequiredMarks(sheet, entry)) {
    return "-";
  }

  const percentage = getSheetMaxTotal(sheet)
    ? (getEntryNumericTotal(sheet, entry) / getSheetMaxTotal(sheet)) * 100
    : 0;

  if (percentage >= 90) {
    return "A+";
  }
  if (percentage >= 80) {
    return "A";
  }
  if (percentage >= 70) {
    return "B+";
  }
  if (percentage >= 60) {
    return "B";
  }
  if (percentage >= 50) {
    return "C";
  }
  if (percentage >= 40) {
    return "D";
  }

  return "F";
}

function getDisplayMarksValue(sheet, entry, field) {
  if (entry.status === "Absent") {
    return "AB";
  }

  if (field === "internal" && !shouldUseInternal(sheet)) {
    return "-";
  }

  if (field === "external" && !shouldUseExternal(sheet)) {
    return "-";
  }

  const value = entry[field];
  return value === "" ? "-" : String(value);
}

function filterSheetEntries(entries, query) {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = [entry.studentUid, entry.studentName].join(" ").toLowerCase();
    return haystack.includes(cleanQuery);
  });
}

function filterStudents(students, query) {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) {
    return students;
  }

  return students.filter((student) => {
    const haystack = [student.uid, student.name].join(" ").toLowerCase();
    return haystack.includes(cleanQuery);
  });
}

function renderSemesterOptions() {
  return state.semesters
    .map((semester) => `<option value="${semester.id}">${escapeHtml(formatSemester(semester))}</option>`)
    .join("");
}

function renderSelectOptions(options, selected) {
  return options
    .map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderEmpty(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

function renderInlineEmpty(message) {
  return `<div class="inline-empty">${escapeHtml(message)}</div>`;
}

function formatSemester(semester) {
  const parts = [`${semester.name} / Section ${semester.section}`];
  if (semester.program) parts.push(semester.program);
  if (semester.batch) parts.push(`Batch ${semester.batch}`);
  return parts.join(" - ");
}

function formatSheetMode(mode) {
  return SHEET_MODE_OPTIONS.find((item) => item.value === mode)?.label || "Internal + External";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildAcademicYear() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "N/A";
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(dateValue) {
  if (!dateValue) {
    return "N/A";
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function clampToRange(value, min, max) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    return String(min);
  }
  return String(Math.min(Math.max(number, min), max));
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function cloneSheet(sheet) {
  return JSON.parse(JSON.stringify(sheet));
}

function numberToWords(num) {
  if (!Number.isFinite(num) || num < 0) return "";
  if (num === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty",
    "Sixty", "Seventy", "Eighty", "Ninety"];
  function below1000(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + below1000(n % 100) : "");
  }
  const integer = Math.floor(num);
  const decimal = Math.round((num - integer) * 100);
  let result = below1000(integer);
  if (decimal > 0) result += " Point " + below1000(decimal);
  return result;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function resetTransientUi() {
  ui.selectedAssignmentId = null;
  ui.currentSheet = null;
  ui.currentSheetMode = "new";
  ui.facultyAuthPhone = "";
  ui.showPassword = false;
  ui.marksSearch = "";
  ui.adminSheetSearch = "";
  ui.studentSearch = "";
  ui.loginUsername = "";
  ui.loginPassword = "";
}

function flash(type, text) {
  ui.flash = { type, text };
}

function clearFlash() {
  ui.flash = null;
}
