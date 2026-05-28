# Attendify

Attendify is a geo-location based attendance management system for colleges. It allows teachers to start attendance sessions and students to mark attendance from their own device using passkey/trusted browser verification and browser GPS location.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Frontend | EJS, HTML, CSS, Vanilla JavaScript |
| Authentication | Passport.js, express-session, bcrypt |
| Realtime | Socket.io |
| Maps & Location | Leaflet.js, Browser Geolocation API |
| Passkey | WebAuthn, @simplewebauthn/server |
| Security | Helmet, CSRF protection, express-rate-limit |
| Session Store | connect-mongo |
| File Upload | multer |
| Icons | Font Awesome |

---

## How the App Works Technically

Attendify has four main roles:

- Platform Admin
- College Admin
- Teacher
- Student

Each role has a separate dashboard and protected routes.

---

## Main Workflow

### 1. College/Admin Setup

The college admin creates and manages:

- Class groups
- Classrooms
- Subjects
- Teachers
- Students
- Class schedules

Each classroom stores:

- Latitude
- Longitude
- Allowed attendance radius

This location data is later used to verify whether a student is inside the classroom range.

---

### 2. Teacher Starts Attendance

When a teacher starts attendance:

1. Teacher selects/starts a scheduled class.
2. The system creates an `AttendanceSession`.
3. Teacher GPS location is captured.
4. Session status becomes `ACTIVE`.
5. Socket.io notifies connected students and teacher dashboard.
6. Teacher can monitor live students on the map.

The attendance session stores:

- Teacher
- Subject
- Class group
- Classroom
- Start time
- End time
- Teacher latitude/longitude
- Allowed radius
- Active/closed status

---

### 3. Student Marks Attendance

When a student clicks **Mark Attendance**:

1. Student must be logged in.
2. System checks active attendance session.
3. Student verifies identity using:
   - Passkey, or
   - Trusted browser fallback
4. Browser captures student GPS location.
5. Frontend sends location and security token to backend.
6. Backend verifies:
   - Student belongs to the class
   - Session is active
   - Attendance token is valid
   - GPS location is inside allowed range
7. If valid, attendance is saved as `PRESENT`.

---

## Attendance Verification Flow

```txt
Teacher Starts Attendance
        ↓
Attendance Session Becomes Active
        ↓
Student Opens Dashboard
        ↓
Student Clicks Mark Attendance
        ↓
Passkey / Trusted Browser Verification
        ↓
Browser Captures GPS Location
        ↓
Backend Validates Distance + Token + Session
        ↓
Attendance Record Saved as PRESENT
        ↓
Teacher Dashboard Updates in Realtime

## Passkey System

Passkey is used to verify that the real student is marking attendance.

### How it works

1. Admin allows passkey setup.
2. Student registers a passkey.
3. Browser/device creates a secure key pair.
4. Public key is stored on the server.
5. Private key stays on the student device.
6. During attendance, student verifies using fingerprint, face unlock, PIN, or device authentication.
7. Server verifies the passkey challenge.

This makes attendance more secure than only using password login.

---

## Trusted Browser System

Trusted browser is a fallback when passkey is not supported.

### How it works

1. Admin allows trusted browser setup.
2. Student enters password to trust the current browser.
3. Server creates a secure device token.
4. Token hash is stored in the database.
5. Browser stores the trusted token in a cookie.
6. During attendance, backend verifies this trusted browser token.

This helps students whose devices do not support passkeys.

---

## Geo-Location Attendance

The app uses browser GPS to verify student location.

The backend checks:

- Student latitude
- Student longitude
- GPS accuracy
- Teacher/session location
- Classroom radius
- Distance between student and classroom/session

Attendance is only accepted if the student is within the allowed range.

The backend performs the final verification, so students cannot simply fake frontend data.

---

## Realtime Updates with Socket.io

Socket.io is used for live updates.

It handles:

- Teacher live dashboard updates
- Student attendance status updates
- Live map location updates
- Active session updates
- Notification count updates

When a student marks attendance, the teacher dashboard updates without refreshing the page.

---

## Important Database Models

| Model | Purpose |
|---|---|
| Student | Stores student details, passkeys, trusted browsers |
| Teacher | Stores teacher details and assigned subjects |
| Classroom | Stores classroom location and radius |
| Schedule | Stores class timetable |
| AttendanceSession | Stores live attendance session |
| AttendanceRecord | Stores final student attendance |
| AttendanceAttempt | Stores failed/suspicious attempts |
| Notification | Stores user notifications |
| College | Stores college details |

---

## Attendance Record

Each attendance record stores:

- Student
- Attendance session
- Subject
- Class group
- Classroom
- Status: `PRESENT` or `ABSENT`
- Latitude and longitude
- Distance from classroom
- Verification method
- Device information
- Marked time

---

## Reports

Teachers and admins can view attendance reports.

Reports help track:

- Present students
- Absent students
- Attendance percentage
- Suspicious attempts
- Class-wise attendance
- Subject-wise attendance

---

## Security Features

Attendify includes:

- Password hashing with bcrypt
- Session authentication using Passport.js
- MongoDB session store
- CSRF protection
- Helmet security headers
- Rate limiting
- Passkey verification
- Trusted browser token verification
- Server-side GPS validation
- Role-based route protection

---

## Local Setup

Clone the project:

```bash
git clone <repo-url>
cd Attendance
git checkout harsh
npm install