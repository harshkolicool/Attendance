# Attendify - Geo-Location Based Attendance System

Attendify is a modern, comprehensive web application built to streamline and secure the attendance tracking process for educational institutions. It leverages highly accurate GPS geo-location, real-time WebSocket communication, and an intuitive UI to allow students to mark attendance using their devices while physically present in the classroom.

## 🚀 Key Features

### 👨‍🎓 For Students
* **Real-time Schedule Dashboard:** View upcoming, live, and past classes.
* **Geo-Location Attendance:** Mark attendance directly from the web browser. The system uses high-accuracy GPS polling to ensure the student is physically within the allowed radius of the assigned classroom.
* **Live Map Visualization:** Uses Leaflet.js to show the student's current location relative to the classroom boundary.
* **Attendance History:** Review past attendance records and metrics.

### 👨‍🏫 For Teachers
* **Session Management:** Start and end live attendance sessions. The system calculates valid time windows based on the schedule.
* **Real-time Monitoring:** View live student check-ins as they happen using WebSockets.
* **Manual Override:** Manually mark attendance for students facing technical issues or missing devices.
* **Live Classroom Map:** See exactly where students are attempting to mark attendance from in real-time.
* **Attendance Reports:** Generate and view detailed attendance reports per class group.

### 👨‍💻 For Administrators
* **Centralized Dashboard:** Comprehensive overview of system metrics, active sessions, and attendance rates.
* **Entity Management:** Full CRUD capabilities for Students, Teachers, Subjects, Class Groups, and Classrooms.
* **Geofencing Setup:** Define classroom coordinates (Latitude/Longitude) and allowed radius for valid attendance marking.
* **Schedule Builder:** Create and manage complex weekly schedules for different class groups.
* **Bulk Data Import:** Import student and teacher data via CSV.

---

## 🛠️ Technology Stack

* **Backend:** Node.js, Express.js
* **Database:** MongoDB (with Mongoose ODM)
* **Frontend:** HTML5, Vanilla JavaScript, Vanilla CSS
* **Templating Engine:** EJS (Embedded JavaScript)
* **Real-time Communication:** Socket.io
* **Maps & Geolocation:** Leaflet.js, Browser Geolocation API
* **Authentication:** Passport.js (Local Strategy / Passkeys)

---

## 📁 Architecture & Code Structure

The application follows a standard MVC (Model-View-Controller) architecture tailored for an Express application:

* **`server.js` / `app.js`**: The main entry points. `app.js` configures the Express application, middleware, and routes. `server.js` initializes the HTTP server and Socket.io instances.
* **`models/`**: Contains Mongoose schemas defining the data structure (`User`, `Classroom`, `Subject`, `ClassGroup`, `Schedule`, `Attendance`, `AttendanceSession`).
* **`controllers/`**: Contains the business logic for handling incoming HTTP requests.
* **`routes/`**: Defines the API endpoints and maps them to their respective controller functions (e.g., `studentRoutes.js`, `teacherRoutes.js`, `adminRoutes.js`).
* **`middlewares/`**: Custom middleware functions for authentication, role-based access control (RBAC), and error handling.
* **`views/`**: EJS templates that render the server-side HTML. Structured into components and partials for reuse.
* **`public/`**: Static assets including CSS stylesheets, client-side JavaScript, and images.
* **`utils/`**: Helper functions, such as `attendanceWindow.js` (for time window calculations) and `geoAccuracy.js` (for GPS math).

---

## ⚙️ Core Workflows Explained

### 1. The Complete Attendance Marking Flow
1. **Initiation:** The teacher starts a live session from their dashboard. The system calculates a valid attendance window.
2. **Access:** The student logs into the platform. If the session is active, the "Mark Attendance" button becomes enabled on their schedule card.
3. **Location Polling:** Upon clicking the button, the frontend (`geoAccuracy.js` & `studentLocation.js`) utilizes the browser's `navigator.geolocation.watchPosition` API with `enableHighAccuracy: true` to poll the device's GPS hardware.
4. **Accuracy Improvement:** The app displays an "Improving GPS..." indicator. It waits until it receives a GPS reading with an acceptable accuracy radius (e.g., < 40 meters) to prevent false rejections caused by initial cell-tower triangulation.
5. **Distance Calculation:** The frontend calculates the Haversine distance between the student's highly-accurate coordinates and the classroom's registered coordinates.
6. **Submission:** If the distance falls within the classroom's allowed radius, the coordinates and session data are sent to the backend API.
7. **Verification & Record Creation:** The backend (`studentRoutes.js`) performs a secondary server-side Haversine calculation to verify the distance against the database, ensuring data integrity and preventing frontend spoofing. If valid, an `Attendance` record is created (or updated if one exists) marking the student as 'Present'.
### 2. The Real-time WebSocket Flow
1. When a teacher starts a session, they join a Socket.io room specific to that session ID.
2. When a student successfully marks attendance, the backend emits a `student_marked_present` event to the corresponding room.
3. The teacher's dashboard receives this event and dynamically updates the UI (incrementing the present count and adding the student's name to the live list) without requiring a page refresh.

### 3. Attendance Reopening Logic
If a student was previously marked 'Absent' (e.g., via the end-of-day expiry job or manually), and the teacher re-opens the live session, the system allows the student to re-mark. The backend intercepts the new check-in and *updates* the existing 'Absent' record to 'Present', preventing duplicate records and ensuring data consistency.

### 4. Authentication: Passkeys & "Trust this browser"
To provide a frictionless and highly secure login experience, Attendify uses modern authentication methods:
* **Passkeys (WebAuthn):** The primary login mechanism utilizes Passkeys (biometrics like FaceID, TouchID, or device PINs). When a user registers, their device generates a public-private key pair securely stored in the device's hardware enclave. During login, the device cryptographically signs a challenge from the server, allowing instant login without typing passwords.
* **"Trust this browser" Fallback:** Not all devices or browsers support WebAuthn/Passkeys natively. To ensure accessibility, the app provides a "Trust this browser" fallback. 
    * When a user logs in via traditional credentials and selects "Trust this browser", a secure, long-lived, HttpOnly authentication cookie (or persistent token) is generated and stored in the browser. 
    * On subsequent visits, the backend verifies this persistent token. If valid, the user bypasses the login screen entirely, mimicking the convenience of a passkey without requiring the underlying hardware support.

---

## 🚀 Getting Started (Local Development)

### Prerequisites
* Node.js (v16+ recommended)
* MongoDB (Local instance or MongoDB Atlas URI)

### Installation
1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd Attendance
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory and add the necessary variables (use `.env.example` as a template if available).
   ```env
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/attendify
   SESSION_SECRET=your_secure_session_secret
   ```

4. **Start the server:**
   ```bash
   npm start
   ```
   *(Alternatively, use `npm run dev` if you have nodemon configured).*

5. **Access the application:**
   Open your browser and navigate to `http://localhost:3000`.

---

## 🔒 Security Measures

* **Session Management:** Secure cookie-based sessions.
* **Role-Based Access:** Strict route protection preventing students from accessing teacher routes, etc.
* **Anti-Spoofing:** Server-side verification of GPS coordinates prevents simple frontend manipulation.
* **Error Handling:** Production-ready 404 and 500 error pages that gracefully handle exceptions without leaking stack traces or sensitive backend information.
