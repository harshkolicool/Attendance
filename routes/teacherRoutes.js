const express = require("express");
const router = express.Router();

const Schedule = require("../models/scheduleSchema");
const Teacher = require("../models/teacherSchema");
const Student = require("../models/studentSchema");
const Classroom = require("../models/classroomSchema");
const ClassGroup = require("../models/classGroupSchema");
const AttendanceSession = require("../models/attendanceSessionSchema");
const AttendanceRecord = require("../models/attendanceRecordSchema");

const {
    getScheduleTimeStatus,
    getTodayRange,
    sortSchedulesByTime
} = require("../utils/scheduleTime");

function isTeacher(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.redirect("/teacher/login");
    }

    if (req.user.accountType !== "teacher") {
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

function getErrorMessage(errorCode) {
    if (errorCode === "location") {
        return "Teacher location is required to start attendance. Please allow location access.";
    }

    if (errorCode === "outside_window") {
        return "You can only start attendance during the scheduled class time.";
    }

    if (errorCode === "class_not_ended") {
        return "Manual attendance is only available after the class time has ended.";
    }

    if (errorCode === "session_exists") {
        return "Attendance was already started for this class today.";
    }

    if (errorCode === "manual_done") {
        return "Attendance was already recorded for this class today.";
    }

    if (errorCode === "schedule_missing") {
        return "Schedule not found. Please start attendance from a valid schedule card.";
    }

    return null;
}

function getSuccessMessage(messageCode) {
    if (messageCode === "live_started") {
        return "Attendance started successfully.";
    }

    if (messageCode === "manual_saved") {
        return "Manual attendance saved successfully.";
    }

    return null;
}

function sameId(a, b) {
    if (!a || !b) {
        return false;
    }

    const first = a._id ? a._id.toString() : a.toString();
    const second = b._id ? b._id.toString() : b.toString();

    return first === second;
}

function findSessionForSchedule(sessions, schedule) {
    for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];

        if (session.schedule && sameId(session.schedule, schedule._id)) {
            return session;
        }

        if (
            !session.schedule &&
            session.subject &&
            session.classGroup &&
            schedule.subject &&
            schedule.classGroup &&
            sameId(session.subject, schedule.subject) &&
            sameId(session.classGroup, schedule.classGroup)
        ) {
            return session;
        }
    }

    return null;
}

async function getScheduleForTeacher(req) {
    const scheduleId = req.body.scheduleId;

    if (!scheduleId) {
        return null;
    }

    const today = getTodayName();

    const scheduleItem = await Schedule.findOne({
        _id: scheduleId,
        teacher: req.user._id,
        college: req.user.college,
        day: today
    })
    .populate("subject")
    .populate("classGroup")
    .populate("classroom");

    return scheduleItem;
}

router.get("/dashboard", isTeacher, async (req, res) => {
    try {
        const today = getTodayName();
        const now = new Date();
        const todayRange = getTodayRange();

        const teacher = await Teacher.findById(req.user._id)
            .populate("subjects");

        if (!teacher) {
            return res.send("Teacher not found");
        }

        const schedules = await Schedule.find({
            teacher: req.user._id,
            college: req.user.college,
            day: today
        })
        .populate("subject")
        .populate("classGroup")
        .populate("classroom");

        sortSchedulesByTime(schedules);

        const classGroups = await ClassGroup.find({
            college: req.user.college,
            isActive: true
        });

        const classrooms = await Classroom.find({
            college: req.user.college
        });

        const activeSessions = await AttendanceSession.find({
            teacher: req.user._id,
            college: req.user.college,
            isActive: true,
            status: "ACTIVE",
            endTime: { $gt: now }
        })
        .populate("schedule")
        .populate("subject")
        .populate("classGroup")
        .populate("classroom");

        const todaysSessions = await AttendanceSession.find({
            teacher: req.user._id,
            college: req.user.college,
            startTime: {
                $gte: todayRange.start,
                $lte: todayRange.end
            }
        })
        .populate("schedule")
        .populate("subject")
        .populate("classGroup")
        .populate("classroom");

        const classGroupIds = [];

        for (let i = 0; i < schedules.length; i++) {
            if (schedules[i].classGroup) {
                classGroupIds.push(schedules[i].classGroup._id);
            }
        }

        const students = await Student.find({
            college: req.user.college,
            classGroup: { $in: classGroupIds }
        }).sort({ fullName: 1 });

        const studentsByClassGroup = {};

        for (let i = 0; i < students.length; i++) {
            const groupId = students[i].classGroup.toString();

            if (!studentsByClassGroup[groupId]) {
                studentsByClassGroup[groupId] = [];
            }

            studentsByClassGroup[groupId].push(students[i]);
        }

        const scheduleCards = [];
        const manualAttendanceList = [];

        for (let i = 0; i < schedules.length; i++) {
            const item = schedules[i];

            let timeStatus = "invalid";
            let todaySession = null;
            let liveSession = null;

            if (item.subject && item.classGroup && item.classroom) {
                timeStatus = getScheduleTimeStatus(
                    item.startTime,
                    item.endTime,
                    now
                );

                todaySession = findSessionForSchedule(todaysSessions, item);
                liveSession = findSessionForSchedule(activeSessions, item);
            }

            const card = {
                schedule: item,
                timeStatus: timeStatus,
                todaySession: todaySession,
                liveSession: liveSession,
                canStart: false,
                showManual: false
            };

            if (
                timeStatus === "live" &&
                !todaySession &&
                item.subject &&
                item.classGroup &&
                item.classroom
            ) {
                card.canStart = true;
            }

            if (
                timeStatus === "ended" &&
                !todaySession &&
                item.subject &&
                item.classGroup &&
                item.classroom
            ) {
                card.showManual = true;

                const groupId = item.classGroup._id.toString();
                const classStudents = studentsByClassGroup[groupId] || [];

                manualAttendanceList.push({
                    schedule: item,
                    students: classStudents
                });
            }

            scheduleCards.push(card);
        }

        res.render("teacherDashboard", {
            teacher: teacher,
            subjects: teacher.subjects || [],
            classGroups: classGroups || [],
            classrooms: classrooms || [],
            activeSessions: activeSessions || [],
            schedules: schedules || [],
            scheduleCards: scheduleCards || [],
            manualAttendanceList: manualAttendanceList || [],
            today: today,
            message: getSuccessMessage(req.query.message),
            error: getErrorMessage(req.query.error)
        });

    } catch (err) {
        console.log("TEACHER DASHBOARD ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Teacher dashboard error: " + err.message);
    }
});

router.post("/attendance/start", isTeacher, async (req, res) => {
    try {
        const durationMinutes = Number(req.body.durationMinutes) || 5;
        const teacherLatitude = req.body.teacherLatitude;
        const teacherLongitude = req.body.teacherLongitude;

        const scheduleItem = await getScheduleForTeacher(req);

        if (
            !scheduleItem ||
            !scheduleItem.subject ||
            !scheduleItem.classGroup ||
            !scheduleItem.classroom
        ) {
            return res.redirect("/teacher/dashboard?error=schedule_missing");
        }

        if (
            teacherLatitude == null || teacherLatitude === "" ||
            teacherLongitude == null || teacherLongitude === ""
        ) {
            return res.redirect("/teacher/dashboard?error=location");
        }

        const timeStatus = getScheduleTimeStatus(
            scheduleItem.startTime,
            scheduleItem.endTime,
            new Date()
        );

        if (timeStatus !== "live") {
            return res.redirect("/teacher/dashboard?error=outside_window");
        }

        const todayRange = getTodayRange();

        const sessionToday = await AttendanceSession.findOne({
            schedule: scheduleItem._id,
            teacher: req.user._id,
            college: req.user.college,
            startTime: {
                $gte: todayRange.start,
                $lte: todayRange.end
            }
        });

        if (sessionToday) {
            return res.redirect("/teacher/dashboard?error=session_exists");
        }

        const alreadyActive = await AttendanceSession.findOne({
            schedule: scheduleItem._id,
            teacher: req.user._id,
            college: req.user.college,
            isActive: true,
            status: "ACTIVE",
            endTime: { $gt: new Date() }
        });

        if (alreadyActive) {
            return res.redirect("/teacher/dashboard?error=session_exists");
        }

        const startTime = new Date();
        const endTime = new Date(Date.now() + durationMinutes * 60 * 1000);

        await AttendanceSession.create({
            schedule: scheduleItem._id,
            teacher: req.user._id,
            subject: scheduleItem.subject._id,
            college: req.user.college,
            classGroup: scheduleItem.classGroup._id,
            classroom: scheduleItem.classroom._id,

            latitude: Number(teacherLatitude),
            longitude: Number(teacherLongitude),
            radius: scheduleItem.classroom.radius,

            startTime: startTime,
            endTime: endTime,
            status: "ACTIVE",
            isActive: true
        });

        res.redirect("/teacher/dashboard?message=live_started");

    } catch (err) {
        console.log("TEACHER START ATTENDANCE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Could not start attendance: " + err.message);
    }
});

router.post("/attendance/manual", isTeacher, async (req, res) => {
    try {
        let presentStudentIds = req.body.presentStudents || [];

        if (!Array.isArray(presentStudentIds)) {
            presentStudentIds = [presentStudentIds];
        }

        const scheduleItem = await getScheduleForTeacher(req);

        if (
            !scheduleItem ||
            !scheduleItem.subject ||
            !scheduleItem.classGroup ||
            !scheduleItem.classroom
        ) {
            return res.redirect("/teacher/dashboard?error=schedule_missing");
        }

        const timeStatus = getScheduleTimeStatus(
            scheduleItem.startTime,
            scheduleItem.endTime,
            new Date()
        );

        if (timeStatus !== "ended") {
            return res.redirect("/teacher/dashboard?error=class_not_ended");
        }

        const todayRange = getTodayRange();

        const sessionToday = await AttendanceSession.findOne({
            schedule: scheduleItem._id,
            teacher: req.user._id,
            college: req.user.college,
            startTime: {
                $gte: todayRange.start,
                $lte: todayRange.end
            }
        });

        if (sessionToday) {
            return res.redirect("/teacher/dashboard?error=manual_done");
        }

        const students = await Student.find({
            college: req.user.college,
            classGroup: scheduleItem.classGroup._id
        }).sort({ fullName: 1 });

        if (students.length === 0) {
            return res.send("No students found in this class group");
        }

        const presentIdStrings = [];

        for (let i = 0; i < presentStudentIds.length; i++) {
            presentIdStrings.push(presentStudentIds[i].toString());
        }

        const session = await AttendanceSession.create({
            schedule: scheduleItem._id,
            teacher: req.user._id,
            subject: scheduleItem.subject._id,
            college: req.user.college,
            classGroup: scheduleItem.classGroup._id,
            classroom: scheduleItem.classroom._id,
            latitude: scheduleItem.classroom.latitude,
            longitude: scheduleItem.classroom.longitude,
            radius: scheduleItem.classroom.radius,
            startTime: new Date(),
            endTime: new Date(),
            status: "CLOSED",
            isActive: false,
            closedAt: new Date(),
            closedBy: req.user._id
        });

        const recordIds = [];
        const presentStudentSnapshots = [];
        const absentStudentSnapshots = [];

        for (let i = 0; i < students.length; i++) {
            const oneStudent = students[i];
            const isPresent = presentIdStrings.includes(oneStudent._id.toString());

            const record = await AttendanceRecord.create({
                student: oneStudent._id,
                attendanceSession: session._id,
                subject: scheduleItem.subject._id,
                college: req.user.college,
                classGroup: scheduleItem.classGroup._id,
                classroom: scheduleItem.classroom._id,
                status: isPresent ? "PRESENT" : "ABSENT",
                latitude: scheduleItem.classroom.latitude,
                longitude: scheduleItem.classroom.longitude,
                distanceFromClassroom: 0,
                verificationMethod: "MANUAL",
                deviceInfo: {
                    userAgent: req.headers["user-agent"],
                    ip: req.ip
                }
            });

            recordIds.push(record._id);

            const studentSnapshot = {
                student: oneStudent._id,
                fullName: oneStudent.fullName,
                enrollmentNumber: oneStudent.enrollmentNumber,
                status: isPresent ? "PRESENT" : "ABSENT",
                attendanceRecord: record._id,
                markedAt: new Date(),
                verificationMethod: "MANUAL",
                distanceFromClassroom: 0
            };

            if (isPresent) {
                presentStudentSnapshots.push(studentSnapshot);
            } else {
                absentStudentSnapshots.push(studentSnapshot);
            }
        }

        session.attendanceRecords = recordIds;
        session.presentStudents = presentStudentSnapshots;
        session.absentStudents = absentStudentSnapshots;

        session.attendanceSummary.totalPresent = presentStudentSnapshots.length;
        session.attendanceSummary.totalAbsent = absentStudentSnapshots.length;
        session.attendanceSummary.totalMarked =
        presentStudentSnapshots.length + absentStudentSnapshots.length;

        await session.save();

        res.redirect("/teacher/dashboard?message=manual_saved");

    } catch (err) {
        console.log("TEACHER MANUAL ATTENDANCE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Could not save manual attendance: " + err.message);
    }
});

async function createAbsentRecordsForMissingStudents(session, req) {
    const students = await Student.find({
        college: session.college,
        classGroup: session.classGroup._id ? session.classGroup._id : session.classGroup
    });

    const existingRecords = await AttendanceRecord.find({
        attendanceSession: session._id
    });

    const alreadyMarkedStudentIds = [];

    for (let i = 0; i < existingRecords.length; i++) {
        alreadyMarkedStudentIds.push(existingRecords[i].student.toString());
    }

    for (let i = 0; i < students.length; i++) {
        const oneStudent = students[i];

        if (!alreadyMarkedStudentIds.includes(oneStudent._id.toString())) {
            const absentRecord = await AttendanceRecord.create({
                student: oneStudent._id,
                attendanceSession: session._id,
                subject: session.subject._id ? session.subject._id : session.subject,
                college: session.college,
                classGroup: session.classGroup._id ? session.classGroup._id : session.classGroup,
                classroom: session.classroom._id ? session.classroom._id : session.classroom,
                status: "ABSENT",
                latitude: session.latitude || 0,
                longitude: session.longitude || 0,
                distanceFromClassroom: 0,
                verificationMethod: "AUTO_ABSENT",
                deviceInfo: {
                    userAgent: req.headers["user-agent"],
                    ip: req.ip
                }
            });

            session.attendanceRecords.push(absentRecord._id);

            session.absentStudents.push({
                student: oneStudent._id,
                fullName: oneStudent.fullName,
                enrollmentNumber: oneStudent.enrollmentNumber,
                status: "ABSENT",
                attendanceRecord: absentRecord._id,
                markedAt: new Date(),
                verificationMethod: "AUTO_ABSENT",
                distanceFromClassroom: 0
            });
        }
    }

    session.attendanceSummary.totalPresent = session.presentStudents.length;
    session.attendanceSummary.totalAbsent = session.absentStudents.length;
    session.attendanceSummary.totalMarked =
        session.presentStudents.length + session.absentStudents.length;
}

router.post("/attendance/end/:id", isTeacher, async (req, res) => {
    try {
        const session = await AttendanceSession.findOne({
            _id: req.params.id,
            teacher: req.user._id
        })
        .populate("subject")
        .populate("classGroup")
        .populate("classroom");

        if (!session) {
            return res.send("Attendance session not found");
        }

        await createAbsentRecordsForMissingStudents(session, req);

        session.isActive = false;
        session.status = "CLOSED";
        session.closedAt = new Date();
        session.closedBy = req.user._id;

        await session.save();

        res.redirect("/teacher/dashboard");

    } catch (err) {
        console.log("TEACHER END ATTENDANCE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Could not end attendance: " + err.message);
    }
});

module.exports = router;