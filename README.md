# CSE Result Portal Prototype

Computer Science department result workflow with a lightweight Node backend, SQLite persistence, and backend-verified auth.

## Included Flows

- HOD / admin dashboard for:
  - semester and class setup
  - subject creation with course code and marks scheme
  - faculty onboarding
  - faculty-to-subject assignment
  - student roster upload
  - result sheet review
- Faculty phone number plus OTP sign-in with server-issued demo OTP
- Faculty dashboard with assigned subjects only
- Searchable marks entry by roll no, UID, or name
- Internal, external, total, attendance, and grade handling
- Print-ready PDF export using the browser print dialog

## Files

- `index.html`
- `app.js`
- `styles.css`
- `server.js`
- `data/state.db` created automatically on first save

## Run

Install nothing extra, then start the bundled local server:

```powershell
npm start
```

Open `http://127.0.0.1:3000`.

You can still open `index.html` directly, but backend persistence will only work when the app is served through `server.js`.

## Demo Access

Admin:

- Username: `hod.cse`
- Password: `CSE@123`

Faculty demo phones:

- `9876543210`
- `9876501234`

## Auth Notes

- Admin login is verified on the backend instead of in browser state.
- Faculty OTP requests and verification are handled by backend routes.
- Session state is stored in an HTTP-only cookie, then merged into `/api/state`.
- After the first backend seed, saving portal changes requires a signed-in session.

## Role-Based API Notes

- Admin CRUD now goes through dedicated routes for faculty, semesters, subjects, assignments, and students.
- Faculty marks entry now goes through dedicated marksheet routes instead of broad full-state writes.
- Full `PUT /api/state` is now treated as an admin-only seed/reset path rather than the normal save flow.

## Prototype Notes

- Portal data is saved to `data/state.db` through the local backend.
- If an older `data/state.json` file exists, the server imports it into SQLite automatically the first time it starts.
- The browser also keeps a local cache so the UI can recover gracefully if the backend is unavailable.
- OTP is still simulated for this project, but it is now generated and checked by the backend instead of the browser.
- `Download PDF` opens a print-ready document. Choose `Save as PDF` in the browser dialog.

## Recommended Production Stack

- Firebase for the fastest student project implementation
- Supabase for a balanced auth + database setup
- Node.js + MySQL if you want a custom backend
