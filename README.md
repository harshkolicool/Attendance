<div align="center">
  
# 📍 Attendify

### *Geo-Location Based Attendance Management System*

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-13AA52?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)

</div>

---

## 📋 About

Attendify is an intelligent geo-location based attendance management system designed for colleges. It empowers teachers to conduct attendance sessions with GPS verification and allows students to mark attendance securely using passkeys or trusted browser authentication.

**Key Features:**
- 🔐 Passkey & WebAuthn Authentication
- 📍 Real-time GPS Location Verification
- 👥 Role-based Access Control (Admin, Teacher, Student)
- 📊 Live Attendance Dashboard with Socket.io
- 🗺️ Interactive Map View using Leaflet.js
- 🛡️ Enterprise-grade Security

---

## 🏗️ Tech Stack

<table>
  <tr>
    <td align="center"><b>Layer</b></td>
    <td align="center"><b>Technology</b></td>
  </tr>
  <tr>
    <td>🖥️ <b>Backend</b></td>
    <td>Node.js, Express.js</td>
  </tr>
  <tr>
    <td>💾 <b>Database</b></td>
    <td>MongoDB, Mongoose</td>
  </tr>
  <tr>
    <td>🎨 <b>Frontend</b></td>
    <td>EJS, HTML, CSS, Vanilla JavaScript</td>
  </tr>
  <tr>
    <td>🔐 <b>Authentication</b></td>
    <td>Passport.js, express-session, bcrypt</td>
  </tr>
  <tr>
    <td>⚡ <b>Realtime</b></td>
    <td>Socket.io</td>
  </tr>
  <tr>
    <td>🗺️ <b>Maps & Location</b></td>
    <td>Leaflet.js, Browser Geolocation API</td>
  </tr>
  <tr>
    <td>🔑 <b>Passkey</b></td>
    <td>WebAuthn, @simplewebauthn/server</td>
  </tr>
  <tr>
    <td>🛡️ <b>Security</b></td>
    <td>Helmet, CSRF Protection, express-rate-limit</td>
  </tr>
  <tr>
    <td>💾 <b>Session Store</b></td>
    <td>connect-mongo</td>
  </tr>
  <tr>
    <td>📤 <b>File Upload</b></td>
    <td>Multer</td>
  </tr>
  <tr>
    <td>🎯 <b>Icons</b></td>
    <td>Font Awesome</td>
  </tr>
</table>

---

## 👥 System Roles

Attendify supports four main user roles with dedicated dashboards:

```
┌─────────────────┐
│ Platform Admin  │  ← Manages entire system & colleges
├─────────────────┤
│  College Admin  │  ← Manages college & its resources
├─────────────────┤
│    Teacher      │  ← Conducts attendance sessions
├─────────────────┤
│    Student      │  ← Marks attendance
└─────────────────┘
```

Each role has **protected routes** and a **separate dashboard**.

---

## 🔄 Main Workflow

### 1️⃣ College Setup

The college admin creates and manages:

- 📚 Class groups
- 🏫 Classrooms (with GPS coordinates)
- 📖 Subjects
- 👨‍🏫 Teachers
- 👨‍🎓 Students
- 📅 Class schedules

Each classroom stores:
```
├── Latitude & Longitude
├── Allowed attendance radius (meters)
└── Associated subjects & teachers
```

---

### 2️⃣ Teacher Starts Attendance

**Process Flow:**

```
1. Teacher selects a scheduled class
   ↓
2. System creates an AttendanceSession
   ↓
3. Teacher GPS location is captured
   ↓
4. Session status → ACTIVE
   ↓
5. Socket.io notifies students & dashboard
   ↓
6. Teacher monitors live student locations on map
```

**Session Data Stored:**
- 👨‍🏫 Teacher & Subject
- 👥 Class group
- 🏫 Classroom
- 🕐 Start & End time
- 📍 Teacher's GPS coordinates
- 📏 Allowed radius for attendance
- ✅ Active/Closed status

---

### 3️⃣ Student Marks Attendance

**Student Flow:**

```
1. Student clicks "Mark Attendance" button
   ↓
2. System checks for active session
   ↓
3. Student verifies identity using:
   ├── 🔑 Passkey (Fingerprint/Face ID)
   └── 🔒 Trusted Browser fallback
   ↓
4. Browser captures GPS location
   ↓
5. Frontend sends location & security token
   ↓
6. Backend validates:
   ├── Student in correct class
   ├── Session is active
   ├── Token is valid
   └── GPS within allowed range
   ↓
7. ✅ Attendance saved as PRESENT
```

---

## ✅ Attendance Verification Flow

```
         Teacher Starts Attendance
                   ↓
          Session Becomes ACTIVE
                   ↓
          Student Opens Dashboard
                   ↓
        Student Clicks "Mark Attendance"
                   ↓
      Passkey / Trusted Browser Verification
                   ↓
        Browser Captures GPS Location
                   ↓
     Backend Validates Distance + Token + Session
                   ↓
       ✅ Attendance Record Saved as PRESENT
                   ↓
      Teacher Dashboard Updates (via Socket.io)
```

---

## 🔐 Security Features

### Passkey System (WebAuthn)

**How it works:**

```
1. Admin enables passkey setup
2. Student registers a passkey
3. Browser/device creates secure key pair
4. Public key stored on server
5. Private key stays on student device
6. During attendance: Student verifies via fingerprint, face, PIN, or biometric
7. Server verifies passkey challenge
```

✨ **More secure than password-only login!**

---

### Trusted Browser System

**Fallback for devices without passkey support:**

```
1. Admin enables trusted browser feature
2. Student enters password to trust browser
3. Server creates secure device token
4. Token hash stored in database
5. Browser stores token in secure cookie
6. During attendance: Backend verifies token
```

---

### Geo-Location Verification

**Backend validates:**

- 📍 Student latitude & longitude
- 🎯 GPS accuracy
- 🏫 Teacher/session location
- 📏 Classroom radius
- 🔍 Distance calculation

> ⚠️ **Backend performs final verification** — Students cannot fake frontend location data!

---

## 🔄 Realtime Updates with Socket.io

Live updates power the dashboard experience:

- 📊 Teacher dashboard auto-updates when students mark attendance
- 👤 Student attendance status notifications
- 🗺️ Live map location updates
- 🔔 Active session updates
- 📈 Notification count updates

**No page refresh needed!** Changes appear instantly via WebSocket.

---

## 🗄️ Database Models

| Model | Purpose |
|-------|---------|
| **Student** | Student profile, passkeys, trusted browsers |
| **Teacher** | Teacher details, assigned subjects |
| **Classroom** | Location (GPS) & attendance radius |
| **Schedule** | Class timetable |
| **AttendanceSession** | Active attendance session data |
| **AttendanceRecord** | Final attendance records (PRESENT/ABSENT) |
| **AttendanceAttempt** | Failed & suspicious attempts |
| **Notification** | User notifications |
| **College** | College details |

---

## 📊 Attendance Record

Each attendance record contains:

```
├── 👤 Student ID
├── 📅 Attendance Session
├── 📖 Subject
├── 👥 Class Group
├── 🏫 Classroom
├── ✅ Status: PRESENT / ABSENT
├── 📍 GPS Location (Lat, Lng)
├── 📏 Distance from Classroom
├── 🔐 Verification Method (Passkey / Trusted Browser)
├── 📱 Device Information
└── 🕐 Marked Time
```

---

## 📈 Reports & Analytics

Teachers and admins can generate attendance reports:

- 📊 Present/Absent student count
- 📉 Attendance percentage
- ⚠️ Suspicious attempts
- 📚 Class-wise analysis
- 📖 Subject-wise analysis
- 📅 Date range filtering

---

## 🛡️ Security Measures

- 🔒 **Password Hashing** — bcrypt
- 🔐 **Session Auth** — Passport.js
- 💾 **Secure Sessions** — MongoDB session store
- 🔄 **CSRF Protection** — Express CSRF middleware
- ⛑️ **HTTP Headers** — Helmet
- 🚦 **Rate Limiting** — express-rate-limit
- 🔑 **Passkey Verification** — WebAuthn
- ✔️ **GPS Validation** — Server-side verification
- 🚪 **Role-Based Access** — Protected routes

---

## 🚀 Local Setup

### Prerequisites
- Node.js (v14+)
- MongoDB
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/harshkolicool/Attendance.git
cd Attendance

# Switch to development branch
git checkout harsh

# Install dependencies
npm install

# Create .env file and configure
# (DATABASE_URL, SESSION_SECRET, etc.)
cp .env.example .env

# Start the server
npm start
```

The app will run on `http://localhost:3000`

---

## 📁 Project Structure

```
Attendance/
├── views/              # EJS templates
├── routes/             # Express routes
├── controllers/        # Business logic
├── models/             # Mongoose schemas
├── middleware/         # Custom middleware
├── public/             # Static files (CSS, JS)
├── utils/              # Helper functions
├── config/             # Configuration files
└── app.js              # Main application file
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see LICENSE file for details.

---

<div align="center">

### ⭐ If you found this helpful, please star the repo!

**Made with ❤️ by [harshkolicool](https://github.com/harshkolicool)**

</div>