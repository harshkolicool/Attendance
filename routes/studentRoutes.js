const express = require("express");
const router = express.Router();
const Student = require("../models/studentSchema");
const AttendanceSession = require("../models/attendanceSessionSchema");
const AttendanceRecord = require("../models/attendanceRecordSchema");
const Schedule = require("../models/scheduleSchema");
const { sortSchedulesByTime } = require("../utils/scheduleTime");
const getDistanceInMeters = require("../utils/geoDistance");

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

function sameId(a, b) {
    if (!a || !b) {
        return false;
    }

    const first = a._id ? a._id.toString() : a.toString();
    const second = b._id ? b._id.toString() : b.toString();

    return first === second;
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

async function getStudentPageData(req) {
    const student = await Student.findById(req.user._id)
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
        attendancePercentage: attendancePercentage
    };
}

router.get("/dashboard", isStudent, async (req, res) => {
    try {
        if (!req.user || !req.user._id) {
            return res.send("User session invalid. Please login again.");
        }

        const data = await getStudentPageData(req);

        if (data.error) {
            return res.send(data.error);
        }

        res.render("studentDashboard", data);

    } catch (err) {
        console.log("STUDENT DASHBOARD ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Student dashboard error: " + err.message);
    }
});

router.get("/schedule", isStudent, async (req, res) => {
    try {
        if (!req.user || !req.user._id) {
            return res.redirect("/student/login");
        }

        const data = await getStudentPageData(req);

        if (data.error) {
            return res.send(data.error);
        }

        res.render("studentSchedule", data);

    } catch (err) {
        console.log("STUDENT SCHEDULE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Student schedule error: " + err.message);
    }
});

router.post("/attendance/mark", isStudent, async (req, res) => {
    try {
        function getId(value) {
            if (!value) {
                return null;
            }

            if (value._id) {
                return value._id.toString();
            }

            return value.toString();
        }

        const sessionId = req.body.sessionId;
        const latitude = req.body.latitude;
        const longitude = req.body.longitude;

        if (
            !sessionId ||
            latitude === undefined ||
            latitude === null ||
            latitude === "" ||
            longitude === undefined ||
            longitude === null ||
            longitude === ""
        ) {
            return res.status(400).json({
                success: false,
                message: "Location is required"
            });
        }

        if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
            return res.status(400).json({
                success: false,
                message: "Invalid location coordinates"
            });
        }

        const student = await Student.findById(req.user._id || req.user.id);

        if (!student) {
            return res.status(401).json({
                success: false,
                message: "Student not found"
            });
        }

        if (student.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Your student account is blocked"
            });
        }

        const session = await AttendanceSession.findById(sessionId)
            .populate("schedule")
            .populate("classroom")
            .populate("subject")
            .populate("classGroup");

        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Attendance session not found"
            });
        }

        if (!session.isActive || session.status !== "ACTIVE") {
            return res.status(400).json({
                success: false,
                message: "Attendance session is closed"
            });
        }

        if (session.endTime < new Date()) {
            session.isActive = false;
            session.status = "EXPIRED";
            await session.save();

            return res.status(400).json({
                success: false,
                message: "Attendance session expired"
            });
        }

        if (getId(session.college) !== getId(student.college)) {
            return res.status(403).json({
                success: false,
                message: "Invalid college"
            });
        }

        if (getId(session.classGroup) !== getId(student.classGroup)) {
            return res.status(403).json({
                success: false,
                message: "This attendance is not for your class"
            });
        }

        const alreadyMarked = await AttendanceRecord.findOne({
            student: student._id,
            attendanceSession: session._id
        });

        if (alreadyMarked) {
            return res.status(400).json({
                success: false,
                message: "Attendance already marked"
            });
        }

        /*
            Important:
            Attendance center is teacher's live GPS location.
            Do not use classroom.latitude / classroom.longitude here.
        */
        const sessionLatitude = session.latitude;
        const sessionLongitude = session.longitude;
        const sessionRadius = session.radius || 100;

        if (
            sessionLatitude === undefined ||
            sessionLatitude === null ||
            sessionLongitude === undefined ||
            sessionLongitude === null
        ) {
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

        if (distance > sessionRadius) {
            return res.status(403).json({
                success: false,
                message: "You are outside the allowed classroom range",
                distance: Math.round(distance),
                allowedRadius: sessionRadius
            });
        }

        const attendanceRecord = await AttendanceRecord.create({
            student: student._id,
            attendanceSession: session._id,
            subject: session.subject._id ? session.subject._id : session.subject,
            college: session.college,
            classGroup: session.classGroup._id ? session.classGroup._id : session.classGroup,
            classroom: session.classroom._id ? session.classroom._id : session.classroom,
            status: "PRESENT",
            latitude: Number(latitude),
            longitude: Number(longitude),
            distanceFromClassroom: Math.round(distance),
            verificationMethod: "GEOLOCATION",
            deviceInfo: {
                userAgent: req.headers["user-agent"],
                ip: req.ip
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
            verificationMethod: "GEOLOCATION",
            distanceFromClassroom: Math.round(distance)
        });

        session.attendanceSummary = {
            totalPresent: session.presentStudents.length,
            totalAbsent: session.absentStudents.length,
            totalMarked: session.presentStudents.length + session.absentStudents.length
        };

        await session.save();

        res.json({
            success: true,
            message: "Attendance marked successfully",
            status: "PRESENT",
            distance: Math.round(distance),
            allowedRadius: sessionRadius
        });

    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Attendance already marked"
            });
        }

        console.log("MARK ATTENDANCE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).json({
            success: false,
            message: "Mark attendance error: " + err.message
        });
    }
});

router.get("/attendance-history", isStudent, async (req, res) => {
    try {
        if (!req.user || !req.user._id) {
            return res.redirect("/student/login");
        }

        const data = await getStudentPageData(req);
        if (data.error) return res.send(data.error);

        const { student } = data;

        // Get all sessions for this student's class group across ALL time for history stats
        const allSessions = await AttendanceSession.find({
            college: student.college._id,
            classGroup: student.classGroup._id,
            status: { $in: ["CLOSED", "EXPIRED", "ACTIVE"] }
        }).populate("subject");

        const allSessionIds = allSessions.map(s => s._id);

        const allRecords = await AttendanceRecord.find({
            student: student._id,
            attendanceSession: { $in: allSessionIds }
        });

        // Overall stats
        const totalSessions = allSessions.length;
        const totalPresent = allRecords.filter(r => r.status === "PRESENT" || r.status === "LATE").length;
        const totalAbsent = totalSessions - totalPresent;
        const overallPercentage = totalSessions > 0 ? ((totalPresent / totalSessions) * 100).toFixed(1) : 0;

        // Subject-wise breakdown
        const subjectStats = {};
        student.subjects.forEach(sub => {
            subjectStats[sub._id.toString()] = {
                name: sub.subjectName,
                code: sub.subjectCode,
                total: 0,
                present: 0,
                absent: 0,
                percentage: 0
            };
        });

        allSessions.forEach(session => {
            const subId = session.subject._id.toString();
            if (subjectStats[subId]) subjectStats[subId].total++;
        });

        allRecords.forEach(record => {
            const subId = record.subject.toString();
            if (subjectStats[subId] && (record.status === "PRESENT" || record.status === "LATE")) {
                subjectStats[subId].present++;
            }
        });

        Object.keys(subjectStats).forEach(subId => {
            const stats = subjectStats[subId];
            stats.absent = stats.total - stats.present;
            stats.percentage = stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : 0;
        });

        // Timeline (using sessions from data.todaySessions instead of allSessions)
        const timeline = data.todaySessions.map(session => {
            const record = allRecords.find(r => r.attendanceSession.toString() === session._id.toString());
            let status = "ABSENT";
            if (record) status = record.status;
            else if (session.status === "ACTIVE") status = "LIVE";

            return {
                _id: session._id,
                subject: session.subject,
                startTime: session.startTime,
                endTime: session.endTime,
                status: status,
                isToday: true
            };
        }).sort((a, b) => a.startTime.localeCompare(b.startTime));

        res.render("studentAttendanceHistory", {
            ...data,
            stats: {
                totalSessions,
                totalPresent,
                totalAbsent,
                overallPercentage
            },
            subjectStats: Object.values(subjectStats),
            timeline: timeline
        });

    } catch (err) {
        console.log("ATTENDANCE HISTORY ERROR:", err.message);
        res.send("Attendance history error: " + err.message);
    }
});

module.exports = router;