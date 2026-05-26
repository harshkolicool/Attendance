let ioInstance = null;

const Student = require("../models/studentSchema");
const Teacher = require("../models/teacherSchema");
const PlatformAdmin = require("../models/platformAdminSchema");

function getId(value) {
    if (!value) {
        return "";
    }

    if (value._id) {
        return value._id.toString();
    }

    return value.toString();
}

function getSessionUser(socket) {
    if (
        !socket ||
        !socket.request ||
        !socket.request.session ||
        !socket.request.session.passport ||
        !socket.request.session.passport.user
    ) {
        return null;
    }

    return socket.request.session.passport.user;
}

function getPlatformAdminSessionId(socket) {
    if (!socket || !socket.request || !socket.request.session) {
        return null;
    }

    return socket.request.session.platformAdminId || null;
}

function reloadSocketSession(socket) {
    return new Promise(function (resolve) {
        if (
            !socket ||
            !socket.request ||
            !socket.request.session ||
            typeof socket.request.session.reload !== "function"
        ) {
            return resolve();
        }

        socket.request.session.reload(function () {
            resolve();
        });
    });
}

function emitSocketError(socket, message) {
    if (!socket || !socket.connected) {
        return;
    }

    socket.emit("socket:error", {
        message: message || "Realtime connection error."
    });
}

function getStudentRoom(studentId) {
    return "student:" + studentId.toString();
}

function getTeacherRoom(teacherId) {
    return "teacher:" + teacherId.toString();
}

function getAdminCollegeRoom(collegeId) {
    return "admin:college:" + collegeId.toString();
}

function getClassGroupRoom(classGroupId) {
    return "classGroup:" + classGroupId.toString();
}

function getPlatformAdminRoom() {
    return "platform-admin:all";
}

function initializeSocket(io) {
    ioInstance = io;

    io.on("connection", function (socket) {
        if (!getSessionUser(socket) && !getPlatformAdminSessionId(socket)) {
            emitSocketError(socket, "Login required for realtime updates.");
            socket.disconnect(true);
            return;
        }

        socket.on("student:join", async function () {
            try {
                if (socket.data && socket.data.studentJoined === true) {
                    return;
                }

                await reloadSocketSession(socket);
                const currentUser = getSessionUser(socket);

                if (!currentUser || currentUser.accountType !== "student") {
                    emitSocketError(socket, "Student realtime access is not available for this session.");
                    return;
                }

                const studentId = currentUser._id || currentUser.id;

                const student = await Student.findById(studentId).select("classGroup college fullName");

                if (!student || !student.classGroup) {
                    emitSocketError(socket, "Student realtime setup is incomplete.");
                    return;
                }

                socket.join(getStudentRoom(student._id));
                socket.join(getClassGroupRoom(student.classGroup));
                socket.data.studentJoined = true;

                socket.emit("student:joined", {
                    studentId: student._id.toString(),
                    classGroupId: student.classGroup.toString(),
                    collegeId: student.college ? student.college.toString() : ""
                });
            } catch (err) {
                console.log("SOCKET STUDENT JOIN ERROR:");
                console.log(err.message);
            }
        });

        socket.on("teacher:join", async function () {
            try {
                if (socket.data && socket.data.teacherJoined === true) {
                    return;
                }

                await reloadSocketSession(socket);
                const currentUser = getSessionUser(socket);

                if (!currentUser || currentUser.accountType !== "teacher") {
                    emitSocketError(socket, "Teacher realtime access is not available for this session.");
                    return;
                }

                const teacherId = currentUser._id || currentUser.id;

                const teacher = await Teacher.findById(teacherId).select("fullName college role");

                if (!teacher) {
                    emitSocketError(socket, "Teacher realtime profile was not found.");
                    return;
                }

                socket.join(getTeacherRoom(teacher._id));

                if (teacher.role === "ADMIN" && teacher.college) {
                    socket.join(getAdminCollegeRoom(teacher.college));
                }

                socket.data.teacherJoined = true;

                socket.emit("teacher:joined", {
                    teacherId: teacher._id.toString(),
                    role: teacher.role || "TEACHER",
                    collegeId: teacher.college ? teacher.college.toString() : ""
                });
            } catch (err) {
                console.log("SOCKET TEACHER JOIN ERROR:");
                console.log(err.message);
            }
        });

        socket.on("admin:join", async function () {
            try {
                if (socket.data && socket.data.adminJoined === true) {
                    return;
                }

                await reloadSocketSession(socket);
                const currentUser = getSessionUser(socket);

                if (!currentUser || currentUser.accountType !== "teacher") {
                    emitSocketError(socket, "Admin realtime access is not available for this session.");
                    return;
                }

                const teacherId = currentUser._id || currentUser.id;

                const admin = await Teacher.findById(teacherId).select("college role");

                if (!admin || admin.role !== "ADMIN" || !admin.college) {
                    emitSocketError(socket, "Admin realtime profile is not eligible.");
                    return;
                }

                socket.join(getTeacherRoom(admin._id));
                socket.join(getAdminCollegeRoom(admin.college));
                socket.data.adminJoined = true;

                socket.emit("admin:joined", {
                    adminId: admin._id.toString(),
                    collegeId: admin.college.toString()
                });
            } catch (err) {
                console.log("SOCKET ADMIN JOIN ERROR:");
                console.log(err.message);
            }
        });

        socket.on("platform-admin:join", async function () {
            try {
                if (socket.data && socket.data.platformAdminJoined === true) {
                    return;
                }

                await reloadSocketSession(socket);
                const platformAdminId = getPlatformAdminSessionId(socket);

                if (!platformAdminId) {
                    emitSocketError(socket, "Platform admin realtime session not found.");
                    return;
                }

                const platformAdmin = await PlatformAdmin.findById(platformAdminId)
                    .select("email isBlocked");

                if (!platformAdmin || platformAdmin.isBlocked) {
                    emitSocketError(socket, "Platform admin realtime access is blocked.");
                    return;
                }

                socket.join(getPlatformAdminRoom());
                socket.data.platformAdminJoined = true;

                socket.emit("platform-admin:joined", {
                    platformAdminId: platformAdmin._id.toString(),
                    email: platformAdmin.email || ""
                });
            } catch (err) {
                console.log("SOCKET PLATFORM ADMIN JOIN ERROR:");
                console.log(err.message);
            }
        });
    });
}

function getIO() {
    return ioInstance;
}

function emitAttendanceStarted(session, scheduleItem) {
    const io = getIO();

    if (!io || !session || !scheduleItem) {
        return;
    }

    const classGroupId = getId(session.classGroup || scheduleItem.classGroup);

    if (!classGroupId) {
        return;
    }

    const payload = {
        sessionId: getId(session._id),
        scheduleId: getId(session.schedule || scheduleItem._id),
        classGroupId: classGroupId,
        subjectId: getId(session.subject || scheduleItem.subject),
        teacherId: getId(session.teacher || scheduleItem.teacher),
        classroomId: getId(session.classroom || scheduleItem.classroom),
        collegeId: getId(session.college || (scheduleItem.classGroup ? scheduleItem.classGroup.college : "")),
        subjectName: scheduleItem.subject ? scheduleItem.subject.subjectName : "Subject",
        classGroupName: scheduleItem.classGroup ? scheduleItem.classGroup.name : "Class",
        classroomName: scheduleItem.classroom ? scheduleItem.classroom.classroomName : "Classroom",
        startTime: session.startTime,
        endTime: session.endTime,
        radius: session.radius
    };

    io.to(getClassGroupRoom(classGroupId)).emit("attendance:started", payload);

    io.to(getTeacherRoom(getId(session.teacher || scheduleItem.teacher))).emit(
        "attendance:started:teacher",
        payload
    );

    if (payload.collegeId) {
        io.to(getAdminCollegeRoom(payload.collegeId)).emit("attendance:started:admin", payload);
    }
}

function emitAttendanceEnded(session) {
    const io = getIO();

    if (!io || !session) {
        return;
    }

    const classGroupId = getId(session.classGroup);
    const teacherId = getId(session.teacher);
    const collegeId = getId(session.college);

    const payload = {
        sessionId: getId(session._id),
        scheduleId: getId(session.schedule),
        classGroupId: classGroupId,
        subjectId: getId(session.subject),
        teacherId: teacherId,
        collegeId: collegeId,
        status: session.status,
        totalPresent: session.attendanceSummary ? session.attendanceSummary.totalPresent : 0,
        totalAbsent: session.attendanceSummary ? session.attendanceSummary.totalAbsent : 0,
        totalMarked: session.attendanceSummary ? session.attendanceSummary.totalMarked : 0
    };

    if (classGroupId) {
        io.to(getClassGroupRoom(classGroupId)).emit("attendance:ended", payload);
    }

    if (teacherId) {
        io.to(getTeacherRoom(teacherId)).emit("attendance:ended:teacher", payload);
    }

    if (collegeId) {
        io.to(getAdminCollegeRoom(collegeId)).emit("attendance:ended:admin", payload);
    }
}

function emitAttendanceMarked(session, student, attendanceRecord, distance) {
    const io = getIO();

    if (!io || !session || !student) {
        return;
    }

    const teacherId = getId(session.teacher);

    const payload = {
        sessionId: getId(session._id),
        scheduleId: getId(session.schedule),
        studentId: getId(student._id),
        studentName: student.fullName,
        enrollmentNumber: student.enrollmentNumber,
        attendanceRecordId: attendanceRecord ? getId(attendanceRecord._id) : "",
        status: "PRESENT",
        distance: Math.round(distance || 0),
        totalPresent: session.presentStudents ? session.presentStudents.length : 0,
        totalAbsent: session.absentStudents ? session.absentStudents.length : 0,
        totalMarked: session.attendanceSummary ? session.attendanceSummary.totalMarked : 0,
        markedAt: new Date()
    };

    if (teacherId) {
        io.to(getTeacherRoom(teacherId)).emit("attendance:marked", payload);
    }

    io.to(getStudentRoom(student._id)).emit("attendance:marked:self", payload);
}

function emitSuspiciousAttendanceAttempt(attempt) {
    const io = getIO();

    if (!io || !attempt) {
        return;
    }

    const teacherId = getId(attempt.teacher);

    if (!teacherId) {
        return;
    }

    const payload = {
        attemptId: getId(attempt._id),
        sessionId: getId(attempt.attendanceSession),
        scheduleId: getId(attempt.schedule),
        studentId: getId(attempt.student),
        studentName: attempt.studentName || "Unknown Student",
        enrollmentNumber: attempt.enrollmentNumber || "Unknown",
        reasonCode: attempt.reasonCode || "UNKNOWN",
        reasonMessage: attempt.reasonMessage || "Suspicious attendance attempt.",
        result: attempt.result || "REJECTED",
        distanceFromTeacher: Math.round(attempt.distanceFromTeacher || 0),
        allowedRadius: Math.round(attempt.allowedRadius || 0),
        gpsAccuracy: Math.round(attempt.gpsAccuracy || 0),
        maxAllowedAccuracy: Math.round(attempt.maxAllowedAccuracy || 100),
        createdAt: attempt.createdAt || new Date()
    };

    io.to(getTeacherRoom(teacherId)).emit("attendance:suspicious", payload);
}

function emitScheduleChanged(payload) {
    const io = getIO();

    if (!io || !payload) {
        return;
    }

    const safePayload = {
        reason: payload.reason || "updated",
        scheduleId: payload.scheduleId ? payload.scheduleId.toString() : "",
        classGroupId: payload.classGroupId ? payload.classGroupId.toString() : "",
        teacherId: payload.teacherId ? payload.teacherId.toString() : "",
        collegeId: payload.collegeId ? payload.collegeId.toString() : "",
        changedAt: new Date()
    };

    if (safePayload.classGroupId) {
        io.to(getClassGroupRoom(safePayload.classGroupId)).emit("schedule:changed", safePayload);
    }

    if (safePayload.teacherId) {
        io.to(getTeacherRoom(safePayload.teacherId)).emit("schedule:changed", safePayload);
    }

    if (safePayload.collegeId) {
        io.to(getAdminCollegeRoom(safePayload.collegeId)).emit("schedule:changed", safePayload);
    }

    io.to(getPlatformAdminRoom()).emit("schedule:changed", safePayload);
}

function emitNotification(notificationPayload) {
    const io = getIO();

    if (!io || !notificationPayload) {
        return;
    }

    const role = (notificationPayload.recipientRole || "").toUpperCase();

    if (role === "STUDENT" && notificationPayload.recipientUserId) {
        io.to(getStudentRoom(notificationPayload.recipientUserId)).emit(
            "notification:new",
            notificationPayload
        );
        return;
    }

    if (role === "TEACHER" && notificationPayload.recipientUserId) {
        io.to(getTeacherRoom(notificationPayload.recipientUserId)).emit(
            "notification:new",
            notificationPayload
        );
        return;
    }

    if (role === "ADMIN") {
        if (notificationPayload.recipientUserId) {
            io.to(getTeacherRoom(notificationPayload.recipientUserId)).emit(
                "notification:new",
                notificationPayload
            );
            return;
        }

        if (notificationPayload.collegeId) {
            io.to(getAdminCollegeRoom(notificationPayload.collegeId)).emit(
                "notification:new",
                notificationPayload
            );
        }
        return;
    }

    if (role === "PLATFORM_ADMIN") {
        io.to(getPlatformAdminRoom()).emit("notification:new", notificationPayload);
    }
}

function emitNotificationUnreadCount(payload) {
    const io = getIO();

    if (!io || !payload) {
        return;
    }

    const role = (payload.recipientRole || "").toUpperCase();
    const countPayload = {
        recipientRole: role,
        unreadCount: Number(payload.unreadCount || 0)
    };

    if (role === "STUDENT" && payload.recipientUserId) {
        io.to(getStudentRoom(payload.recipientUserId)).emit("notification:unread-count", countPayload);
        return;
    }

    if (role === "TEACHER" && payload.recipientUserId) {
        io.to(getTeacherRoom(payload.recipientUserId)).emit("notification:unread-count", countPayload);
        return;
    }

    if (role === "ADMIN") {
        if (payload.recipientUserId) {
            io.to(getTeacherRoom(payload.recipientUserId)).emit("notification:unread-count", countPayload);
            return;
        }

        if (payload.collegeId) {
            io.to(getAdminCollegeRoom(payload.collegeId)).emit("notification:unread-count", countPayload);
        }
        return;
    }

    if (role === "PLATFORM_ADMIN") {
        io.to(getPlatformAdminRoom()).emit("notification:unread-count", countPayload);
    }
}

module.exports = {
    initializeSocket,
    getIO,
    emitAttendanceStarted,
    emitAttendanceEnded,
    emitAttendanceMarked,
    emitSuspiciousAttendanceAttempt,
    emitScheduleChanged,
    emitNotification,
    emitNotificationUnreadCount
};
