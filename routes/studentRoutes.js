const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Student = require("../models/studentSchema");
const AttendanceSession = require("../models/attendanceSessionSchema");
const { expireOneSession } = require("../utils/attendanceExpiryJob");
const AttendanceRecord = require("../models/attendanceRecordSchema");
const AttendanceAttempt = require("../models/attendanceAttemptSchema");
const Schedule = require("../models/scheduleSchema");
const PasskeySetupRequest = require("../models/passkeySetupRequestSchema");

const { sortSchedulesByTime } = require("../utils/scheduleTime");
const getDistanceInMeters = require("../utils/geoDistance");
const socketManager = require("../utils/socketManager");
const crypto = require("crypto");
const {
    createNotification,
    getUnreadCount,
    getRecentNotifications,
    markAllRead,
    markNotificationRead,
    deleteNotification,
    clearAllNotifications
} = require("../utils/notificationService");

const {
    createAttendanceToken,
    consumeAttendanceToken,
    allowAttendanceRequest,
    getClientIp
} = require("../utils/attendanceSecurity");

const {
    getWebAuthnConfig,
    getSimpleWebAuthnServer
} = require("../utils/webauthnConfig");

const MAX_GPS_ACCURACY_METERS = 50;
const TRUSTED_DEVICE_ACTIVATION_DELAY_MINUTES = process.env.NODE_ENV === "production" ? 10 : 0;
const MAX_GPS_UNCERTAINTY_ALLOWANCE_METERS = 25;
const SMALL_RADIUS_THRESHOLD_METERS = 10;
const SMALL_RADIUS_GRACE_METERS = 8;

function getGpsUncertaintyAllowanceMeters(studentAccuracy, teacherAccuracy, allowedRadius) {
    let allowance = 0;

    if (Number.isFinite(Number(studentAccuracy)) && Number(studentAccuracy) > 0) {
        allowance += Number(studentAccuracy);
    }

    if (Number.isFinite(Number(teacherAccuracy)) && Number(teacherAccuracy) > 0) {
        allowance += Number(teacherAccuracy);
    }

    /*
        For very small radii (for example 1m), real-world GPS jitter can be
        larger than the radius even when student is physically at the location.
    */
    if (Number(allowedRadius) < SMALL_RADIUS_THRESHOLD_METERS) {
        allowance += SMALL_RADIUS_GRACE_METERS;
    }

    return Math.min(allowance, MAX_GPS_UNCERTAINTY_ALLOWANCE_METERS);
}

function evaluateRadiusCheck(distanceMeters, allowedRadiusMeters, studentAccuracyMeters, teacherAccuracyMeters) {
    const measuredDistance = Number(distanceMeters) || 0;
    const allowedRadius = Number(allowedRadiusMeters) || 0;

    const uncertaintyAllowance = getGpsUncertaintyAllowanceMeters(
        studentAccuracyMeters,
        teacherAccuracyMeters,
        allowedRadius
    );

    const minimumPossibleDistance = Math.max(0, measuredDistance - uncertaintyAllowance);

    return {
        measuredDistance: measuredDistance,
        allowedRadius: allowedRadius,
        uncertaintyAllowance: uncertaintyAllowance,
        minimumPossibleDistance: minimumPossibleDistance,
        isOutside: minimumPossibleDistance > allowedRadius
    };
}

function isStudent(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.redirect("/student/login");
    }

    if (req.user.accountType !== "student") {
        return res.redirect("/");
    }

    next();
}

function getTodayName() {
    const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    return days[new Date().getDay()];
}

function getTodayRange() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    return {
        start: todayStart,
        end: todayEnd
    };
}

function getId(value) {
    if (!value) {
        return null;
    }

    if (value._id) {
        return value._id.toString();
    }

    return value.toString();
}

function sameId(a, b) {
    if (!a || !b) {
        return false;
    }

    return getId(a) === getId(b);
}

function getStudentIdFromRequest(req) {
    return req.user._id || req.user.id;
}

function getStudentNotificationFilter(student) {
    return {
        recipientRole: "STUDENT",
        recipientUserId: student._id
    };
}

function getPasskeyCount(student) {
    if (!student || !student.passkeys) {
        return 0;
    }

    return student.passkeys.length;
}

function getActiveTrustedDeviceCount(student) {
    if (!student || !student.trustedDevices) {
        return 0;
    }

    return student.trustedDevices.filter(function (device) {
        return device && device.isActive;
    }).length;
}

function isPasskeySetupAllowed(student) {
    if (!student || !student.passkeySetupAllowedUntil) {
        return false;
    }

    return new Date(student.passkeySetupAllowedUntil).getTime() > Date.now();
}
function isTrustedDeviceSetupAllowed(student) {
    if (!student || !student.trustedDeviceSetupAllowedUntil) {
        return false;
    }

    return new Date(student.trustedDeviceSetupAllowedUntil).getTime() > Date.now();
}

async function hasActiveAttendanceForStudentClass(student) {
    if (!student || !student.college || !student.classGroup) {
        return false;
    }

    const activeSession = await AttendanceSession.exists({
        college: student.college,
        classGroup: student.classGroup,
        isActive: true,
        status: "ACTIVE",
        endTime: { $gt: new Date() }
    });

    return !!activeSession;
}

function getPasskeyByCredentialId(student, credentialId) {
    if (!student || !student.passkeys || !credentialId) {
        return null;
    }

    for (let i = 0; i < student.passkeys.length; i++) {
        if (student.passkeys[i].credentialId === credentialId) {
            return student.passkeys[i];
        }
    }

    return null;
}

function getPublicKeyBytes(passkey) {
    if (!passkey || !passkey.credentialPublicKey) {
        return null;
    }

    return new Uint8Array(passkey.credentialPublicKey);
}

function findScheduleForSession(schedules, session) {
    for (let i = 0; i < schedules.length; i++) {
        const schedule = schedules[i];

        if (session.schedule && sameId(session.schedule, schedule._id)) {
            return schedule;
        }

        if (
            !session.schedule &&
            session.subject &&
            schedule.subject &&
            session.classGroup &&
            schedule.classGroup &&
            sameId(session.subject, schedule.subject) &&
            sameId(session.classGroup, schedule.classGroup)
        ) {
            return schedule;
        }
    }

    return null;
}

function studentGetDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return year + "-" + month + "-" + day;
}

function studentGetMonthStartInputValue() {
    const date = new Date();
    date.setDate(1);
    return studentGetDateInputValue(date);
}

function studentGetStartOfDate(dateString) {
    const date = dateString ? new Date(dateString + "T00:00:00") : new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

function studentGetEndOfDate(dateString) {
    const date = dateString ? new Date(dateString + "T23:59:59.999") : new Date();
    date.setHours(23, 59, 59, 999);
    return date;
}

function studentGetPercent(part, total) {
    if (!total || total <= 0) {
        return 0;
    }

    return Math.round((part / total) * 100);
}

function studentSafeObjectId(value) {
    if (!value || value === "all") {
        return null;
    }

    if (!mongoose.Types.ObjectId.isValid(value)) {
        return null;
    }

    return value;
}

function studentCsvEscape(value) {
    if (value === undefined || value === null) {
        return "";
    }

    const text = value.toString();

    if (
        text.includes(",") ||
        text.includes('"') ||
        text.includes("\n")
    ) {
        return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
}

function studentSendCsvResponse(res, filename, rows) {
    const csvContent = rows.map(function (row) {
        return row.map(studentCsvEscape).join(",");
    }).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
        "Content-Disposition",
        "attachment; filename=" + filename
    );

    res.send(csvContent);
}
function parseCookieHeader(cookieHeader) {
    const cookies = {};

    if (!cookieHeader) {
        return cookies;
    }

    cookieHeader.split(";").forEach(function (cookie) {
        const parts = cookie.split("=");
        const key = parts.shift();

        if (!key) {
            return;
        }

        cookies[key.trim()] = decodeURIComponent(parts.join("="));
    });

    return cookies;
}

function hashTrustedDeviceToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function createRawTrustedDeviceToken() {
    return crypto.randomBytes(32).toString("hex");
}


function getTrustedDeviceCookie(req) {
    const cookies = parseCookieHeader(req.headers.cookie || "");
    return cookies.studentTrustedDevice || "";
}

function getTrustedDeviceCookieDeviceId(req) {
    const cookieValue = getTrustedDeviceCookie(req);

    if (!cookieValue || !cookieValue.includes(".")) {
        return "";
    }

    return cookieValue.split(".")[0] || "";
}

function getTrustedDeviceFromStudent(student, req) {
    const cookieValue = getTrustedDeviceCookie(req);

    if (!cookieValue || !cookieValue.includes(".")) {
        return null;
    }

    const parts = cookieValue.split(".");
    const deviceId = parts[0];
    const rawToken = parts[1];

    if (!deviceId || !rawToken) {
        return null;
    }

    const tokenHash = hashTrustedDeviceToken(rawToken);

    const devices = student.trustedDevices || [];

    for (let i = 0; i < devices.length; i++) {
        const device = devices[i];

        if (
            device.deviceId === deviceId &&
            device.tokenHash === tokenHash &&
            device.isActive
        ) {
            return device;
        }
    }

    return null;
}

function isTrustedDeviceUsable(device) {
    if (!device || !device.isActive) {
        return false;
    }

    const usableAfter = device.usableAfter || device.registeredAt;

    if (!usableAfter) {
        return true;
    }

    return new Date(usableAfter).getTime() <= Date.now();
}

function getTrustedDeviceWaitMinutes(device) {
    if (!device || !device.usableAfter) {
        return 0;
    }

    const diffMs = new Date(device.usableAfter).getTime() - Date.now();

    if (diffMs <= 0) {
        return 0;
    }

    return Math.ceil(diffMs / 60000);
}

function setTrustedDeviceCookie(res, deviceId, rawToken) {
    const cookieValue = encodeURIComponent(deviceId + "." + rawToken);
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

    res.setHeader(
        "Set-Cookie",
        "studentTrustedDevice=" +
            cookieValue +
            "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
            (60 * 60 * 24 * 180) +
            secureCookie
    );
}

function clearTrustedDeviceCookie(res) {
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

    res.setHeader(
        "Set-Cookie",
        "studentTrustedDevice=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secureCookie
    );
}

async function saveAttendanceAttempt(options) {
    try {
        const req = options.req;
        const student = options.student;
        const session = options.session;

        if (!student || !session) {
            return;
        }

        const attempt = await AttendanceAttempt.create({
            student: student._id,
            studentName: student.fullName || "Unknown Student",
            enrollmentNumber: student.enrollmentNumber || "Unknown",

            attendanceSession: session._id,
            schedule: getId(session.schedule),
            teacher: getId(session.teacher),
            subject: getId(session.subject),
            college: getId(session.college),
            classGroup: getId(session.classGroup),
            classroom: getId(session.classroom),

            result: options.result || "REJECTED",
            reasonCode: options.reasonCode || "UNKNOWN",
            reasonMessage: options.reasonMessage || "Attendance attempt logged.",

            studentLatitude: options.latitude !== undefined ? Number(options.latitude) : undefined,
            studentLongitude: options.longitude !== undefined ? Number(options.longitude) : undefined,
            teacherLatitude: options.teacherLatitude !== undefined ? Number(options.teacherLatitude) : undefined,
            teacherLongitude: options.teacherLongitude !== undefined ? Number(options.teacherLongitude) : undefined,

            distanceFromTeacher: Number.isFinite(Number(options.distance)) ? Math.round(Number(options.distance)) : 0,
            allowedRadius: Number.isFinite(Number(options.allowedRadius)) ? Number(options.allowedRadius) : 0,
            gpsAccuracy: Number.isFinite(Number(options.accuracy)) ? Math.round(Number(options.accuracy)) : 0,
            maxAllowedAccuracy: MAX_GPS_ACCURACY_METERS,

            passkeyCredentialId: options.passkeyCredentialId || "",
            browserFingerprint: options.browserFingerprint || "",
            userAgent: req ? req.headers["user-agent"] : "",
            ip: req ? getClientIp(req) : ""
        });

        if (
            attempt.result !== "SUCCESS" &&
            socketManager &&
            typeof socketManager.emitSuspiciousAttendanceAttempt === "function"
        ) {
            socketManager.emitSuspiciousAttendanceAttempt(attempt);
        }
    } catch (err) {
        console.log("SAVE ATTENDANCE ATTEMPT ERROR:");
        console.log(err.message);
    }
}

async function getStudentPageData(req) {
    const student = await Student.findById(getStudentIdFromRequest(req))
        .populate("classGroup")
        .populate("subjects");

    if (!student) {
        return {
            error: "Student not found"
        };
    }

    if (!student.classGroup) {
        return {
            error: "Student classGroup missing. Run initAll.js again."
        };
    }

    if (!student.college) {
        return {
            error: "Student college missing. Please contact admin."
        };
    }

    const today = getTodayName();
    const todayRange = getTodayRange();

    const schedules = await Schedule.find({
        college: student.college,
        classGroup: student.classGroup._id,
        day: today
    })
        .populate("subject")
        .populate("teacher")
        .populate("classroom")
        .populate("classGroup");

    sortSchedulesByTime(schedules);

    const todaySessions = await AttendanceSession.find({
        college: student.college,
        classGroup: student.classGroup._id,
        startTime: {
            $gte: todayRange.start,
            $lte: todayRange.end
        }
    })
        .populate("schedule")
        .populate("subject")
        .populate("classroom")
        .populate("teacher")
        .populate("classGroup");

    const activeSessions = await AttendanceSession.find({
        college: student.college,
        classGroup: student.classGroup._id,
        isActive: true,
        status: "ACTIVE",
        endTime: { $gt: new Date() }
    })
        .populate("schedule")
        .populate("subject")
        .populate("classroom")
        .populate("teacher")
        .populate("classGroup");

    for (let i = 0; i < activeSessions.length; i++) {
        if (!activeSessions[i].schedule) {
            const matchedSchedule = findScheduleForSession(schedules, activeSessions[i]);

            if (matchedSchedule) {
                activeSessions[i].schedule = matchedSchedule;
            }
        }
    }

    const todaySessionIds = [];

    for (let i = 0; i < todaySessions.length; i++) {
        todaySessionIds.push(todaySessions[i]._id);
    }

    const attendanceRecords = await AttendanceRecord.find({
        student: student._id,
        attendanceSession: { $in: todaySessionIds }
    });

    const markedSessionIds = [];
    const attendanceStatusBySchedule = {};

    for (let i = 0; i < attendanceRecords.length; i++) {
        const record = attendanceRecords[i];

        if (record.attendanceSession) {
            markedSessionIds.push(record.attendanceSession.toString());
        }

        let matchedSession = null;

        for (let j = 0; j < todaySessions.length; j++) {
            if (
                record.attendanceSession &&
                todaySessions[j]._id.toString() === record.attendanceSession.toString()
            ) {
                matchedSession = todaySessions[j];
            }
        }

        if (matchedSession) {
            const matchedSchedule = findScheduleForSession(schedules, matchedSession);

            if (matchedSchedule) {
                attendanceStatusBySchedule[matchedSchedule._id.toString()] = {
                    status: record.status,
                    sessionId: matchedSession._id.toString()
                };
            }
        }
    }

    let presentCount = 0;
    let absentCount = 0;

    for (let key in attendanceStatusBySchedule) {
        if (attendanceStatusBySchedule[key].status === "PRESENT") {
            presentCount++;
        }

        if (attendanceStatusBySchedule[key].status === "ABSENT") {
            absentCount++;
        }
    }

    let attendancePercentage = 0;

    if (schedules.length > 0) {
        attendancePercentage = Math.round((presentCount / schedules.length) * 100);
    }

    const allStudentRecords = await AttendanceRecord.find({
        student: student._id,
        college: student.college
    })
        .populate("subject")
        .sort({
            createdAt: -1
        });

    const dashboardSubjectMap = {};

    for (let i = 0; i < allStudentRecords.length; i++) {
        const record = allStudentRecords[i];

        const subjectKey = record.subject
            ? record.subject._id.toString()
            : "missing-subject";

        if (!dashboardSubjectMap[subjectKey]) {
            dashboardSubjectMap[subjectKey] = {
                name: record.subject ? record.subject.subjectName : "Subject Missing",
                code: record.subject && record.subject.subjectCode ? record.subject.subjectCode : "",
                total: 0,
                present: 0,
                absent: 0,
                percentage: 0
            };
        }

        dashboardSubjectMap[subjectKey].total++;

        if (record.status === "PRESENT") {
            dashboardSubjectMap[subjectKey].present++;
        }

        if (record.status === "ABSENT") {
            dashboardSubjectMap[subjectKey].absent++;
        }
    }

    const dashboardSubjectSummary = Object.values(dashboardSubjectMap).map(function (item) {
        item.percentage = studentGetPercent(item.present, item.total);
        return item;
    });

    return {
        student: student,
        schedules: schedules,
        todaySessions: todaySessions,
        activeSessions: activeSessions,
        markedSessionIds: markedSessionIds,
        attendanceStatusBySchedule: attendanceStatusBySchedule,
        today: today,
        presentCount: presentCount,
        absentCount: absentCount,
        attendancePercentage: attendancePercentage,
        dashboardSubjectSummary: dashboardSubjectSummary,
        passkeyCount: getPasskeyCount(student),
        trustedDeviceCount: getActiveTrustedDeviceCount(student),
        hasPasskey: getPasskeyCount(student) > 0,
        hasTrustedDevice: !!getTrustedDeviceFromStudent(student, req),
        hasUsableTrustedDevice: isTrustedDeviceUsable(getTrustedDeviceFromStudent(student, req))
    };
}

router.get("/dashboard", isStudent, async function (req, res) {
    try {
        if (!req.user || !getStudentIdFromRequest(req)) {
            return res.send("User session invalid. Please login again.");
        }

        const data = await getStudentPageData(req);

        if (data.error) {
            return res.send(data.error);
        }

        data.activePage = "dashboard";

        res.render("studentDashboard", data);

    } catch (err) {
        console.log("STUDENT DASHBOARD ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Student dashboard error: " + err.message);
    }
});


router.get("/schedule", isStudent, async function (req, res) {
    try {
        if (!req.user || !getStudentIdFromRequest(req)) {
            return res.redirect("/student/login");
        }

        const student = await Student.findById(getStudentIdFromRequest(req))
            .populate("classGroup")
            .populate("subjects");

        if (!student) {
            return res.send("Student not found.");
        }

        if (!student.classGroup) {
            return res.send("Student classGroup missing. Please contact admin.");
        }

        const dayNames = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];

        function localTimeToMinutes(timeText) {
            if (!timeText || typeof timeText !== "string") {
                return 0;
            }

            const text = timeText.trim().toUpperCase();
            const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);

            if (!match) {
                return 0;
            }

            let hours = Number(match[1]);
            const minutes = Number(match[2]);
            const meridian = match[3];

            if (meridian === "PM" && hours !== 12) {
                hours += 12;
            }

            if (meridian === "AM" && hours === 12) {
                hours = 0;
            }

            return hours * 60 + minutes;
        }

        const todayDate = new Date();

        const upcomingDays = [];

        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(todayDate.getDate() + i);

            upcomingDays.push({
                day: dayNames[date.getDay()],
                date: date,
                offset: i,
                label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayNames[date.getDay()]
            });
        }

        const dayList = upcomingDays.map(function (item) {
            return item.day;
        });

        const schedules = await Schedule.find({
            college: student.college,
            classGroup: student.classGroup._id,
            day: { $in: dayList }
        })
            .populate("subject")
            .populate("teacher")
            .populate("classroom")
            .populate("classGroup");

        schedules.sort(function (a, b) {
            const dayA = dayList.indexOf(a.day);
            const dayB = dayList.indexOf(b.day);

            if (dayA !== dayB) {
                return dayA - dayB;
            }

            return localTimeToMinutes(a.startTime) - localTimeToMinutes(b.startTime);
        });

        const activeSessions = await AttendanceSession.find({
            college: student.college,
            classGroup: student.classGroup._id,
            isActive: true,
            status: "ACTIVE",
            endTime: { $gt: new Date() }
        });

        const activeSessionsBySchedule = {};

        for (let i = 0; i < activeSessions.length; i++) {
            let mappedScheduleId = "";

            if (activeSessions[i].schedule) {
                mappedScheduleId = activeSessions[i].schedule.toString();
            } else {
                const matchedSchedule = findScheduleForSession(schedules, activeSessions[i]);

                if (matchedSchedule && matchedSchedule._id) {
                    mappedScheduleId = matchedSchedule._id.toString();
                }
            }

            if (mappedScheduleId) {
                activeSessionsBySchedule[mappedScheduleId] = activeSessions[i];
            }
        }

        const todayRange = getTodayRange();

        const todaySessions = await AttendanceSession.find({
            college: student.college,
            classGroup: student.classGroup._id,
            startTime: {
                $gte: todayRange.start,
                $lte: todayRange.end
            }
        });

        const todaySessionIds = todaySessions.map(function (session) {
            return session._id;
        });

        const scheduleIdByTodaySession = {};

        for (let i = 0; i < todaySessions.length; i++) {
            if (todaySessions[i].schedule) {
                scheduleIdByTodaySession[todaySessions[i]._id.toString()] =
                    todaySessions[i].schedule.toString();
            } else {
                const matchedSchedule = findScheduleForSession(schedules, todaySessions[i]);

                if (matchedSchedule && matchedSchedule._id) {
                    scheduleIdByTodaySession[todaySessions[i]._id.toString()] =
                        matchedSchedule._id.toString();
                }
            }
        }

        const todayRecords = await AttendanceRecord.find({
            student: student._id,
            attendanceSession: { $in: todaySessionIds }
        });

        const attendanceStatusBySchedule = {};

        for (let i = 0; i < todayRecords.length; i++) {
            const record = todayRecords[i];
            const sessionId = record.attendanceSession
                ? record.attendanceSession.toString()
                : "";

            const scheduleId = scheduleIdByTodaySession[sessionId];

            if (scheduleId) {
                attendanceStatusBySchedule[scheduleId] = {
                    status: record.status,
                    sessionId: sessionId
                };
            }
        }

        const weeklyScheduleGroups = upcomingDays.map(function (dayInfo) {
            return {
                day: dayInfo.day,
                label: dayInfo.label,
                date: dayInfo.date,
                offset: dayInfo.offset,
                schedules: schedules.filter(function (schedule) {
                    return schedule.day === dayInfo.day;
                })
            };
        });

        res.render("studentSchedule", {
            student: student,
            activePage: "schedule",
            today: getTodayName(),
            weeklyScheduleGroups: weeklyScheduleGroups,
            activeSessionsBySchedule: activeSessionsBySchedule,
            attendanceStatusBySchedule: attendanceStatusBySchedule,
            passkeyCount: getPasskeyCount(student),
            trustedDeviceCount: getActiveTrustedDeviceCount(student),
            hasPasskey: getPasskeyCount(student) > 0,
            hasTrustedDevice: !!getTrustedDeviceFromStudent(student, req),
            hasUsableTrustedDevice: isTrustedDeviceUsable(getTrustedDeviceFromStudent(student, req))
        });

    } catch (err) {
        console.log("STUDENT SCHEDULE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Student schedule error: " + err.message);
    }
});


router.get("/passkey/register/options", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        if (student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Your account is blocked."
            });
        }

        if (student.passkeys && student.passkeys.length > 0) {
            return res.status(403).json({
                success: false,
                message: "You already have a passkey. Ask admin to reset/allow setup before adding a new one."
            });
        }

        if (!isPasskeySetupAllowed(student)) {
            return res.status(403).json({
                success: false,
                message: "Passkey setup is not open for your account. Ask your college admin to allow passkey setup."
            });
        }

        const activeAttendanceExists = await hasActiveAttendanceForStudentClass(student);

        if (activeAttendanceExists) {
            return res.status(403).json({
                success: false,
                message: "You cannot register a passkey while an attendance session is active."
            });
        }

        const webauthn = await getSimpleWebAuthnServer();
        const config = getWebAuthnConfig(req);

        const options = await webauthn.generateRegistrationOptions({
            rpName: config.rpName,
            rpID: config.rpID,

            userID: Buffer.from(student._id.toString()),
            userName: student.email,
            userDisplayName: student.fullName,

            attestationType: "none",

            excludeCredentials: (student.passkeys || []).map(function (passkey) {
                return {
                    id: passkey.credentialId,
                    transports: passkey.transports || []
                };
            }),

            authenticatorSelection: {
                residentKey: "preferred",
                requireResidentKey: false,
                userVerification: "required"
            },

            supportedAlgorithmIDs: [-7, -257],
            timeout: 60000
        });

        req.session.webauthnRegistration = {
            challenge: options.challenge,
            studentId: student._id.toString()
        };

        res.json(options);

    } catch (err) {
        console.log("PASSKEY REGISTER OPTIONS ERROR:");
        console.log(err.message);

        res.status(500).json({
            success: false,
            message: "Could not start passkey registration: " + err.message
        });
    }
});



router.post("/passkey/register/verify", isStudent, async function (req, res) {
    try {
        const savedChallenge = req.session.webauthnRegistration;

        if (!savedChallenge) {
            return res.status(400).json({
                success: false,
                message: "Passkey registration session expired. Please try again."
            });
        }

        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

        if (student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Your account is blocked."
            });
        }

        if (savedChallenge.studentId !== student._id.toString()) {
            return res.status(403).json({
                success: false,
                message: "Invalid passkey registration session."
            });
        }

        if (student.passkeys && student.passkeys.length > 0) {
            return res.status(403).json({
                success: false,
                message: "You already have a passkey. Ask admin to reset/allow setup before adding a new one."
            });
        }

        if (!isPasskeySetupAllowed(student)) {
            return res.status(403).json({
                success: false,
                message: "Passkey setup window expired or was not allowed by admin."
            });
        }

        const activeAttendanceExists = await hasActiveAttendanceForStudentClass(student);

        if (activeAttendanceExists) {
            return res.status(403).json({
                success: false,
                message: "You cannot register a passkey while an attendance session is active."
            });
        }

        const webauthn = await getSimpleWebAuthnServer();
        const config = getWebAuthnConfig(req);

        const verification = await webauthn.verifyRegistrationResponse({
            response: req.body,
            expectedChallenge: savedChallenge.challenge,
            expectedOrigin: config.origin,
            expectedRPID: config.rpID
        });

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({
                success: false,
                message: "Passkey verification failed."
            });
        }

        const credential = verification.registrationInfo.credential;

        if (!student.passkeys) {
            student.passkeys = [];
        }

        if (getPasskeyByCredentialId(student, credential.id)) {
            return res.status(400).json({
                success: false,
                message: "This passkey is already registered."
            });
        }

        student.passkeys.push({
            credentialId: credential.id,
            credentialPublicKey: Buffer.from(credential.publicKey),
            counter: credential.counter || 0,
            transports: credential.transports || (req.body.response && req.body.response.transports) || [],
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp || false,
            name: "Passkey 1",
            registeredAt: new Date()
        });

        student.passkeySetupAllowedAt = undefined;
        student.passkeySetupAllowedUntil = undefined;
        student.passkeySetupAllowedBy = undefined;

        await student.save();

        req.session.webauthnRegistration = null;

        res.json({
            success: true,
            verified: true,
            message: "Passkey registered successfully."
        });

    } catch (err) {
        console.log("PASSKEY REGISTER VERIFY ERROR:");
        console.log(err.message);

        res.status(400).json({
            success: false,
            message: "Could not verify passkey: " + err.message
        });
    }
});


router.get("/attendance/passkey/options/:sessionId", isStudent, async function (req, res) {
    try {
        const sessionId = req.params.sessionId;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid attendance session."
            });
        }

        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student || student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Student account not allowed."
            });
        }

        if (!student.passkeys || student.passkeys.length === 0) {
            return res.status(403).json({
                success: false,
                needPasskey: true,
                message: "Please register your passkey before marking attendance."
            });
        }

        const session = await AttendanceSession.findById(sessionId);

        if (!session || !session.isActive || session.status !== "ACTIVE") {
            return res.status(400).json({
                success: false,
                message: "Attendance session is not active."
            });
        }

        if (session.endTime < new Date()) {
            await expireOneSession(session._id, {
                userAgent: req.headers["user-agent"],
                ip: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Attendance session expired."
            });
        }

        if (!sameId(session.college, student.college)) {
            return res.status(403).json({
                success: false,
                message: "Invalid college."
            });
        }

        if (!sameId(session.classGroup, student.classGroup)) {
            return res.status(403).json({
                success: false,
                message: "This attendance is not for your class."
            });
        }

        const alreadyMarked = await AttendanceRecord.findOne({
            student: student._id,
            attendanceSession: session._id
        });

        if (alreadyMarked) {
            return res.status(400).json({
                success: false,
                message: "Attendance already marked."
            });
        }

        const webauthn = await getSimpleWebAuthnServer();
        const config = getWebAuthnConfig(req);

        const options = await webauthn.generateAuthenticationOptions({
            rpID: config.rpID,
            userVerification: "required",
            allowCredentials: student.passkeys.map(function (passkey) {
                return {
                    id: passkey.credentialId,
                    transports: passkey.transports || []
                };
            })
        });

        req.session.webauthnAttendance = {
            challenge: options.challenge,
            studentId: student._id.toString(),
            sessionId: session._id.toString()
        };

        res.json(options);
    } catch (err) {
        console.log("ATTENDANCE PASSKEY OPTIONS ERROR:");
        console.log(err.message);

        res.status(500).json({
            success: false,
            message: "Could not start passkey verification: " + err.message
        });
    }
});

router.post("/attendance/passkey/verify/:sessionId", isStudent, async function (req, res) {
    try {
        const savedChallenge = req.session.webauthnAttendance;

        if (!savedChallenge) {
            return res.status(400).json({
                success: false,
                message: "Passkey verification expired. Please try again."
            });
        }

        const student = await Student.findById(getStudentIdFromRequest(req));
        const session = await AttendanceSession.findById(req.params.sessionId);

        if (!student || !session) {
            return res.status(404).json({
                success: false,
                message: "Student or attendance session not found."
            });
        }

        if (
            savedChallenge.studentId !== student._id.toString() ||
            savedChallenge.sessionId !== session._id.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Invalid passkey attendance session."
            });
        }

        const passkey = getPasskeyByCredentialId(student, req.body.id);

        if (!passkey) {
            return res.status(403).json({
                success: false,
                message: "This passkey is not registered for your account."
            });
        }

        const webauthn = await getSimpleWebAuthnServer();
        const config = getWebAuthnConfig(req);

        const verification = await webauthn.verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge: savedChallenge.challenge,
            expectedOrigin: config.origin,
            expectedRPID: config.rpID,
            credential: {
                id: passkey.credentialId,
                publicKey: getPublicKeyBytes(passkey),
                counter: passkey.counter || 0,
                transports: passkey.transports || []
            }
        });

        if (!verification.verified) {
            return res.status(400).json({
                success: false,
                message: "Passkey verification failed."
            });
        }

        passkey.counter = verification.authenticationInfo.newCounter;
        passkey.lastUsedAt = new Date();

        await student.save();

        req.session.webauthnAttendance = null;

        const attendanceToken = createAttendanceToken({
            sessionId: session._id,
            studentId: student._id,
            credentialId: passkey.credentialId,
            expiresInSeconds: 120
        });

        res.json({
            success: true,
            verified: true,
            attendanceToken: attendanceToken
        });
    } catch (err) {
        console.log("ATTENDANCE PASSKEY VERIFY ERROR:");
        console.log(err.message);

        res.status(400).json({
            success: false,
            message: "Could not verify passkey: " + err.message
        });
    }
});


router.post("/device/register", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student || student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Student account not allowed."
            });
        }

        const password = req.body.password || "";
        const browserFingerprint = req.body.browserFingerprint || "";

        if (!password) {
            return res.status(400).json({
                success: false,
                message: "Password is required to trust this browser."
            });
        }

        const existingTrustedDevice = getTrustedDeviceFromStudent(student, req);

        if (existingTrustedDevice) {
            existingTrustedDevice.browserFingerprint = browserFingerprint;
            existingTrustedDevice.userAgent = req.headers["user-agent"] || "";
            existingTrustedDevice.lastUsedAt = new Date();
            existingTrustedDevice.isActive = true;

            await student.save();

            return res.json({
                success: true,
                message: "This browser is already trusted."
            });
        }

        if (!isTrustedDeviceSetupAllowed(student)) {
            return res.status(403).json({
                success: false,
                message: "Trusted browser setup is locked. Ask your college admin to allow browser fallback for your account."
            });
        }

        const passwordOk = await student.comparePassword(password);

        if (!passwordOk) {
            return res.status(401).json({
                success: false,
                message: "Incorrect password."
            });
        }

        const activeAttendanceExists = await hasActiveAttendanceForStudentClass(student);

        if (activeAttendanceExists) {
            return res.status(400).json({
                success: false,
                message: "You cannot trust a new browser while attendance is active. Ask teacher for manual attendance today."
            });
        }

        const activeDevices = (student.trustedDevices || []).filter(function (device) {
            return device && device.isActive;
        });

        if (activeDevices.length >= 2) {
            activeDevices.sort(function (first, second) {
                return new Date(first.registeredAt || 0).getTime() -
                    new Date(second.registeredAt || 0).getTime();
            });

            activeDevices[0].isActive = false;
        }

        const deviceId = crypto.randomBytes(12).toString("hex");
        const rawToken = createRawTrustedDeviceToken();
        const now = new Date();

        const usableAfter = new Date(
            Date.now() + TRUSTED_DEVICE_ACTIVATION_DELAY_MINUTES * 60 * 1000
        );

        if (!student.trustedDevices) {
            student.trustedDevices = [];
        }

        student.trustedDevices.push({
            deviceId: deviceId,
            tokenHash: hashTrustedDeviceToken(rawToken),
            browserFingerprint: browserFingerprint,
            userAgent: req.headers["user-agent"] || "",
            registeredAt: now,
            usableAfter: usableAfter,
            trustedByPasswordAt: now,
            isActive: true
        });

        student.trustedDeviceSetupAllowedAt = undefined;
        student.trustedDeviceSetupAllowedUntil = undefined;
        student.trustedDeviceSetupAllowedBy = undefined;

        await student.save();

        setTrustedDeviceCookie(res, deviceId, rawToken);

        res.json({
            success: true,
            message: TRUSTED_DEVICE_ACTIVATION_DELAY_MINUTES > 0
                ? "Browser trusted successfully. It can be used for attendance after " +
                    TRUSTED_DEVICE_ACTIVATION_DELAY_MINUTES +
                    " minutes."
                : "Browser trusted successfully. It can be used for attendance now.",
            waitMinutes: TRUSTED_DEVICE_ACTIVATION_DELAY_MINUTES
        });

    } catch (err) {
        console.log("TRUSTED DEVICE REGISTER ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).json({
            success: false,
            message: "Could not trust this browser: " + err.message
        });
    }
});

router.get("/attendance/device-token/:sessionId", isStudent, async function (req, res) {
    try {
        const sessionId = req.params.sessionId;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid attendance session."
            });
        }

        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student || student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Student account not allowed."
            });
        }

        const trustedDevice = getTrustedDeviceFromStudent(student, req);

        if (!trustedDevice) {
            return res.status(403).json({
                success: false,
                needTrustedDevice: true,
                message: "This browser is not trusted yet. Open Passkeys and trust this browser with your password."
            });
        }

        if (!isTrustedDeviceUsable(trustedDevice)) {
            return res.status(403).json({
                success: false,
                trustedDevicePending: true,
                waitMinutes: getTrustedDeviceWaitMinutes(trustedDevice),
                message:
                    "This trusted browser is still activating. Try again in " +
                    getTrustedDeviceWaitMinutes(trustedDevice) +
                    " minute(s)."
            });
        }

        const session = await AttendanceSession.findById(sessionId);

        if (!session || !session.isActive || session.status !== "ACTIVE") {
            return res.status(400).json({
                success: false,
                message: "Attendance session is not active."
            });
        }

        if (session.endTime < new Date()) {
            await expireOneSession(session._id, {
                userAgent: req.headers["user-agent"],
                ip: req.ip
            });

            return res.status(400).json({
                success: false,
                message: "Attendance session expired."
            });
        }

        if (!sameId(session.college, student.college)) {
            return res.status(403).json({
                success: false,
                message: "Invalid college."
            });
        }

        if (!sameId(session.classGroup, student.classGroup)) {
            return res.status(403).json({
                success: false,
                message: "This attendance is not for your class."
            });
        }

        const alreadyMarked = await AttendanceRecord.findOne({
            student: student._id,
            attendanceSession: session._id
        });

        if (alreadyMarked) {
            return res.status(400).json({
                success: false,
                message: "Attendance already marked."
            });
        }

        trustedDevice.lastUsedAt = new Date();
        await student.save();

        const attendanceToken = createAttendanceToken({
            sessionId: session._id,
            studentId: student._id,
            credentialId: "TRUSTED_DEVICE:" + trustedDevice.deviceId,
            expiresInSeconds: 120
        });

        res.json({
            success: true,
            attendanceToken: attendanceToken,
            verificationMethod: "TRUSTED_DEVICE_GEOLOCATION"
        });
    } catch (err) {
        console.log("TRUSTED DEVICE TOKEN ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).json({
            success: false,
            message: "Could not verify trusted browser: " + err.message
        });
    }
});

router.post("/attendance/mark", isStudent, async function (req, res) {
    let student = null;
    let session = null;

    try {
        const loggedStudentId = getStudentIdFromRequest(req);
        const requestIp = getClientIp(req);

        const markLimitKey = "mark:" + loggedStudentId.toString() + ":" + requestIp;
        const markLimit = allowAttendanceRequest(markLimitKey, 10, 60 * 1000);

        if (!markLimit.allowed) {
            return res.status(429).json({
                success: false,
                message: "Too many attendance attempts. Try again after " + markLimit.retryAfter + " seconds."
            });
        }

        const sessionId = req.body.sessionId;
        const latitude = req.body.latitude;
        const longitude = req.body.longitude;
        const accuracy = req.body.accuracy;
        const attendanceToken = req.body.attendanceToken;
        const browserFingerprint = req.body.browserFingerprint || "";

        if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid attendance session."
            });
        }

        if (
            latitude === undefined ||
            latitude === null ||
            latitude === "" ||
            longitude === undefined ||
            longitude === null ||
            longitude === ""
        ) {
            return res.status(400).json({
                success: false,
                message: "Location is required."
            });
        }

        if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
            return res.status(400).json({
                success: false,
                message: "Invalid location coordinates."
            });
        }

        if (accuracy === undefined || accuracy === null || accuracy === "") {
            return res.status(400).json({
                success: false,
                message: "GPS accuracy is required. Please refresh and try again."
            });
        }

        if (!Number.isFinite(Number(accuracy)) || Number(accuracy) <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid GPS accuracy."
            });
        }

        student = await Student.findById(loggedStudentId);

        if (!student) {
            return res.status(401).json({
                success: false,
                message: "Student not found."
            });
        }

        if (student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Your student account is blocked."
            });
        }

        session = await AttendanceSession.findById(sessionId)
            .populate("schedule")
            .populate("classroom")
            .populate("subject")
            .populate("classGroup")
            .populate("teacher");

        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Attendance session not found."
            });
        }

        if (!session.isActive || session.status !== "ACTIVE") {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "SESSION_CLOSED",
                reasonMessage: "Attendance session is closed.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint
            });

            return res.status(400).json({
                success: false,
                message: "Attendance session is closed."
            });
        }

        if (session.endTime < new Date()) {
            session.isActive = false;
            session.status = "EXPIRED";
            await session.save();

            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "SESSION_EXPIRED",
                reasonMessage: "Attendance session expired.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint
            });

            return res.status(400).json({
                success: false,
                message: "Attendance session expired."
            });
        }

        if (!sameId(session.college, student.college)) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "COLLEGE_MISMATCH",
                reasonMessage: "Student tried to mark attendance for another college.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint
            });

            return res.status(403).json({
                success: false,
                message: "Invalid college."
            });
        }

        if (!sameId(session.classGroup, student.classGroup)) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "CLASS_GROUP_MISMATCH",
                reasonMessage: "Student tried to mark attendance for another class group.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint
            });

            return res.status(403).json({
                success: false,
                message: "This attendance is not for your class."
            });
        }

        const tokenCheck = consumeAttendanceToken(attendanceToken, {
            sessionId: session._id,
            studentId: student._id
        });

        if (!tokenCheck.valid) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "TOKEN_INVALID",
                reasonMessage: tokenCheck.message,
                latitude,
                longitude,
                accuracy,
                browserFingerprint
            });

            return res.status(403).json({
                success: false,
                message: tokenCheck.message
            });
        }

        const alreadyMarked = await AttendanceRecord.findOne({
            student: student._id,
            attendanceSession: session._id
        });

        if (alreadyMarked) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "ALREADY_MARKED",
                reasonMessage: "Student tried to mark attendance again.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint,
                passkeyCredentialId: tokenCheck.payload.cid
            });

            return res.status(400).json({
                success: false,
                message: "Attendance already marked."
            });
        }

        if (Number(accuracy) > MAX_GPS_ACCURACY_METERS) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "LOW_GPS_ACCURACY",
                reasonMessage: "GPS accuracy is too low.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint,
                passkeyCredentialId: tokenCheck.payload.cid
            });

            return res.status(403).json({
                success: false,
                message:
                    "Your GPS accuracy is too low. Move near a window and try again. Accuracy: " +
                    Math.round(Number(accuracy)) +
                    "m. Required: " +
                    MAX_GPS_ACCURACY_METERS +
                    "m or better."
            });
        }

        const sessionLatitude = session.latitude;
        const sessionLongitude = session.longitude;
        const sessionRadius = Number(session.radius || 100);
        const teacherGpsAccuracy = Number(session.teacherGpsAccuracy || 0);
        const studentGpsAccuracy = Number(accuracy);

        if (
            sessionLatitude === undefined ||
            sessionLatitude === null ||
            sessionLongitude === undefined ||
            sessionLongitude === null
        ) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "TEACHER_LOCATION_MISSING",
                reasonMessage: "Teacher GPS location missing from attendance session.",
                latitude,
                longitude,
                accuracy,
                browserFingerprint,
                passkeyCredentialId: tokenCheck.payload.cid
            });

            return res.status(400).json({
                success: false,
                message: "Attendance location is missing. Teacher must start attendance with location enabled."
            });
        }

        const distance = getDistanceInMeters(
            Number(latitude),
            Number(longitude),
            Number(sessionLatitude),
            Number(sessionLongitude)
        );

        const radiusCheck = evaluateRadiusCheck(
            distance,
            sessionRadius,
            studentGpsAccuracy,
            teacherGpsAccuracy
        );
        const verifiedDistanceFromClassroom = Math.max(0, radiusCheck.minimumPossibleDistance);
        const roundedMeasuredDistance = Math.round(radiusCheck.measuredDistance);
        const roundedVerifiedDistance = Math.round(verifiedDistanceFromClassroom);

        if (radiusCheck.isOutside) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "REJECTED",
                reasonCode: "OUTSIDE_RADIUS",
                reasonMessage:
                    "Outside allowed range after GPS uncertainty check. " +
                    "Measured " +
                    roundedMeasuredDistance +
                    "m, allowed " +
                    Math.round(radiusCheck.allowedRadius) +
                    "m, uncertainty " +
                    Math.round(radiusCheck.uncertaintyAllowance) +
                    "m, min possible distance " +
                    Math.round(radiusCheck.minimumPossibleDistance) +
                    "m.",
                latitude,
                longitude,
                teacherLatitude: sessionLatitude,
                teacherLongitude: sessionLongitude,
                distance: radiusCheck.measuredDistance,
                allowedRadius: radiusCheck.allowedRadius,
                accuracy: studentGpsAccuracy,
                browserFingerprint,
                passkeyCredentialId: tokenCheck.payload.cid
            });

            return res.status(403).json({
                success: false,
                message:
                    "You appear outside the allowed range. " +
                    "Measured: " +
                    roundedMeasuredDistance +
                    "m, Allowed: " +
                    Math.round(radiusCheck.allowedRadius) +
                    "m.",
                distance: roundedMeasuredDistance,
                allowedRadius: Math.round(radiusCheck.allowedRadius),
                minimumPossibleDistance: Math.round(radiusCheck.minimumPossibleDistance),
                uncertaintyAllowance: Math.round(radiusCheck.uncertaintyAllowance),
                studentAccuracy: Math.round(studentGpsAccuracy),
                teacherAccuracy: Math.round(teacherGpsAccuracy)
            });
        }


        const isTrustedDeviceToken =
            tokenCheck.payload &&
            tokenCheck.payload.cid &&
            tokenCheck.payload.cid.startsWith("TRUSTED_DEVICE:");

        const verificationMethod = isTrustedDeviceToken
            ? "TRUSTED_DEVICE_GEOLOCATION"
            : "PASSKEY_GEOLOCATION";

        const attendanceRecord = await AttendanceRecord.create({
            student: student._id,
            attendanceSession: session._id,
            subject: getId(session.subject),
            college: getId(session.college),
            classGroup: getId(session.classGroup),
            classroom: getId(session.classroom),
            status: "PRESENT",
            latitude: Number(latitude),
            longitude: Number(longitude),
            distanceFromClassroom: roundedVerifiedDistance,
            verificationMethod: verificationMethod,
            deviceInfo: {
                userAgent: req.headers["user-agent"],
                ip: requestIp,
                browserFingerprint: browserFingerprint,
                gpsAccuracy: studentGpsAccuracy,
                teacherGpsAccuracy: teacherGpsAccuracy,
                measuredDistanceFromClassroom: roundedMeasuredDistance,
                verifiedDistanceFromClassroom: roundedVerifiedDistance,
                allowedRadius: Math.round(radiusCheck.allowedRadius),
                radiusUncertaintyAllowance: Math.round(radiusCheck.uncertaintyAllowance),
                minimumPossibleDistance: Math.round(radiusCheck.minimumPossibleDistance),
                passkeyCredentialId: tokenCheck.payload.cid
            }
        });

        if (!session.attendanceRecords) {
            session.attendanceRecords = [];
        }

        if (!session.presentStudents) {
            session.presentStudents = [];
        }

        if (!session.absentStudents) {
            session.absentStudents = [];
        }

        session.attendanceRecords.push(attendanceRecord._id);

        session.presentStudents.push({
            student: student._id,
            fullName: student.fullName,
            enrollmentNumber: student.enrollmentNumber,
            status: "PRESENT",
            attendanceRecord: attendanceRecord._id,
            markedAt: new Date(),
            verificationMethod: verificationMethod,
            distanceFromClassroom: roundedVerifiedDistance
        });

        session.attendanceSummary = {
            totalPresent: session.presentStudents.length,
            totalAbsent: session.absentStudents.length,
            totalMarked: session.presentStudents.length + session.absentStudents.length
        };

        await session.save();

        await saveAttendanceAttempt({
            req,
            student,
            session,
            result: "SUCCESS",
            reasonCode: "ATTENDANCE_MARKED",
            reasonMessage:
                "Attendance marked successfully with passkey and geolocation. " +
                "Measured " +
                roundedMeasuredDistance +
                "m, allowed " +
                Math.round(radiusCheck.allowedRadius) +
                "m, uncertainty " +
                Math.round(radiusCheck.uncertaintyAllowance) +
                "m.",
            latitude,
            longitude,
            teacherLatitude: sessionLatitude,
            teacherLongitude: sessionLongitude,
            distance: radiusCheck.measuredDistance,
            allowedRadius: radiusCheck.allowedRadius,
            accuracy: studentGpsAccuracy,
            browserFingerprint,
            passkeyCredentialId: tokenCheck.payload.cid
        });

        socketManager.emitAttendanceMarked(session, student, attendanceRecord, verifiedDistanceFromClassroom);

        res.json({
            success: true,
            message: "Attendance marked successfully.",
            status: "PRESENT",
            distance: roundedVerifiedDistance,
            measuredDistance: roundedMeasuredDistance,
            allowedRadius: Math.round(radiusCheck.allowedRadius),
            minimumPossibleDistance: Math.round(radiusCheck.minimumPossibleDistance),
            uncertaintyAllowance: Math.round(radiusCheck.uncertaintyAllowance),
            accuracy: Math.round(studentGpsAccuracy)
        });
    } catch (err) {
        if (err.code === 11000) {
            if (student && session) {
                await saveAttendanceAttempt({
                    req,
                    student,
                    session,
                    result: "REJECTED",
                    reasonCode: "DUPLICATE_ATTENDANCE",
                    reasonMessage: "Duplicate attendance rejected by database unique index.",
                    latitude: req.body.latitude,
                    longitude: req.body.longitude,
                    accuracy: req.body.accuracy,
                    browserFingerprint: req.body.browserFingerprint || ""
                });
            }

            return res.status(400).json({
                success: false,
                message: "Attendance already marked."
            });
        }

        console.log("MARK ATTENDANCE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        if (student && session) {
            await saveAttendanceAttempt({
                req,
                student,
                session,
                result: "ERROR",
                reasonCode: "SERVER_ERROR",
                reasonMessage: err.message,
                latitude: req.body.latitude,
                longitude: req.body.longitude,
                accuracy: req.body.accuracy,
                browserFingerprint: req.body.browserFingerprint || ""
            });
        }

        res.status(500).json({
            success: false,
            message: "Mark attendance error: " + err.message
        });
    }
});

router.get("/attendance-history", isStudent, async function (req, res) {
    try {
        const studentId = getStudentIdFromRequest(req);

        const student = await Student.findById(studentId)
            .populate("classGroup")
            .populate("subjects");

        if (!student) {
            return res.redirect("/student/login");
        }

        if (!student.college) {
            return res.send("Student college missing. Please contact admin.");
        }

        if (!student.classGroup) {
            return res.send("Student class group missing. Please contact admin.");
        }

        const filters = {
            fromDate: req.query.fromDate || studentGetMonthStartInputValue(),
            toDate: req.query.toDate || studentGetDateInputValue(new Date()),
            subjectId: req.query.subjectId || "all",
            status: req.query.status || "all"
        };

        const fromDate = studentGetStartOfDate(filters.fromDate);
        const toDate = studentGetEndOfDate(filters.toDate);

        const subjectId = studentSafeObjectId(filters.subjectId);

        const sessionQuery = {
            college: student.college,
            classGroup: student.classGroup._id,
            startTime: {
                $gte: fromDate,
                $lte: toDate
            }
        };

        if (subjectId) {
            sessionQuery.subject = subjectId;
        }

        const sessions = await AttendanceSession.find(sessionQuery)
            .populate("schedule")
            .populate("subject")
            .populate("teacher")
            .populate("classGroup")
            .populate("classroom")
            .sort({
                startTime: -1
            });

        const sessionIds = sessions.map(function (session) {
            return session._id;
        });

        const recordQuery = {
            student: student._id,
            college: student.college,
            attendanceSession: {
                $in: sessionIds
            }
        };

        if (subjectId) {
            recordQuery.subject = subjectId;
        }

        if (filters.status !== "all") {
            recordQuery.status = filters.status;
        }

        const attendanceRecords = await AttendanceRecord.find(recordQuery)
            .populate("subject")
            .populate("classGroup")
            .populate("classroom")
            .populate({
                path: "attendanceSession",
                populate: [
                    { path: "teacher" },
                    { path: "schedule" },
                    { path: "subject" },
                    { path: "classGroup" },
                    { path: "classroom" }
                ]
            })
            .sort({
                createdAt: -1
            })
            .limit(1000);

        let totalPresent = 0;
        let totalAbsent = 0;

        const subjectSummaryMap = {};

        attendanceRecords.forEach(function (record) {
            if (record.status === "PRESENT") {
                totalPresent++;
            }

            if (record.status === "ABSENT") {
                totalAbsent++;
            }

            const subjectKey = record.subject
                ? record.subject._id.toString()
                : "missing-subject";

            if (!subjectSummaryMap[subjectKey]) {
                subjectSummaryMap[subjectKey] = {
                    name: record.subject ? record.subject.subjectName : "Subject Missing",
                    code: record.subject && record.subject.subjectCode ? record.subject.subjectCode : "",
                    total: 0,
                    present: 0,
                    absent: 0
                };
            }

            subjectSummaryMap[subjectKey].total++;

            if (record.status === "PRESENT") {
                subjectSummaryMap[subjectKey].present++;
            }

            if (record.status === "ABSENT") {
                subjectSummaryMap[subjectKey].absent++;
            }
        });

        const subjectSummary = Object.values(subjectSummaryMap).map(function (item) {
            item.percentage = studentGetPercent(item.present, item.total);
            return item;
        });

        const subjectWiseAttendanceMap = {};

        attendanceRecords.forEach(function (record) {
            const subjectKey = record.subject
                ? record.subject._id.toString()
                : "missing-subject";

            if (!subjectWiseAttendanceMap[subjectKey]) {
                subjectWiseAttendanceMap[subjectKey] = {
                    subjectId: subjectKey,
                    subjectName: record.subject
                        ? record.subject.subjectName
                        : "Subject Missing",
                    subjectCode: record.subject && record.subject.subjectCode
                        ? record.subject.subjectCode
                        : "",
                    total: 0,
                    present: 0,
                    absent: 0,
                    percentage: 0,
                    records: []
                };
            }

            subjectWiseAttendanceMap[subjectKey].records.push(record);
            subjectWiseAttendanceMap[subjectKey].total++;

            if (record.status === "PRESENT") {
                subjectWiseAttendanceMap[subjectKey].present++;
            }

            if (record.status === "ABSENT") {
                subjectWiseAttendanceMap[subjectKey].absent++;
            }
        });

        const subjectWiseAttendance = Object.values(subjectWiseAttendanceMap)
            .map(function (subjectGroup) {
                subjectGroup.percentage = studentGetPercent(
                    subjectGroup.present,
                    subjectGroup.total
                );

                subjectGroup.records.sort(function (firstRecord, secondRecord) {
                    const firstSession = firstRecord.attendanceSession;
                    const secondSession = secondRecord.attendanceSession;

                    const firstDate = firstSession && firstSession.startTime
                        ? new Date(firstSession.startTime).getTime()
                        : new Date(firstRecord.createdAt).getTime();
                    const secondDate = secondSession && secondSession.startTime
                        ? new Date(secondSession.startTime).getTime()
                        : new Date(secondRecord.createdAt).getTime();

                    return secondDate - firstDate;
                });

                return subjectGroup;
            })
            .sort(function (firstGroup, secondGroup) {
                if (secondGroup.total !== firstGroup.total) {
                    return secondGroup.total - firstGroup.total;
                }

                return firstGroup.subjectName.localeCompare(secondGroup.subjectName);
            });

        const attemptQuery = {
            student: student._id,
            college: student.college,
            result: {
                $ne: "SUCCESS"
            },
            createdAt: {
                $gte: fromDate,
                $lte: toDate
            }
        };

        if (subjectId) {
            attemptQuery.subject = subjectId;
        }

        const suspiciousAttempts = await AttendanceAttempt.find(attemptQuery)
            .populate("subject")
            .populate("teacher")
            .populate("classGroup")
            .populate("classroom")
            .sort({
                createdAt: -1
            })
            .limit(50);

        const summary = {
            totalSessions: sessions.length,
            totalRecords: attendanceRecords.length,
            totalPresent: totalPresent,
            totalAbsent: totalAbsent,
            attendancePercentage: studentGetPercent(totalPresent, attendanceRecords.length),
            suspiciousCount: suspiciousAttempts.length
        };

        res.render("studentAttendanceHistory", {
            student: student,
            activePage: "attendance-history",
            filters: filters,
            subjects: student.subjects || [],
            sessions: sessions,
            attendanceRecords: attendanceRecords,
            subjectWiseAttendance: subjectWiseAttendance,
            suspiciousAttempts: suspiciousAttempts,
            subjectSummary: subjectSummary,
            summary: summary
        });

    } catch (err) {
        console.log("STUDENT ATTENDANCE HISTORY ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).send("Student attendance history error: " + err.message);
    }
});

router.get("/passkeys", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req))
            .populate("classGroup");

        if (!student) {
            return res.redirect("/student/login");
        }

        const pendingPasskeyRequest = await PasskeySetupRequest.findOne({
            college: student.college,
            student: student._id,
            status: "PENDING"
        }).sort({ createdAt: -1 });

        res.render("studentPasskeys", {
            student: student,
            activePage: "passkeys",
            passkeys: student.passkeys || [],
            trustedDevices: (student.trustedDevices || []).filter(function (device) {
                return device && device.isActive;
            }),
            currentTrustedDeviceId: getTrustedDeviceCookieDeviceId(req),
            isPasskeySetupOpen: isPasskeySetupAllowed(student),
            isTrustedDeviceSetupOpen: isTrustedDeviceSetupAllowed(student),
            pendingPasskeyRequest: pendingPasskeyRequest || null,
            message: req.query.message || null
        });

    } catch (err) {
        console.log("STUDENT PASSKEYS PAGE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).send("Student passkeys page error: " + err.message);
    }
});

router.post("/passkeys/:credentialId/delete", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student) {
            return res.redirect("/student/login");
        }

        const credentialId = req.params.credentialId;

        if (!credentialId) {
            return res.redirect("/student/passkeys?message=invalid");
        }

        student.passkeys = (student.passkeys || []).filter(function (passkey) {
            return passkey.credentialId !== credentialId;
        });

        await student.save();

        res.redirect("/student/passkeys?message=deleted");

    } catch (err) {
        console.log("DELETE STUDENT PASSKEY ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/passkeys?message=error");
    }
});

router.post("/trusted-devices/:deviceId/delete", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req));

        if (!student) {
            return res.redirect("/student/login");
        }

        const deviceId = req.params.deviceId;

        if (!deviceId) {
            return res.redirect("/student/passkeys?message=invalid");
        }

        const currentTrustedDeviceId = getTrustedDeviceCookieDeviceId(req);

        student.trustedDevices = (student.trustedDevices || []).filter(function (device) {
            return device.deviceId !== deviceId;
        });

        await student.save();

        if (currentTrustedDeviceId === deviceId) {
            clearTrustedDeviceCookie(res);
        }

        res.redirect("/student/passkeys?message=device_deleted");

    } catch (err) {
        console.log("DELETE TRUSTED DEVICE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/passkeys?message=error");
    }
});

router.post("/passkeys/request-setup", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req))
            .populate("classGroup");

        if (!student) {
            return res.redirect("/student/login");
        }

        if (isPasskeySetupAllowed(student)) {
            return res.redirect("/student/passkeys?message=setup_already_open");
        }

        const existingPending = await PasskeySetupRequest.findOne({
            college: student.college,
            student: student._id,
            status: "PENDING"
        });

        if (existingPending) {
            return res.redirect("/student/passkeys?message=request_pending");
        }

        const request = await PasskeySetupRequest.create({
            student: student._id,
            college: student.college,
            requestedBy: student._id,
            status: "PENDING"
        });

        const studentName = student.fullName || "Student";
        const enrollmentNumber = student.enrollmentNumber || "Unknown";

        const adminNotification = await createNotification({
            college: student.college,
            recipientRole: "ADMIN",
            title: "Passkey setup request",
            message:
                studentName +
                " (" +
                enrollmentNumber +
                ") requested passkey setup approval.",
            category: "PASSKEY_REQUEST",
            level: "warning",
            link: "/admin/notifications",
            metadata: {
                requestId: request._id.toString(),
                studentId: student._id.toString(),
                classGroup: student.classGroup && student.classGroup.name
                    ? student.classGroup.name
                    : ""
            },
            createdByType: "student",
            createdById: student._id
        });

        socketManager.emitNotification(adminNotification);

        const adminUnreadCount = await getUnreadCount({
            recipientRole: "ADMIN",
            college: student.college
        });

        socketManager.emitNotificationUnreadCount({
            recipientRole: "ADMIN",
            collegeId: student.college,
            unreadCount: adminUnreadCount
        });

        const studentNotification = await createNotification({
            college: student.college,
            recipientRole: "STUDENT",
            recipientUserId: student._id,
            title: "Passkey request sent",
            message: "Your passkey setup request was sent to your college admin.",
            category: "PASSKEY_REQUEST",
            level: "info",
            link: "/student/passkeys",
            metadata: {
                requestId: request._id.toString()
            },
            createdByType: "student",
            createdById: student._id
        });

        socketManager.emitNotification(studentNotification);

        const studentUnreadCount = await getUnreadCount(getStudentNotificationFilter(student));

        socketManager.emitNotificationUnreadCount({
            recipientRole: "STUDENT",
            recipientUserId: student._id,
            unreadCount: studentUnreadCount
        });

        res.redirect("/student/passkeys?message=request_sent");

    } catch (err) {
        console.log("STUDENT PASSKEY SETUP REQUEST ERROR:");
        console.log(err.message);
        console.log(err.stack);

        if (err && err.code === 11000) {
            return res.redirect("/student/passkeys?message=request_pending");
        }

        res.redirect("/student/passkeys?message=request_error");
    }
});

router.get("/notifications", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req))
            .populate("classGroup");

        if (!student) {
            return res.redirect("/student/login");
        }

        const filter = getStudentNotificationFilter(student);
        const notifications = await getRecentNotifications(filter, 100);
        const unreadCount = await getUnreadCount(filter);

        res.render("studentNotifications", {
            student: student,
            activePage: "notifications",
            notifications: notifications,
            unreadCount: unreadCount
        });
    } catch (err) {
        console.log("STUDENT NOTIFICATIONS PAGE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).send("Student notifications error: " + err.message);
    }
});

router.post("/notifications/mark-all-read", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req)).select("_id");

        if (!student) {
            return res.redirect("/student/login");
        }

        await markAllRead(getStudentNotificationFilter(student));

        const unreadCount = await getUnreadCount(getStudentNotificationFilter(student));

        socketManager.emitNotificationUnreadCount({
            recipientRole: "STUDENT",
            recipientUserId: student._id,
            unreadCount: unreadCount
        });

        res.redirect("/student/notifications");
    } catch (err) {
        console.log("STUDENT MARK ALL NOTIFICATIONS READ ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/notifications");
    }
});

router.post("/notifications/clear-all", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req)).select("_id");

        if (!student) {
            return res.redirect("/student/login");
        }

        await clearAllNotifications(getStudentNotificationFilter(student));

        socketManager.emitNotificationUnreadCount({
            recipientRole: "STUDENT",
            recipientUserId: student._id,
            unreadCount: 0
        });

        res.redirect("/student/notifications");
    } catch (err) {
        console.log("STUDENT CLEAR ALL NOTIFICATIONS ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/notifications");
    }
});

router.post("/notifications/:id/read", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req)).select("_id");

        if (!student) {
            return res.redirect("/student/login");
        }

        await markNotificationRead(req.params.id, getStudentNotificationFilter(student));

        const unreadCount = await getUnreadCount(getStudentNotificationFilter(student));

        socketManager.emitNotificationUnreadCount({
            recipientRole: "STUDENT",
            recipientUserId: student._id,
            unreadCount: unreadCount
        });

        const redirectTo = req.body.redirectTo === "schedule"
            ? "/student/schedule"
            : "/student/notifications";

        res.redirect(redirectTo);
    } catch (err) {
        console.log("STUDENT MARK NOTIFICATION READ ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/notifications");
    }
});

router.post("/notifications/:id/delete", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req)).select("_id");

        if (!student) {
            return res.redirect("/student/login");
        }

        await deleteNotification(req.params.id, getStudentNotificationFilter(student));

        const unreadCount = await getUnreadCount(getStudentNotificationFilter(student));

        socketManager.emitNotificationUnreadCount({
            recipientRole: "STUDENT",
            recipientUserId: student._id,
            unreadCount: unreadCount
        });

        res.redirect("/student/notifications");
    } catch (err) {
        console.log("STUDENT DELETE NOTIFICATION ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/notifications");
    }
});

router.get("/notifications/unread-count", isStudent, async function (req, res) {
    try {
        const student = await Student.findById(getStudentIdFromRequest(req)).select("_id");

        if (!student) {
            return res.status(401).json({
                success: false,
                message: "Student not found."
            });
        }

        const unreadCount = await getUnreadCount(getStudentNotificationFilter(student));

        res.json({
            success: true,
            unreadCount: unreadCount
        });
    } catch (err) {
        console.log("STUDENT UNREAD NOTIFICATION COUNT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).json({
            success: false,
            message: "Unable to load unread notification count."
        });
    }
});

router.get("/attendance-history/export", isStudent, async function (req, res) {
    try {
        const studentId = getStudentIdFromRequest(req);

        const student = await Student.findById(studentId)
            .populate("classGroup")
            .populate("subjects");

        if (!student) {
            return res.redirect("/student/login");
        }

        if (!student.college || !student.classGroup) {
            return res.redirect("/student/attendance-history");
        }

        const filters = {
            fromDate: req.query.fromDate || studentGetMonthStartInputValue(),
            toDate: req.query.toDate || studentGetDateInputValue(new Date()),
            subjectId: req.query.subjectId || "all",
            status: req.query.status || "all"
        };

        const fromDate = studentGetStartOfDate(filters.fromDate);
        const toDate = studentGetEndOfDate(filters.toDate);

        const subjectId = studentSafeObjectId(filters.subjectId);

        const sessionQuery = {
            college: student.college,
            classGroup: student.classGroup._id,
            startTime: {
                $gte: fromDate,
                $lte: toDate
            }
        };

        if (subjectId) {
            sessionQuery.subject = subjectId;
        }

        const sessions = await AttendanceSession.find(sessionQuery)
            .populate("subject")
            .populate("teacher")
            .populate("classGroup")
            .populate("classroom")
            .sort({
                startTime: -1
            });

        const sessionIds = sessions.map(function (session) {
            return session._id;
        });

        const recordQuery = {
            student: student._id,
            college: student.college,
            attendanceSession: {
                $in: sessionIds
            }
        };

        if (subjectId) {
            recordQuery.subject = subjectId;
        }

        if (filters.status !== "all") {
            recordQuery.status = filters.status;
        }

        const attendanceRecords = await AttendanceRecord.find(recordQuery)
            .populate("subject")
            .populate("classGroup")
            .populate("classroom")
            .populate({
                path: "attendanceSession",
                populate: [
                    { path: "teacher" },
                    { path: "schedule" },
                    { path: "subject" },
                    { path: "classGroup" },
                    { path: "classroom" }
                ]
            })
            .sort({
                createdAt: -1
            });

        const rows = [];

        rows.push([
            "Date",
            "Time",
            "Student Name",
            "Enrollment Number",
            "Class Group",
            "Subject",
            "Subject Code",
            "Teacher",
            "Classroom",
            "Status",
            "Verification Method",
            "Distance From Teacher/Classroom (m)",
            "GPS Accuracy (m)",
            "Marked At"
        ]);

        attendanceRecords.forEach(function (record) {
            const session = record.attendanceSession;
            const sessionDate = session && session.startTime ? session.startTime : record.createdAt;
            const teacher = session && session.teacher ? session.teacher : null;

            rows.push([
                sessionDate ? new Date(sessionDate).toLocaleDateString() : "",
                sessionDate ? new Date(sessionDate).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                }) : "",

                student.fullName || "",
                student.enrollmentNumber || "",

                record.classGroup ? record.classGroup.name : "",
                record.subject ? record.subject.subjectName : "",
                record.subject && record.subject.subjectCode ? record.subject.subjectCode : "",

                teacher ? teacher.fullName : "",

                record.classroom ? record.classroom.classroomName : "",

                record.status || "",
                record.verificationMethod || "",

                record.distanceFromClassroom !== undefined && record.distanceFromClassroom !== null
                    ? Math.round(record.distanceFromClassroom)
                    : "",

                record.deviceInfo && record.deviceInfo.gpsAccuracy
                    ? Math.round(record.deviceInfo.gpsAccuracy)
                    : "",

                record.createdAt ? new Date(record.createdAt).toLocaleString() : ""
            ]);
        });

        const filename =
            "student-attendance-history-" +
            filters.fromDate +
            "-to-" +
            filters.toDate +
            ".csv";

        studentSendCsvResponse(res, filename, rows);

    } catch (err) {
        console.log("STUDENT EXPORT ATTENDANCE HISTORY ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/student/attendance-history");
    }
});

module.exports = router;
