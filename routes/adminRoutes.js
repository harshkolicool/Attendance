const express = require("express");
const router = express.Router();
const passport = require("passport");
const mongoose = require("mongoose");
const multer = require("multer");
const College = require("../models/collegeSchema");
const ClassGroup = require("../models/classGroupSchema");
const Classroom = require("../models/classroomSchema");
const Subject = require("../models/subjectSchema");
const Teacher = require("../models/teacherSchema");
const Student = require("../models/studentSchema");
const Schedule = require("../models/scheduleSchema");
const AttendanceSession = require("../models/attendanceSessionSchema");
const AttendanceRecord = require("../models/attendanceRecordSchema");


const {
    timeToMinutes,
    sortSchedulesByDayAndTime
} = require("../utils/scheduleTime");

const isCollegeAdmin = require("../middlewares/isCollegeAdmin");

function getCollegeId(req) {
    if (!req.collegeId) {
        throw new Error("College ID missing from admin request");
    }

    return req.collegeId;
}

function cleanText(value) {
    if (!value) {
        return "";
    }

    return value.toString().trim();
}

function cleanUpper(value) {
    return cleanText(value).toUpperCase();
}

function cleanEmail(value) {
    return cleanText(value).toLowerCase();
}

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidNumber(value) {
    return !Number.isNaN(Number(value));
}

function isValidSemester(value) {
    const semester = Number(value);
    return Number.isInteger(semester) && semester >= 1 && semester <= 12;
}

function isValidRadius(value) {
    const radius = Number(value);
    return !Number.isNaN(radius) && radius >= 10 && radius <= 10000;
}

function isValidLatitude(value) {
    const latitude = Number(value);
    return !Number.isNaN(latitude) && latitude >= -90 && latitude <= 90;
}

function isValidLongitude(value) {
    const longitude = Number(value);
    return !Number.isNaN(longitude) && longitude >= -180 && longitude <= 180;
}

function getFlashMessage(code) {
    if (code === "created") return "Record created successfully";
    if (code === "deleted") return "Record deleted successfully";
    if (code === "updated") return "Record updated successfully";

    if (code === "invalid_input") return "Invalid input. Please check all fields.";
    if (code === "invalid_id") return "Invalid record selected.";
    if (code === "invalid_time") return "Invalid schedule time. End time must be after start time.";
    if (code === "invalid_email") return "Invalid email address.";
    if (code === "weak_password") return "Password must be at least 6 characters.";
    if (code === "invalid_role") return "Invalid role selected.";

    if (code === "duplicate_class_group") return "This class group already exists.";
    if (code === "duplicate_classroom") return "This classroom already exists.";
    if (code === "duplicate_subject") return "This subject already exists for this class group.";
    if (code === "duplicate_teacher") return "Teacher email or employee ID already exists.";
    if (code === "duplicate_student") return "Student email or enrollment number already exists.";

    if (code === "invalid_class_group") return "Selected class group does not belong to your college.";
    if (code === "invalid_classroom") return "Selected classroom does not belong to your college.";
    if (code === "invalid_subject") return "Selected subject does not belong to this class group.";
    if (code === "invalid_teacher") return "Selected teacher does not belong to your college.";
    if (code === "teacher_not_assigned") return "Selected teacher is not assigned to this subject.";

    if (code === "teacher_clash") return "This teacher already has another class at this time.";
    if (code === "class_clash") return "This class group already has another class at this time.";
    if (code === "room_clash") return "This classroom is already booked at this time.";

    if (code === "in_use") return "This record is already used somewhere, so it cannot be deleted.";
    if (code === "delete_blocked") return "This record cannot be deleted safely.";
    if (code === "error") return "Something went wrong. Please try again.";

    if (code === "updated") {
        return "Schedule updated successfully.";
    }

    if (code === "invalid_time") {
        return "End time must be greater than start time.";
    }

    if (code === "invalid_schedule") {
        return "Schedule not found.";
    }

    if (code === "invalid_subject_class") {
        return "Selected subject does not belong to selected class group.";
    }

    if (code === "teacher_not_assigned") {
        return "Selected teacher is not assigned to this subject.";
    }

    if (code === "teacher_conflict") {
        return "Teacher already has another class at this time.";
    }

    if (code === "class_conflict") {
        return "This class group already has another schedule at this time.";
    }

    if (code === "classroom_conflict") {
        return "This classroom is already booked at this time.";
    }

    return null;
}

const uploadStudentsCsv = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        if (
            file.mimetype === "text/csv" ||
            file.originalname.toLowerCase().endsWith(".csv")
        ) {
            cb(null, true);
        } else {
            cb(new Error("Only CSV files are allowed"));
        }
    }
});

function csvCleanText(value) {
    if (!value) {
        return "";
    }

    return value.toString().trim();
}

function csvCleanUpper(value) {
    return csvCleanText(value).toUpperCase();
}

function csvCleanEmail(value) {
    return csvCleanText(value).toLowerCase();
}

function csvIsValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function csvEscape(value) {
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

function parseCsvLine(line) {
    const values = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const character = line[i];
        const nextCharacter = line[i + 1];

        if (character === '"' && insideQuotes && nextCharacter === '"') {
            current += '"';
            i++;
        } else if (character === '"') {
            insideQuotes = !insideQuotes;
        } else if (character === "," && !insideQuotes) {
            values.push(current.trim());
            current = "";
        } else {
            current += character;
        }
    }

    values.push(current.trim());

    return values;
}

function parseStudentsCsv(csvText) {
    const lines = csvText
        .replace(/\r/g, "")
        .split("\n")
        .filter(function (line) {
            return line.trim() !== "";
        });

    if (lines.length < 2) {
        return {
            rows: [],
            errors: ["CSV must contain a header row and at least one student row."]
        };
    }

    const headers = parseCsvLine(lines[0]).map(function (header) {
        return header.trim();
    });

    const requiredHeaders = [
        "fullName",
        "email",
        "password",
        "enrollmentNumber",
        "department",
        "semester",
        "section"
    ];

    const errors = [];

    requiredHeaders.forEach(function (header) {
        if (!headers.includes(header)) {
            errors.push("Missing CSV column: " + header);
        }
    });

    if (errors.length > 0) {
        return {
            rows: [],
            errors: errors
        };
    }

    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const row = {};

        headers.forEach(function (header, index) {
            row[header] = values[index] || "";
        });

        row.rowNumber = i + 1;
        rows.push(row);
    }

    return {
        rows: rows,
        errors: []
    };
}

function setStudentImportResult(req, result) {
    req.session.studentImportResult = result;
}

function getStudentImportResult(req) {
    const result = req.session.studentImportResult || null;
    req.session.studentImportResult = null;
    return result;
}


router.get("/login", function (req, res) {
    if (
        req.isAuthenticated() &&
        req.user.accountType === "teacher" &&
        req.user.role === "ADMIN"
    ) {
        return res.redirect("/admin/dashboard");
    }

    res.render("admin/login", {
        error: null
    });
});

router.post("/login", function (req, res, next) {
    passport.authenticate("teacher-local", function (err, user, info) {
        if (err) {
            console.log("ADMIN LOGIN ERROR:", err.message);
            return next(err);
        }

        if (!user) {
            return res.render("admin/login", {
                error: info ? info.message : "Login failed"
            });
        }

        req.logIn(user, function (loginErr) {
            if (loginErr) {
                console.log("ADMIN LOGIN SESSION ERROR:", loginErr.message);
                return next(loginErr);
            }

            Teacher.findById(user.id).then(function (teacher) {
                if (!teacher || teacher.role !== "ADMIN") {
                    req.logout(function () {
                        return res.render("admin/login", {
                            error: "This account is not a college admin"
                        });
                    });
                    return;
                }

                res.redirect("/admin/dashboard");
            });
        });
    })(req, res, next);
});

router.get("/dashboard", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const college = req.college || await College.findById(collegeId);

        const counts = {
            classGroups: await ClassGroup.countDocuments({ college: collegeId }),
            classrooms: await Classroom.countDocuments({ college: collegeId }),
            subjects: await Subject.countDocuments({ college: collegeId }),
            teachers: await Teacher.countDocuments({
                college: collegeId,
                role: { $in: ["TEACHER", "HOD"] }
            }),
            students: await Student.countDocuments({ college: collegeId }),
            schedules: await Schedule.countDocuments({ college: collegeId })
        };

        res.render("admin/dashboard", {
            admin: req.user,
            college: college,
            counts: counts,
            message: getFlashMessage(req.query.message),
            error: null,
            activePage: "dashboard"
        });

    } catch (err) {
        console.log("ADMIN DASHBOARD ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Admin dashboard error: " + err.message);
    }
});

/* ================= CLASS GROUPS ================= */

router.get("/class-groups", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const classGroups = await ClassGroup.find({
            college: collegeId
        }).sort({
            department: 1,
            semester: 1,
            section: 1
        });

        res.render("admin/classGroups", {
            admin: req.user,
            classGroups: classGroups,
            message: getFlashMessage(req.query.message),
            error: null,
            activePage: "class-groups"
        });

    } catch (err) {
        console.log("ADMIN CLASS GROUPS ERROR:");
        console.log(err.message);
        res.send("Class groups error: " + err.message);
    }
});

router.post("/class-groups/create", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const name = cleanUpper(req.body.name);
        const department = cleanUpper(req.body.department);
        const semester = Number(req.body.semester);
        const section = cleanUpper(req.body.section);

        if (
            !name ||
            !department ||
            !section ||
            !isValidSemester(semester)
        ) {
            return res.redirect("/admin/class-groups?message=invalid_input");
        }

        const existingClassGroup = await ClassGroup.findOne({
            college: collegeId,
            department: department,
            semester: semester,
            section: section
        });

        if (existingClassGroup) {
            return res.redirect("/admin/class-groups?message=duplicate_class_group");
        }

        await ClassGroup.create({
            name: name,
            department: department,
            semester: semester,
            section: section,
            college: collegeId,
            students: [],
            subjects: [],
            isActive: true
        });

        res.redirect("/admin/class-groups?message=created");

    } catch (err) {
        console.log("ADMIN CREATE CLASS GROUP ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/class-groups?message=error");
    }
});


router.post("/classrooms/:id/update", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const classroomId = req.params.id;

        if (!isValidObjectId(classroomId)) {
            return res.redirect("/admin/classrooms?message=invalid_id");
        }

        const classroomName = cleanText(req.body.classroomName);
        const buildingName = cleanText(req.body.buildingName);
        const floorNumber = Number(req.body.floorNumber);
        const radius = Number(req.body.radius) || 100;

        if (
            !classroomName ||
            !buildingName ||
            !Number.isInteger(floorNumber) ||
            !isValidRadius(radius)
        ) {
            return res.redirect("/admin/classrooms?message=invalid_input");
        }

        const classroom = await Classroom.findOne({
            _id: classroomId,
            college: collegeId
        });

        if (!classroom) {
            return res.redirect("/admin/classrooms?message=invalid_classroom");
        }

        const duplicateClassroom = await Classroom.findOne({
            _id: { $ne: classroomId },
            college: collegeId,
            classroomName: classroomName,
            buildingName: buildingName,
            floorNumber: floorNumber
        });

        if (duplicateClassroom) {
            return res.redirect("/admin/classrooms?message=duplicate_classroom");
        }

        const hasActiveAttendanceSession = await AttendanceSession.exists({
            college: collegeId,
            classroom: classroomId,
            isActive: true,
            status: "ACTIVE"
        });

        if (hasActiveAttendanceSession) {
            return res.redirect("/admin/classrooms?message=in_use");
        }

        await Classroom.updateOne(
            {
                _id: classroomId,
                college: collegeId
            },
            {
                $set: {
                    classroomName: classroomName,
                    buildingName: buildingName,
                    floorNumber: floorNumber,
                    radius: radius
                }
            }
        );

        res.redirect("/admin/classrooms?message=updated");

    } catch (err) {
        console.log("ADMIN UPDATE CLASSROOM ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/classrooms?message=error");
    }
});

router.post("/class-groups/:id/update", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const classGroupId = req.params.id;

        if (!isValidObjectId(classGroupId)) {
            return res.redirect("/admin/class-groups?message=invalid_id");
        }

        const name = cleanUpper(req.body.name);
        const department = cleanUpper(req.body.department);
        const semester = Number(req.body.semester);
        const section = cleanUpper(req.body.section);

        if (
            !name ||
            !department ||
            !section ||
            !isValidSemester(semester)
        ) {
            return res.redirect("/admin/class-groups?message=invalid_input");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId
        });

        if (!classGroup) {
            return res.redirect("/admin/class-groups?message=invalid_class_group");
        }

        const duplicateClassGroup = await ClassGroup.findOne({
            _id: { $ne: classGroupId },
            college: collegeId,
            department: department,
            semester: semester,
            section: section
        });

        if (duplicateClassGroup) {
            return res.redirect("/admin/class-groups?message=duplicate_class_group");
        }

        const hasStudents = await Student.exists({
            college: collegeId,
            classGroup: classGroupId
        });

        const hasSubjects = await Subject.exists({
            college: collegeId,
            classGroup: classGroupId
        });

        const hasSchedules = await Schedule.exists({
            college: collegeId,
            classGroup: classGroupId
        });

        const isChangingCoreFields =
            classGroup.department !== department ||
            Number(classGroup.semester) !== semester ||
            classGroup.section !== section;

        if ((hasStudents || hasSubjects || hasSchedules) && isChangingCoreFields) {
            return res.redirect("/admin/class-groups?message=in_use");
        }

        await ClassGroup.updateOne(
            {
                _id: classGroupId,
                college: collegeId
            },
            {
                $set: {
                    name: name,
                    department: department,
                    semester: semester,
                    section: section
                }
            }
        );

        res.redirect("/admin/class-groups?message=updated");

    } catch (err) {
        console.log("ADMIN UPDATE CLASS GROUP ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/class-groups?message=error");
    }
});

router.post("/class-groups/:id/delete", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const classGroupId = req.params.id;

        if (!isValidObjectId(classGroupId)) {
            return res.redirect("/admin/class-groups?message=invalid_id");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId
        });

        if (!classGroup) {
            return res.redirect("/admin/class-groups?message=invalid_class_group");
        }

        const hasStudents = await Student.exists({
            college: collegeId,
            classGroup: classGroupId
        });

        const hasSubjects = await Subject.exists({
            college: collegeId,
            classGroup: classGroupId
        });

        const hasSchedules = await Schedule.exists({
            college: collegeId,
            classGroup: classGroupId
        });

        if (hasStudents || hasSubjects || hasSchedules) {
            return res.redirect("/admin/class-groups?message=in_use");
        }

        await ClassGroup.deleteOne({
            _id: classGroupId,
            college: collegeId
        });

        res.redirect("/admin/class-groups?message=deleted");

    } catch (err) {
        console.log("ADMIN DELETE CLASS GROUP ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/class-groups?message=error");
    }
});

/* ================= CLASSROOMS ================= */

router.get("/classrooms", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const classrooms = await Classroom.find({
            college: collegeId
        }).sort({
            buildingName: 1,
            floorNumber: 1,
            classroomName: 1
        });

        res.render("admin/classrooms", {
            admin: req.user,
            classrooms: classrooms,
            message: getFlashMessage(req.query.message),
            error: null,
            activePage: "classrooms"
        });

    } catch (err) {
        console.log("ADMIN CLASSROOMS ERROR:");
        console.log(err.message);
        res.send("Classrooms error: " + err.message);
    }
});

router.post("/classrooms/create", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const classroomName = cleanText(req.body.classroomName);
        const buildingName = cleanText(req.body.buildingName);
        const floorNumber = Number(req.body.floorNumber);
        const radius = Number(req.body.radius) || 100;

        if (
            !classroomName ||
            !buildingName ||
            !Number.isInteger(floorNumber) ||
            !isValidRadius(radius)
        ) {
            return res.redirect("/admin/classrooms?message=invalid_input");
        }

        const existingClassroom = await Classroom.findOne({
            college: collegeId,
            classroomName: classroomName,
            buildingName: buildingName,
            floorNumber: floorNumber
        });

        if (existingClassroom) {
            return res.redirect("/admin/classrooms?message=duplicate_classroom");
        }

        await Classroom.create({
            classroomName: classroomName,
            buildingName: buildingName,
            floorNumber: floorNumber,
            radius: radius,
            college: collegeId,
            students: [],
            attendanceSessions: []
        });

        res.redirect("/admin/classrooms?message=created");

    } catch (err) {
        console.log("ADMIN CREATE CLASSROOM ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/classrooms?message=error");
    }
});

router.post("/classrooms/:id/delete", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const classroomId = req.params.id;

        if (!isValidObjectId(classroomId)) {
            return res.redirect("/admin/classrooms?message=invalid_id");
        }

        const classroom = await Classroom.findOne({
            _id: classroomId,
            college: collegeId
        });

        if (!classroom) {
            return res.redirect("/admin/classrooms?message=invalid_classroom");
        }

        const hasSchedules = await Schedule.exists({
            college: collegeId,
            classroom: classroomId
        });

        const hasAttendanceSessions = await AttendanceSession.exists({
            college: collegeId,
            classroom: classroomId
        });

        if (hasSchedules || hasAttendanceSessions) {
            return res.redirect("/admin/classrooms?message=in_use");
        }

        await Classroom.deleteOne({
            _id: classroomId,
            college: collegeId
        });

        res.redirect("/admin/classrooms?message=deleted");

    } catch (err) {
        console.log("ADMIN DELETE CLASSROOM ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/classrooms?message=error");
    }
});

/* ================= SUBJECTS ================= */

router.get("/subjects", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const subjects = await Subject.find({
            college: collegeId
        })
        .populate("classGroup")
        .populate("teachers")
        .sort({
            department: 1,
            semester: 1,
            subjectName: 1
        });

        const classGroups = await ClassGroup.find({
            college: collegeId,
            isActive: true
        }).sort({
            department: 1,
            semester: 1,
            section: 1
        });

        const teachers = await Teacher.find({
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] },
            isBlocked: false
        }).sort({
            fullName: 1
        });

        res.render("admin/subjects", {
            admin: req.user,
            subjects: subjects,
            classGroups: classGroups,
            teachers: teachers,
            message: getFlashMessage(req.query.message),
            error: null,
            activePage: "subjects"
        });

    } catch (err) {
        console.log("ADMIN SUBJECTS ERROR:");
        console.log(err.message);
        res.send("Subjects error: " + err.message);
    }
});

router.post("/subjects/create", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const subjectName = cleanUpper(req.body.subjectName);
        const subjectCode = cleanUpper(req.body.subjectCode);
        const department = cleanUpper(req.body.department);
        const semester = Number(req.body.semester);
        const classGroupId = req.body.classGroupId;

        let teacherIds = req.body.teacherIds || [];

        if (!Array.isArray(teacherIds)) {
            teacherIds = [teacherIds];
        }

        teacherIds = teacherIds.filter(function (id) {
            return isValidObjectId(id);
        });

        if (
            !subjectName ||
            !subjectCode ||
            !department ||
            !isValidSemester(semester) ||
            !isValidObjectId(classGroupId) ||
            teacherIds.length === 0
        ) {
            return res.redirect("/admin/subjects?message=invalid_input");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId,
            isActive: true
        });

        if (!classGroup) {
            return res.redirect("/admin/subjects?message=invalid_class_group");
        }

        const teachers = await Teacher.find({
            _id: { $in: teacherIds },
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] },
            isBlocked: false
        });

        if (teachers.length !== teacherIds.length) {
            return res.redirect("/admin/subjects?message=invalid_teacher");
        }

        const existingSubject = await Subject.findOne({
            college: collegeId,
            classGroup: classGroupId,
            subjectCode: subjectCode
        });

        if (existingSubject) {
            return res.redirect("/admin/subjects?message=duplicate_subject");
        }

        const studentsInClass = await Student.find({
            college: collegeId,
            classGroup: classGroupId
        });

        const studentIds = studentsInClass.map(function (student) {
            return student._id;
        });

        const subject = await Subject.create({
            subjectName: subjectName,
            subjectCode: subjectCode,
            department: department,
            semester: semester,
            classGroup: classGroupId,
            college: collegeId,
            teachers: teacherIds,
            students: studentIds,
            attendanceSessions: [],
            isActive: true
        });

        await Teacher.updateMany(
            {
                _id: { $in: teacherIds },
                college: collegeId
            },
            {
                $addToSet: { subjects: subject._id }
            }
        );

        await ClassGroup.updateOne(
            {
                _id: classGroupId,
                college: collegeId
            },
            {
                $addToSet: { subjects: subject._id }
            }
        );

        await Student.updateMany(
            {
                college: collegeId,
                classGroup: classGroupId
            },
            {
                $addToSet: { subjects: subject._id }
            }
        );

        res.redirect("/admin/subjects?message=created");

    } catch (err) {
        console.log("ADMIN CREATE SUBJECT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/subjects?message=error");
    }
});

router.post("/subjects/:id/update", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const subjectId = req.params.id;

        if (!isValidObjectId(subjectId)) {
            return res.redirect("/admin/subjects?message=invalid_id");
        }

        const subjectName = cleanUpper(req.body.subjectName);
        const subjectCode = cleanUpper(req.body.subjectCode);
        const classGroupId = req.body.classGroupId;

        let teacherIds = req.body.teacherIds || [];

        if (!Array.isArray(teacherIds)) {
            teacherIds = [teacherIds];
        }

        teacherIds = teacherIds.filter(function (teacherId) {
            return isValidObjectId(teacherId);
        });

        if (
            !subjectName ||
            !subjectCode ||
            !isValidObjectId(classGroupId) ||
            teacherIds.length === 0
        ) {
            return res.redirect("/admin/subjects?message=invalid_input");
        }

        const subject = await Subject.findOne({
            _id: subjectId,
            college: collegeId
        });

        if (!subject) {
            return res.redirect("/admin/subjects?message=invalid_subject");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId,
            isActive: true
        });

        if (!classGroup) {
            return res.redirect("/admin/subjects?message=invalid_class_group");
        }

        const teachers = await Teacher.find({
            _id: { $in: teacherIds },
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] },
            isBlocked: { $ne: true }
        });

        if (teachers.length !== teacherIds.length) {
            return res.redirect("/admin/subjects?message=invalid_teacher");
        }

        const duplicateSubject = await Subject.findOne({
            _id: { $ne: subjectId },
            college: collegeId,
            classGroup: classGroupId,
            $or: [
                { subjectName: subjectName },
                { subjectCode: subjectCode }
            ]
        });

        if (duplicateSubject) {
            return res.redirect("/admin/subjects?message=duplicate_subject");
        }

        const oldClassGroupId = subject.classGroup
            ? subject.classGroup.toString()
            : "";

        const newClassGroupId = classGroupId.toString();

        const isChangingClassGroup = oldClassGroupId !== newClassGroupId;

        const hasSchedules = await Schedule.exists({
            college: collegeId,
            subject: subjectId
        });

        const hasAttendanceSessions = await AttendanceSession.exists({
            college: collegeId,
            subject: subjectId
        });

        const hasAttendanceRecords = await AttendanceRecord.exists({
            college: collegeId,
            subject: subjectId
        });

        if (
            isChangingClassGroup &&
            (hasSchedules || hasAttendanceSessions || hasAttendanceRecords)
        ) {
            return res.redirect("/admin/subjects?message=in_use");
        }

        const schedulesUsingSubject = await Schedule.find({
            college: collegeId,
            subject: subjectId
        }).select("teacher");

        const scheduledTeacherIds = schedulesUsingSubject.map(function (schedule) {
            return schedule.teacher.toString();
        });

        const removedScheduledTeacher = scheduledTeacherIds.some(function (teacherId) {
            return !teacherIds.includes(teacherId);
        });

        if (removedScheduledTeacher) {
            return res.redirect("/admin/subjects?message=in_use");
        }

        const studentsInClassGroup = await Student.find({
            college: collegeId,
            classGroup: classGroupId
        }).select("_id");

        const studentIds = studentsInClassGroup.map(function (student) {
            return student._id;
        });

        subject.subjectName = subjectName;
        subject.subjectCode = subjectCode;
        subject.department = classGroup.department;
        subject.semester = classGroup.semester;
        subject.classGroup = classGroup._id;
        subject.teachers = teacherIds;
        subject.students = studentIds;

        await subject.save();

        await Teacher.updateMany(
            {
                college: collegeId,
                subjects: subject._id
            },
            {
                $pull: {
                    subjects: subject._id
                }
            }
        );

        await Teacher.updateMany(
            {
                _id: { $in: teacherIds },
                college: collegeId
            },
            {
                $addToSet: {
                    subjects: subject._id
                }
            }
        );

        if (isChangingClassGroup) {
            await ClassGroup.updateOne(
                {
                    _id: oldClassGroupId,
                    college: collegeId
                },
                {
                    $pull: {
                        subjects: subject._id
                    }
                }
            );

            await ClassGroup.updateOne(
                {
                    _id: classGroupId,
                    college: collegeId
                },
                {
                    $addToSet: {
                        subjects: subject._id
                    }
                }
            );
        }

        await Student.updateMany(
            {
                college: collegeId,
                classGroup: classGroupId
            },
            {
                $addToSet: {
                    subjects: subject._id
                }
            }
        );

        await Student.updateMany(
            {
                college: collegeId,
                classGroup: { $ne: classGroupId },
                subjects: subject._id
            },
            {
                $pull: {
                    subjects: subject._id
                }
            }
        );

        res.redirect("/admin/subjects?message=updated");

    } catch (err) {
        console.log("ADMIN UPDATE SUBJECT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/subjects?message=error");
    }
});

router.post("/subjects/:id/delete", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const subjectId = req.params.id;

        if (!isValidObjectId(subjectId)) {
            return res.redirect("/admin/subjects?message=invalid_id");
        }

        const subject = await Subject.findOne({
            _id: subjectId,
            college: collegeId
        });

        if (!subject) {
            return res.redirect("/admin/subjects?message=invalid_subject");
        }

        const hasSchedules = await Schedule.exists({
            college: collegeId,
            subject: subjectId
        });

        const hasAttendanceSessions = await AttendanceSession.exists({
            college: collegeId,
            subject: subjectId
        });

        if (hasSchedules || hasAttendanceSessions) {
            return res.redirect("/admin/subjects?message=in_use");
        }

        await Teacher.updateMany(
            {
                college: collegeId
            },
            {
                $pull: { subjects: subject._id }
            }
        );

        await Student.updateMany(
            {
                college: collegeId
            },
            {
                $pull: { subjects: subject._id }
            }
        );

        await ClassGroup.updateOne(
            {
                _id: subject.classGroup,
                college: collegeId
            },
            {
                $pull: { subjects: subject._id }
            }
        );

        await Subject.deleteOne({
            _id: subjectId,
            college: collegeId
        });

        res.redirect("/admin/subjects?message=deleted");

    } catch (err) {
        console.log("ADMIN DELETE SUBJECT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/subjects?message=error");
    }
});

/* ================= TEACHERS ================= */

router.get("/teachers", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const teachers = await Teacher.find({
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] }
        })
            .populate("subjects")
            .sort({ fullName: 1 });

        const classGroupDepartments = await ClassGroup.distinct("department", {
            college: collegeId,
            isActive: true
        });

        const teacherDepartments = await Teacher.distinct("department", {
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] }
        });

        const departments = Array.from(
            new Set([
                ...classGroupDepartments,
                ...teacherDepartments
            ])
        ).sort();

        res.render("admin/teachers", {
            admin: req.user,
            teachers: teachers,
            departments: departments,
            message: getFlashMessage(req.query.message),
            error: null,
            activePage: "teachers"
        });

    } catch (err) {
        console.log("ADMIN TEACHERS PAGE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).send("Teachers page error: " + err.message);
    }
});

router.post("/teachers/create", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const fullName = cleanText(req.body.fullName);
        const email = cleanEmail(req.body.email);
        const password = cleanText(req.body.password);
        const employeeId = cleanUpper(req.body.employeeId);
        const department = cleanUpper(req.body.department);
        const role = cleanUpper(req.body.role || "TEACHER");

        if (!["TEACHER", "HOD"].includes(role)) {
            return res.redirect("/admin/teachers?message=invalid_role");
        }

        if (!fullName || !email || !password || !employeeId || !department) {
            return res.redirect("/admin/teachers?message=invalid_input");
        }

        if (!isValidEmail(email)) {
            return res.redirect("/admin/teachers?message=invalid_email");
        }

        if (password.length < 6) {
            return res.redirect("/admin/teachers?message=weak_password");
        }

        const existingTeacher = await Teacher.findOne({
            $or: [
                { email: email },
                { college: collegeId, employeeId: employeeId }
            ]
        });

        const existingStudentWithEmail = await Student.findOne({
            email: email
        });

        if (existingTeacher || existingStudentWithEmail) {
            return res.redirect("/admin/teachers?message=duplicate_teacher");
        }

        await Teacher.create({
            fullName: fullName,
            email: email,
            password: password,
            employeeId: employeeId,
            department: department,
            college: collegeId,
            role: role,
            subjects: [],
            attendanceSessions: [],
            isBlocked: false
        });

        res.redirect("/admin/teachers?message=created");

    } catch (err) {
        console.log("ADMIN CREATE TEACHER ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/teachers?message=error");
    }
});


router.post("/teachers/:id/update", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const teacherId = req.params.id;

        if (!isValidObjectId(teacherId)) {
            return res.redirect("/admin/teachers?message=invalid_id");
        }

        const fullName = cleanText(req.body.fullName);
        const email = cleanEmail(req.body.email);
        const employeeId = cleanUpper(req.body.employeeId);
        const department = cleanUpper(req.body.department);
        const role = cleanUpper(req.body.role || "TEACHER");
        const password = cleanText(req.body.password);

        if (!["TEACHER", "HOD"].includes(role)) {
            return res.redirect("/admin/teachers?message=invalid_role");
        }

        if (!fullName || !email || !employeeId || !department) {
            return res.redirect("/admin/teachers?message=invalid_input");
        }

        if (!isValidEmail(email)) {
            return res.redirect("/admin/teachers?message=invalid_email");
        }

        if (password && password.length < 6) {
            return res.redirect("/admin/teachers?message=weak_password");
        }

        const teacher = await Teacher.findOne({
            _id: teacherId,
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] }
        });

        if (!teacher) {
            return res.redirect("/admin/teachers?message=invalid_teacher");
        }

        const duplicateTeacher = await Teacher.findOne({
            _id: { $ne: teacherId },
            $or: [
                { email: email },
                { college: collegeId, employeeId: employeeId }
            ]
        });

        const duplicateStudentEmail = await Student.findOne({
            email: email
        });

        if (duplicateTeacher || duplicateStudentEmail) {
            return res.redirect("/admin/teachers?message=duplicate_teacher");
        }

        const updateData = {
            fullName: fullName,
            email: email,
            employeeId: employeeId,
            department: department,
            role: role
        };

        if (password) {
            updateData.password = password;
        }

        await Teacher.updateOne(
            {
                _id: teacherId,
                college: collegeId,
                role: { $in: ["TEACHER", "HOD"] }
            },
            {
                $set: updateData
            }
        );

        res.redirect("/admin/teachers?message=updated");

    } catch (err) {
        console.log("ADMIN UPDATE TEACHER ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/teachers?message=error");
    }
});

router.post("/teachers/:id/delete", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const teacherId = req.params.id;

        if (!isValidObjectId(teacherId)) {
            return res.redirect("/admin/teachers?message=invalid_id");
        }

        const teacher = await Teacher.findOne({
            _id: teacherId,
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] }
        });

        if (!teacher) {
            return res.redirect("/admin/teachers?message=invalid_teacher");
        }

        const hasSchedules = await Schedule.exists({
            college: collegeId,
            teacher: teacherId
        });

        const hasAttendanceSessions = await AttendanceSession.exists({
            college: collegeId,
            teacher: teacherId
        });

        if (hasSchedules || hasAttendanceSessions) {
            return res.redirect("/admin/teachers?message=in_use");
        }

        await Subject.updateMany(
            {
                college: collegeId
            },
            {
                $pull: { teachers: teacher._id }
            }
        );

        await Teacher.deleteOne({
            _id: teacherId,
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] }
        });

        res.redirect("/admin/teachers?message=deleted");

    } catch (err) {
        console.log("ADMIN DELETE TEACHER ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/teachers?message=error");
    }
});

/* ================= STUDENTS ================= */

router.get("/students", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const students = await Student.find({
            college: collegeId
        })
        .populate("classGroup")
        .sort({
            fullName: 1
        });

        const classGroups = await ClassGroup.find({
            college: collegeId,
            isActive: true
        }).sort({
            department: 1,
            semester: 1,
            section: 1
        });

        res.render("admin/students", {
            admin: req.user,
            students: students,
            classGroups: classGroups,
            message: getFlashMessage(req.query.message),
            csvImportResult: getStudentImportResult(req),
            error: null,
            activePage: "students",
        });

    } catch (err) {
        console.log("ADMIN STUDENTS ERROR:");
        console.log(err.message);
        res.send("Students error: " + err.message);
    }
});

router.post("/students/create", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const fullName = cleanText(req.body.fullName);
        const email = cleanEmail(req.body.email);
        const password = cleanText(req.body.password);
        const enrollmentNumber = cleanUpper(req.body.enrollmentNumber);
        const department = cleanUpper(req.body.department);
        const semester = Number(req.body.semester);
        const classGroupId = req.body.classGroupId;

        if (
            !fullName ||
            !email ||
            !password ||
            !enrollmentNumber ||
            !department ||
            !isValidSemester(semester) ||
            !isValidObjectId(classGroupId)
        ) {
            return res.redirect("/admin/students?message=invalid_input");
        }

        if (!isValidEmail(email)) {
            return res.redirect("/admin/students?message=invalid_email");
        }

        if (password.length < 6) {
            return res.redirect("/admin/students?message=weak_password");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId,
            isActive: true
        });

        if (!classGroup) {
            return res.redirect("/admin/students?message=invalid_class_group");
        }

        const existingStudent = await Student.findOne({
            $or: [
                { email: email },
                { college: collegeId, enrollmentNumber: enrollmentNumber }
            ]
        });

        const existingTeacherWithEmail = await Teacher.findOne({
            email: email
        });

        if (existingStudent || existingTeacherWithEmail) {
            return res.redirect("/admin/students?message=duplicate_student");
        }

        const subjectsInGroup = await Subject.find({
            college: collegeId,
            classGroup: classGroupId,
            isActive: true
        });

        const subjectIds = subjectsInGroup.map(function (subject) {
            return subject._id;
        });

        const student = await Student.create({
            fullName: fullName,
            email: email,
            password: password,
            enrollmentNumber: enrollmentNumber,
            department: department,
            semester: semester,
            college: collegeId,
            classGroup: classGroupId,
            subjects: subjectIds,
            isBlocked: false
        });

        await ClassGroup.updateOne(
            {
                _id: classGroupId,
                college: collegeId
            },
            {
                $addToSet: { students: student._id }
            }
        );

        await Subject.updateMany(
            {
                _id: { $in: subjectIds },
                college: collegeId
            },
            {
                $addToSet: { students: student._id }
            }
        );

        res.redirect("/admin/students?message=created");

    } catch (err) {
        console.log("ADMIN CREATE STUDENT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/students?message=error");
    }
});

router.post("/students/:id/update", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const studentId = req.params.id;

        if (!isValidObjectId(studentId)) {
            return res.redirect("/admin/students?message=invalid_id");
        }

        const fullName = cleanText(req.body.fullName);
        const email = cleanEmail(req.body.email);
        const password = cleanText(req.body.password);
        const enrollmentNumber = cleanUpper(req.body.enrollmentNumber);
        const department = cleanUpper(req.body.department);
        const semester = Number(req.body.semester);
        const classGroupId = req.body.classGroupId;

        if (
            !fullName ||
            !email ||
            !enrollmentNumber ||
            !department ||
            !isValidSemester(semester) ||
            !isValidObjectId(classGroupId)
        ) {
            return res.redirect("/admin/students?message=invalid_input");
        }

        if (!isValidEmail(email)) {
            return res.redirect("/admin/students?message=invalid_email");
        }

        if (password && password.length < 6) {
            return res.redirect("/admin/students?message=weak_password");
        }

        const student = await Student.findOne({
            _id: studentId,
            college: collegeId
        });

        if (!student) {
            return res.redirect("/admin/students?message=invalid_id");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId,
            isActive: true
        });

        if (!classGroup) {
            return res.redirect("/admin/students?message=invalid_class_group");
        }

        const duplicateStudent = await Student.findOne({
            _id: { $ne: studentId },
            $or: [
                { email: email },
                { college: collegeId, enrollmentNumber: enrollmentNumber }
            ]
        });

        const duplicateTeacherEmail = await Teacher.findOne({
            email: email
        });

        if (duplicateStudent || duplicateTeacherEmail) {
            return res.redirect("/admin/students?message=duplicate_student");
        }

        const oldClassGroupId = student.classGroup ? student.classGroup.toString() : "";
        const newClassGroupId = classGroupId.toString();

        const isChangingClassGroup = oldClassGroupId !== newClassGroupId;

        if (isChangingClassGroup) {
            const hasAttendanceRecords = await AttendanceRecord.exists({
                college: collegeId,
                student: studentId
            });

            if (hasAttendanceRecords) {
                return res.redirect("/admin/students?message=in_use");
            }
        }

        const subjectsInNewClass = await Subject.find({
            college: collegeId,
            classGroup: classGroupId,
            isActive: true
        });

        const newSubjectIds = subjectsInNewClass.map(function (subject) {
            return subject._id;
        });

        const updateData = {
            fullName: fullName,
            email: email,
            enrollmentNumber: enrollmentNumber,
            department: department,
            semester: semester,
            classGroup: classGroupId,
            subjects: newSubjectIds
        };

        if (password) {
            updateData.password = password;
        }

        await Student.updateOne(
            {
                _id: studentId,
                college: collegeId
            },
            {
                $set: updateData
            }
        );

        if (isChangingClassGroup) {
            await ClassGroup.updateMany(
                {
                    college: collegeId
                },
                {
                    $pull: { students: student._id }
                }
            );

            await Subject.updateMany(
                {
                    college: collegeId
                },
                {
                    $pull: { students: student._id }
                }
            );

            await ClassGroup.updateOne(
                {
                    _id: classGroupId,
                    college: collegeId
                },
                {
                    $addToSet: { students: student._id }
                }
            );

            await Subject.updateMany(
                {
                    _id: { $in: newSubjectIds },
                    college: collegeId
                },
                {
                    $addToSet: { students: student._id }
                }
            );
        }

        res.redirect("/admin/students?message=updated");

    } catch (err) {
        console.log("ADMIN UPDATE STUDENT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/students?message=error");
    }
});


router.post("/students/:id/delete", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const studentId = req.params.id;

        if (!isValidObjectId(studentId)) {
            return res.redirect("/admin/students?message=invalid_id");
        }

        const student = await Student.findOne({
            _id: studentId,
            college: collegeId
        });

        if (!student) {
            return res.redirect("/admin/students?message=invalid_id");
        }

        const hasAttendanceRecords = await AttendanceRecord.exists({
            college: collegeId,
            student: studentId
        });

        if (hasAttendanceRecords) {
            return res.redirect("/admin/students?message=in_use");
        }

        await ClassGroup.updateOne(
            {
                _id: student.classGroup,
                college: collegeId
            },
            {
                $pull: { students: student._id }
            }
        );

        await Subject.updateMany(
            {
                college: collegeId
            },
            {
                $pull: { students: student._id }
            }
        );

        await Student.deleteOne({
            _id: studentId,
            college: collegeId
        });

        res.redirect("/admin/students?message=deleted");

    } catch (err) {
        console.log("ADMIN DELETE STUDENT ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/students?message=error");
    }
});

/* ================= SCHEDULES ================= */

router.get("/schedules", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const schedules = await Schedule.find({
            college: collegeId
        })
        .populate("subject")
        .populate("teacher")
        .populate("classGroup")
        .populate("classroom");

        sortSchedulesByDayAndTime(schedules);

        const classGroups = await ClassGroup.find({
            college: collegeId,
            isActive: true
        }).sort({
            department: 1,
            semester: 1,
            section: 1
        });

        const subjects = await Subject.find({
            college: collegeId,
            isActive: true
        })
        .populate("classGroup")
        .populate("teachers")
        .sort({
            subjectName: 1
        });

        const teachers = await Teacher.find({
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] },
            isBlocked: false
        }).sort({
            fullName: 1
        });

        const classrooms = await Classroom.find({
            college: collegeId
        }).sort({
            classroomName: 1
        });

        const days = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];

        res.render("admin/schedules", {
            admin: req.user,
            schedules: schedules,
            classGroups: classGroups,
            subjects: subjects,
            teachers: teachers,
            classrooms: classrooms,
            days: days,
            message: getFlashMessage(req.query.message),
            error: null,
            activePage: "schedules"
        });

    } catch (err) {
        console.log("ADMIN SCHEDULES ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.send("Schedules error: " + err.message);
    }
});

router.post("/schedules/create", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const classGroupId = req.body.classGroupId;
        const subjectId = req.body.subjectId;
        const teacherId = req.body.teacherId;
        const classroomId = req.body.classroomId;
        const day = cleanText(req.body.day);
        const startTime = cleanText(req.body.startTime);
        const endTime = cleanText(req.body.endTime);

        const validDays = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday"
        ];

        if (
            !isValidObjectId(classGroupId) ||
            !isValidObjectId(subjectId) ||
            !isValidObjectId(teacherId) ||
            !isValidObjectId(classroomId) ||
            !validDays.includes(day)
        ) {
            return res.redirect("/admin/schedules?message=invalid_input");
        }

        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);

        if (
            startMinutes === null ||
            endMinutes === null ||
            endMinutes <= startMinutes
        ) {
            return res.redirect("/admin/schedules?message=invalid_time");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId,
            isActive: true
        });

        if (!classGroup) {
            return res.redirect("/admin/schedules?message=invalid_class_group");
        }

        const classroom = await Classroom.findOne({
            _id: classroomId,
            college: collegeId
        });

        if (!classroom) {
            return res.redirect("/admin/schedules?message=invalid_classroom");
        }

        const teacher = await Teacher.findOne({
            _id: teacherId,
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] },
            isBlocked: false
        });

        if (!teacher) {
            return res.redirect("/admin/schedules?message=invalid_teacher");
        }

        const subject = await Subject.findOne({
            _id: subjectId,
            college: collegeId,
            classGroup: classGroupId,
            isActive: true
        });

        if (!subject) {
            return res.redirect("/admin/schedules?message=invalid_subject");
        }

        let teacherAssigned = false;

        for (let i = 0; i < subject.teachers.length; i++) {
            if (subject.teachers[i].toString() === teacherId.toString()) {
                teacherAssigned = true;
            }
        }

        if (!teacherAssigned) {
            return res.redirect("/admin/schedules?message=teacher_not_assigned");
        }

        const sameDaySchedules = await Schedule.find({
            college: collegeId,
            day: day
        });

        for (let i = 0; i < sameDaySchedules.length; i++) {
            const oldSchedule = sameDaySchedules[i];

            const oldStart = timeToMinutes(oldSchedule.startTime);
            const oldEnd = timeToMinutes(oldSchedule.endTime);

            if (oldStart === null || oldEnd === null) {
                continue;
            }

            const isOverlapping = startMinutes < oldEnd && endMinutes > oldStart;

            if (
                isOverlapping &&
                oldSchedule.teacher.toString() === teacherId.toString()
            ) {
                return res.redirect("/admin/schedules?message=teacher_clash");
            }

            if (
                isOverlapping &&
                oldSchedule.classGroup.toString() === classGroupId.toString()
            ) {
                return res.redirect("/admin/schedules?message=class_clash");
            }

            if (
                isOverlapping &&
                oldSchedule.classroom.toString() === classroomId.toString()
            ) {
                return res.redirect("/admin/schedules?message=room_clash");
            }
        }

        await Schedule.create({
            college: collegeId,
            classGroup: classGroupId,
            subject: subjectId,
            teacher: teacherId,
            classroom: classroomId,
            day: day,
            startTime: startTime,
            endTime: endTime
        });

        res.redirect("/admin/schedules?message=created");

    } catch (err) {
        console.log("ADMIN CREATE SCHEDULE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/schedules?message=error");
    }
});


router.get("/students/import-template", isCollegeAdmin, function (req, res) {
    const csvRows = [
        [
            "fullName",
            "email",
            "password",
            "enrollmentNumber",
            "department",
            "semester",
            "section"
        ],
        [
            "Harsh Koli",
            "harsh@gmail.com",
            "harsh123",
            "22AIML001",
            "AIML",
            "4",
            "A"
        ],
        [
            "Rahul Sharma",
            "rahul@gmail.com",
            "rahul123",
            "22AIML002",
            "AIML",
            "4",
            "A"
        ]
    ];

    const csvContent = csvRows.map(function (row) {
        return row.map(csvEscape).join(",");
    }).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
        "Content-Disposition",
        "attachment; filename=students-import-format.csv"
    );

    res.send(csvContent);
});

router.get("/students/export", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);

        const students = await Student.find({
            college: collegeId
        })
            .populate("classGroup")
            .sort({
                department: 1,
                semester: 1,
                enrollmentNumber: 1
            });

        const csvRows = [];

        csvRows.push([
            "fullName",
            "email",
            "enrollmentNumber",
            "department",
            "semester",
            "section",
            "classGroupName",
            "isBlocked",
            "createdAt"
        ]);

        students.forEach(function (student) {
            csvRows.push([
                student.fullName,
                student.email,
                student.enrollmentNumber,
                student.department,
                student.semester,
                student.classGroup ? student.classGroup.section : "",
                student.classGroup ? student.classGroup.name : "",
                student.isBlocked ? "YES" : "NO",
                student.createdAt ? student.createdAt.toISOString() : ""
            ]);
        });

        const csvContent = csvRows.map(function (row) {
            return row.map(csvEscape).join(",");
        }).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=students-export.csv"
        );

        res.send(csvContent);

    } catch (err) {
        console.log("ADMIN EXPORT STUDENTS ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/students?message=error");
    }
});

router.post(
    "/students/import",
    isCollegeAdmin,
    uploadStudentsCsv.single("studentsCsv"),
    async function (req, res) {
        try {
            const collegeId = getCollegeId(req);

            if (!req.file) {
                setStudentImportResult(req, {
                    type: "error",
                    title: "Import Failed",
                    message: "Please upload a CSV file.",
                    errors: []
                });

                return res.redirect("/admin/students");
            }

            const csvText = req.file.buffer.toString("utf8");
            const parsedCsv = parseStudentsCsv(csvText);

            if (parsedCsv.errors.length > 0) {
                setStudentImportResult(req, {
                    type: "error",
                    title: "Invalid CSV Format",
                    message: "Please fix the CSV header.",
                    errors: parsedCsv.errors
                });

                return res.redirect("/admin/students");
            }

            const rows = parsedCsv.rows;
            const validationErrors = [];

            const emailSet = new Set();
            const enrollmentSet = new Set();

            const preparedStudents = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                const fullName = csvCleanText(row.fullName);
                const email = csvCleanEmail(row.email);
                const password = csvCleanText(row.password);
                const enrollmentNumber = csvCleanUpper(row.enrollmentNumber);
                const department = csvCleanUpper(row.department);
                const semester = Number(row.semester);
                const section = csvCleanUpper(row.section);

                if (!fullName) {
                    validationErrors.push("Row " + row.rowNumber + ": Full name is required.");
                }

                if (!email || !csvIsValidEmail(email)) {
                    validationErrors.push("Row " + row.rowNumber + ": Valid email is required.");
                }

                if (!password || password.length < 6) {
                    validationErrors.push("Row " + row.rowNumber + ": Password must be at least 6 characters.");
                }

                if (!enrollmentNumber) {
                    validationErrors.push("Row " + row.rowNumber + ": Enrollment number is required.");
                }

                if (!department) {
                    validationErrors.push("Row " + row.rowNumber + ": Department is required.");
                }

                if (!Number.isInteger(semester) || semester < 1 || semester > 12) {
                    validationErrors.push("Row " + row.rowNumber + ": Semester must be between 1 and 12.");
                }

                if (!section) {
                    validationErrors.push("Row " + row.rowNumber + ": Section is required.");
                }

                if (emailSet.has(email)) {
                    validationErrors.push("Row " + row.rowNumber + ": Duplicate email inside CSV.");
                }

                if (enrollmentSet.has(enrollmentNumber)) {
                    validationErrors.push("Row " + row.rowNumber + ": Duplicate enrollment number inside CSV.");
                }

                emailSet.add(email);
                enrollmentSet.add(enrollmentNumber);

                const classGroup = await ClassGroup.findOne({
                    college: collegeId,
                    department: department,
                    semester: semester,
                    section: section,
                    isActive: true
                });

                if (!classGroup) {
                    validationErrors.push(
                        "Row " +
                        row.rowNumber +
                        ": Class Group not found for " +
                        department +
                        " Sem " +
                        semester +
                        " Section " +
                        section +
                        ". Create this class group first."
                    );
                }

                preparedStudents.push({
                    rowNumber: row.rowNumber,
                    fullName: fullName,
                    email: email,
                    password: password,
                    enrollmentNumber: enrollmentNumber,
                    department: department,
                    semester: semester,
                    section: section,
                    classGroup: classGroup
                });
            }

            const emails = Array.from(emailSet);
            const enrollments = Array.from(enrollmentSet);

            const existingStudentsByEmail = await Student.find({
                email: {
                    $in: emails
                }
            });

            if (existingStudentsByEmail.length > 0) {
                existingStudentsByEmail.forEach(function (student) {
                    validationErrors.push(
                        "Email already exists: " + student.email
                    );
                });
            }

            const existingStudentsByEnrollment = await Student.find({
                college: collegeId,
                enrollmentNumber: {
                    $in: enrollments
                }
            });

            if (existingStudentsByEnrollment.length > 0) {
                existingStudentsByEnrollment.forEach(function (student) {
                    validationErrors.push(
                        "Enrollment number already exists: " + student.enrollmentNumber
                    );
                });
            }

            const existingTeachersByEmail = await Teacher.find({
                email: {
                    $in: emails
                }
            });

            if (existingTeachersByEmail.length > 0) {
                existingTeachersByEmail.forEach(function (teacher) {
                    validationErrors.push(
                        "Email already used by teacher/admin: " + teacher.email
                    );
                });
            }

            if (validationErrors.length > 0) {
                setStudentImportResult(req, {
                    type: "error",
                    title: "Import Failed",
                    message: "No students were imported. Fix these errors and upload again.",
                    errors: validationErrors.slice(0, 50)
                });

                return res.redirect("/admin/students");
            }

            let importedCount = 0;

            for (let i = 0; i < preparedStudents.length; i++) {
                const item = preparedStudents[i];

                const subjectsInGroup = await Subject.find({
                    college: collegeId,
                    classGroup: item.classGroup._id,
                    isActive: true
                });

                const subjectIds = subjectsInGroup.map(function (subject) {
                    return subject._id;
                });

                const student = await Student.create({
                    fullName: item.fullName,
                    email: item.email,
                    password: item.password,
                    enrollmentNumber: item.enrollmentNumber,
                    department: item.department,
                    semester: item.semester,
                    college: collegeId,
                    classGroup: item.classGroup._id,
                    subjects: subjectIds
                });

                await ClassGroup.updateOne(
                    {
                        _id: item.classGroup._id,
                        college: collegeId
                    },
                    {
                        $addToSet: {
                            students: student._id
                        }
                    }
                );

                await Subject.updateMany(
                    {
                        _id: {
                            $in: subjectIds
                        },
                        college: collegeId
                    },
                    {
                        $addToSet: {
                            students: student._id
                        }
                    }
                );

                importedCount++;
            }

            setStudentImportResult(req, {
                type: "success",
                title: "Import Successful",
                message: importedCount + " students imported successfully.",
                errors: []
            });

            res.redirect("/admin/students");

        } catch (err) {
            console.log("ADMIN IMPORT STUDENTS ERROR:");
            console.log(err.message);
            console.log(err.stack);

            setStudentImportResult(req, {
                type: "error",
                title: "Import Failed",
                message: "Import error: " + err.message,
                errors: []
            });

            res.redirect("/admin/students");
        }
    }
);

router.post("/schedules/:id/update", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const scheduleId = req.params.id;

        if (!isValidObjectId(scheduleId)) {
            return res.redirect("/admin/schedules?message=invalid_id");
        }

        const day = cleanText(req.body.day);
        const startTime = cleanText(req.body.startTime);
        const endTime = cleanText(req.body.endTime);
        const classGroupId = req.body.classGroupId;
        const subjectId = req.body.subjectId;
        const teacherId = req.body.teacherId;
        const classroomId = req.body.classroomId;

        const validDays = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday"
        ];

        if (
            !validDays.includes(day) ||
            !startTime ||
            !endTime ||
            !isValidObjectId(classGroupId) ||
            !isValidObjectId(subjectId) ||
            !isValidObjectId(teacherId) ||
            !isValidObjectId(classroomId)
        ) {
            return res.redirect("/admin/schedules?message=invalid_input");
        }

        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);

        if (
            startMinutes === null ||
            endMinutes === null ||
            endMinutes <= startMinutes
        ) {
            return res.redirect("/admin/schedules?message=invalid_time");
        }

        const schedule = await Schedule.findOne({
            _id: scheduleId,
            college: collegeId
        });

        if (!schedule) {
            return res.redirect("/admin/schedules?message=invalid_schedule");
        }

        const attendanceExists = await AttendanceSession.exists({
            college: collegeId,
            schedule: scheduleId
        });

        if (attendanceExists) {
            return res.redirect("/admin/schedules?message=in_use");
        }

        const classGroup = await ClassGroup.findOne({
            _id: classGroupId,
            college: collegeId,
            isActive: true
        });

        if (!classGroup) {
            return res.redirect("/admin/schedules?message=invalid_class_group");
        }

        const subject = await Subject.findOne({
            _id: subjectId,
            college: collegeId,
            isActive: true
        }).populate("teachers");

        if (!subject) {
            return res.redirect("/admin/schedules?message=invalid_subject");
        }

        const subjectClassGroupId = subject.classGroup
            ? subject.classGroup.toString()
            : "";

        if (subjectClassGroupId !== classGroupId.toString()) {
            return res.redirect("/admin/schedules?message=invalid_subject_class");
        }

        const teacher = await Teacher.findOne({
            _id: teacherId,
            college: collegeId,
            role: { $in: ["TEACHER", "HOD"] },
            isBlocked: { $ne: true }
        });

        if (!teacher) {
            return res.redirect("/admin/schedules?message=invalid_teacher");
        }

        const teacherAssignedToSubject = subject.teachers.some(function (subjectTeacher) {
            return subjectTeacher._id.toString() === teacherId.toString();
        });

        if (!teacherAssignedToSubject) {
            return res.redirect("/admin/schedules?message=teacher_not_assigned");
        }

        const classroom = await Classroom.findOne({
            _id: classroomId,
            college: collegeId
        });

        if (!classroom) {
            return res.redirect("/admin/schedules?message=invalid_classroom");
        }

        const possibleConflicts = await Schedule.find({
            _id: { $ne: scheduleId },
            college: collegeId,
            day: day,
            $or: [
                { teacher: teacherId },
                { classGroup: classGroupId },
                { classroom: classroomId }
            ]
        });

        for (let i = 0; i < possibleConflicts.length; i++) {
            const existingSchedule = possibleConflicts[i];

            const existingStartMinutes = timeToMinutes(existingSchedule.startTime);
            const existingEndMinutes = timeToMinutes(existingSchedule.endTime);

            const isOverlapping =
                startMinutes < existingEndMinutes &&
                existingStartMinutes < endMinutes;

            if (isOverlapping) {
                if (existingSchedule.teacher.toString() === teacherId.toString()) {
                    return res.redirect("/admin/schedules?message=teacher_conflict");
                }

                if (existingSchedule.classGroup.toString() === classGroupId.toString()) {
                    return res.redirect("/admin/schedules?message=class_conflict");
                }

                if (existingSchedule.classroom.toString() === classroomId.toString()) {
                    return res.redirect("/admin/schedules?message=classroom_conflict");
                }
            }
        }

        await Schedule.updateOne(
            {
                _id: scheduleId,
                college: collegeId
            },
            {
                $set: {
                    day: day,
                    startTime: startTime,
                    endTime: endTime,
                    classGroup: classGroupId,
                    subject: subjectId,
                    teacher: teacherId,
                    classroom: classroomId
                }
            }
        );

        res.redirect("/admin/schedules?message=updated");

    } catch (err) {
        console.log("ADMIN UPDATE SCHEDULE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/schedules?message=error");
    }
});

router.post("/schedules/:id/delete", isCollegeAdmin, async function (req, res) {
    try {
        const collegeId = getCollegeId(req);
        const scheduleId = req.params.id;

        if (!isValidObjectId(scheduleId)) {
            return res.redirect("/admin/schedules?message=invalid_id");
        }

        const schedule = await Schedule.findOne({
            _id: scheduleId,
            college: collegeId
        });

        if (!schedule) {
            return res.redirect("/admin/schedules?message=invalid_id");
        }

        const hasAttendanceSessions = await AttendanceSession.exists({
            college: collegeId,
            schedule: scheduleId
        });

        if (hasAttendanceSessions) {
            return res.redirect("/admin/schedules?message=in_use");
        }

        await Schedule.deleteOne({
            _id: scheduleId,
            college: collegeId
        });

        res.redirect("/admin/schedules?message=deleted");

    } catch (err) {
        console.log("ADMIN DELETE SCHEDULE ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/admin/schedules?message=error");
    }
});

module.exports = router;