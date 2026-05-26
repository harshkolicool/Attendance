const Student = require("../models/studentSchema");
const AttendanceSession = require("../models/attendanceSessionSchema");
const AttendanceRecord = require("../models/attendanceRecordSchema");
const socketManager = require("./socketManager");

function getId(value) {
    if (!value) {
        return value;
    }

    return value._id ? value._id : value;
}

function sameId(a, b) {
    if (!a || !b) {
        return false;
    }

    return getId(a).toString() === getId(b).toString();
}

function getRequestLikeInfo(options) {
    return {
        userAgent: options && options.userAgent ? options.userAgent : "system-attendance-expiry-job",
        ip: options && options.ip ? options.ip : "system"
    };
}

async function createAbsentRecordsForMissingStudents(session, options) {
    const info = getRequestLikeInfo(options);

    const classGroupId = getId(session.classGroup);
    const subjectId = getId(session.subject);
    const classroomId = getId(session.classroom);

    const students = await Student.find({
        college: session.college,
        classGroup: classGroupId,
        isBlocked: { $ne: true }
    }).sort({
        fullName: 1
    });

    const existingRecords = await AttendanceRecord.find({
        attendanceSession: session._id
    });

    const existingRecordByStudent = {};
    const recordIds = [];
    const presentSnapshots = [];
    const absentSnapshots = [];

    for (let i = 0; i < existingRecords.length; i++) {
        const record = existingRecords[i];
        const studentId = record.student.toString();

        existingRecordByStudent[studentId] = record;
        recordIds.push(record._id);
    }

    for (let i = 0; i < students.length; i++) {
        const student = students[i];
        const studentId = student._id.toString();
        let record = existingRecordByStudent[studentId];

        if (!record) {
            record = await AttendanceRecord.findOneAndUpdate(
                {
                    student: student._id,
                    attendanceSession: session._id
                },
                {
                    $setOnInsert: {
                        student: student._id,
                        attendanceSession: session._id,
                        subject: subjectId,
                        college: session.college,
                        classGroup: classGroupId,
                        classroom: classroomId,
                        status: "ABSENT",
                        latitude: Number(session.latitude || 0),
                        longitude: Number(session.longitude || 0),
                        distanceFromClassroom: 0,
                        verificationMethod: "AUTO_ABSENT",
                        deviceInfo: {
                            userAgent: info.userAgent,
                            ip: info.ip
                        },
                        markedAt: new Date()
                    }
                },
                {
                    new: true,
                    upsert: true,
                    setDefaultsOnInsert: true
                }
            );

            existingRecordByStudent[studentId] = record;
            recordIds.push(record._id);
        }

        const snapshot = {
            student: student._id,
            fullName: student.fullName,
            enrollmentNumber: student.enrollmentNumber,
            status: record.status === "PRESENT" ? "PRESENT" : "ABSENT",
            attendanceRecord: record._id,
            markedAt: record.markedAt || record.createdAt || new Date(),
            verificationMethod: record.verificationMethod || "AUTO_ABSENT",
            distanceFromClassroom: record.distanceFromClassroom || 0
        };

        if (snapshot.status === "PRESENT") {
            presentSnapshots.push(snapshot);
        } else {
            absentSnapshots.push(snapshot);
        }
    }

    session.attendanceRecords = recordIds;
    session.presentStudents = presentSnapshots;
    session.absentStudents = absentSnapshots;

    session.attendanceSummary = {
        totalPresent: presentSnapshots.length,
        totalAbsent: absentSnapshots.length,
        totalMarked: presentSnapshots.length + absentSnapshots.length
    };

    return session;
}

async function expireOneSession(sessionId, options) {
    const session = await AttendanceSession.findById(sessionId)
        .populate("schedule")
        .populate("subject")
        .populate("classGroup")
        .populate("classroom");

    if (!session) {
        return {
            expired: false,
            reason: "SESSION_NOT_FOUND"
        };
    }

    if (!session.isActive || session.status !== "ACTIVE") {
        return {
            expired: false,
            reason: "SESSION_NOT_ACTIVE"
        };
    }

    if (session.endTime > new Date()) {
        return {
            expired: false,
            reason: "SESSION_NOT_EXPIRED"
        };
    }

    await createAbsentRecordsForMissingStudents(session, options);

    session.isActive = false;
    session.status = "EXPIRED";
    session.closedAt = new Date();
    session.expiredAt = new Date();
    session.absentsMarkedAt = new Date();

    await session.save();

    socketManager.emitAttendanceEnded(session);

    return {
        expired: true,
        sessionId: session._id
    };
}

async function closeExpiredAttendanceSessions() {
    const expiredSessions = await AttendanceSession.find({
        isActive: true,
        status: "ACTIVE",
        endTime: { $lte: new Date() }
    }).select("_id");

    let closedCount = 0;

    for (let i = 0; i < expiredSessions.length; i++) {
        try {
            const result = await expireOneSession(expiredSessions[i]._id, {
                userAgent: "system-attendance-expiry-job",
                ip: "system"
            });

            if (result.expired) {
                closedCount++;
            }
        } catch (err) {
            console.log("AUTO EXPIRE SESSION ERROR:");
            console.log(err.message);
            console.log(err.stack);
        }
    }

    if (closedCount > 0) {
        console.log("Auto expired attendance sessions:", closedCount);
    }

    return closedCount;
}

function startAttendanceExpiryJob() {
    closeExpiredAttendanceSessions().catch(function (err) {
        console.log("INITIAL ATTENDANCE EXPIRY JOB ERROR:");
        console.log(err.message);
    });

    setInterval(function () {
        closeExpiredAttendanceSessions().catch(function (err) {
            console.log("ATTENDANCE EXPIRY JOB ERROR:");
            console.log(err.message);
        });
    }, 60 * 1000);
}

module.exports = {
    startAttendanceExpiryJob,
    closeExpiredAttendanceSessions,
    expireOneSession,
    createAbsentRecordsForMissingStudents
};