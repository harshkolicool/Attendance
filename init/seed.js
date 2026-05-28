const mongoose = require("mongoose");

const College = require("../models/collegeSchema");
const ClassGroup = require("../models/classGroupSchema");
const Classroom = require("../models/classroomSchema");
const Teacher = require("../models/teacherSchema");
const Student = require("../models/studentSchema");
const Subject = require("../models/subjectSchema");
const Schedule = require("../models/scheduleSchema");
const AttendanceSession = require("../models/attendanceSessionSchema");
const AttendanceRecord = require("../models/attendanceRecordSchema");

mongoose.connect("mongodb://127.0.0.1:27017/attendance-app")
    .then(function () {
        console.log("MongoDB Connected");
    })
    .catch(function (err) {
        console.log("MongoDB Error:", err);
    });

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

function formatTime(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();

    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;

    if (hours === 0) {
        hours = 12;
    }

    const hourText = hours < 10 ? "0" + hours : "" + hours;
    const minuteText = minutes < 10 ? "0" + minutes : "" + minutes;

    return hourText + ":" + minuteText + " " + ampm;
}

function addMinutes(minutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date;
}

async function initData() {
    try {
        await AttendanceRecord.deleteMany({});
        await AttendanceSession.deleteMany({});
        await Schedule.deleteMany({});
        await Student.deleteMany({});
        await Teacher.deleteMany({});
        await Subject.deleteMany({});
        await Classroom.deleteMany({});
        await ClassGroup.deleteMany({});
        await College.deleteMany({});

        const college = await College.create({
            collegeName: "MIT College",
            collegeCode: "MIT001",
            address: "MG Road",
            city: "Bangalore",
            state: "Karnataka"
        });

        const classGroup = await ClassGroup.create({
            name: "CSE 4A",
            department: "CSE",
            semester: 4,
            section: "A",
            college: college._id,
            students: [],
            subjects: [],
            isActive: true
        });

        const classroom = await Classroom.create({
            classroomName: "Room 101",
            buildingName: "CS Block",
            floorNumber: 1,

            // For local testing keep radius bigger
            // Later you can make it 100
            latitude: 12.9716,
            longitude: 77.5946,
            radius: 1000,

            college: college._id,
            students: [],
            attendanceSessions: []
        });

        const teacher = new Teacher({
            fullName: "Aman Sir",
            email: "aman@college.com",
            password: "aman123",
            employeeId: "EMP101",
            department: "CSE",
            college: college._id,
            subjects: [],
            attendanceSessions: [],
            role: "TEACHER",
            isBlocked: false
        });

        await teacher.save();

        const admin = new Teacher({
            fullName: "College Admin",
            email: "admin@college.com",
            password: "admin123",
            employeeId: "ADMIN001",
            department: "CSE",
            college: college._id,
            subjects: [],
            attendanceSessions: [],
            role: "ADMIN",
            isBlocked: false
        });

        await admin.save();

        const dbms = await Subject.create({
            subjectName: "Database Management System",
            subjectCode: "CS401",
            department: "CSE",
            semester: 4,
            college: college._id,
            classGroup: classGroup._id,
            teachers: [teacher._id],
            students: [],
            attendanceSessions: [],
            isActive: true
        });

        const os = await Subject.create({
            subjectName: "Operating System",
            subjectCode: "CS402",
            department: "CSE",
            semester: 4,
            college: college._id,
            classGroup: classGroup._id,
            teachers: [teacher._id],
            students: [],
            attendanceSessions: [],
            isActive: true
        });

        teacher.subjects.push(dbms._id);
        teacher.subjects.push(os._id);
        await teacher.save();

        const harsh = new Student({
            fullName: "Harsh Koli",
            email: "harsh@gmail.com",
            password: "harsh123",
            enrollmentNumber: "22BCS101",
            department: "CSE",
            semester: 4,
            college: college._id,
            classGroup: classGroup._id,
            subjects: [dbms._id, os._id],
            isBlocked: false
        });

        await harsh.save();

        const rahul = new Student({
            fullName: "Rahul Verma",
            email: "rahul@gmail.com",
            password: "rahul123",
            enrollmentNumber: "22BCS102",
            department: "CSE",
            semester: 4,
            college: college._id,
            classGroup: classGroup._id,
            subjects: [dbms._id, os._id],
            isBlocked: false
        });

        await rahul.save();

        dbms.students.push(harsh._id);
        dbms.students.push(rahul._id);
        await dbms.save();

        os.students.push(harsh._id);
        os.students.push(rahul._id);
        await os.save();

        classGroup.students.push(harsh._id);
        classGroup.students.push(rahul._id);
        classGroup.subjects.push(dbms._id);
        classGroup.subjects.push(os._id);
        await classGroup.save();

        college.classrooms.push(classroom._id);
        college.students.push(harsh._id);
        college.students.push(rahul._id);
        college.teachers.push(teacher._id);
        college.teachers.push(admin._id);
        await college.save();

        const today = getTodayName();

        const liveStart = formatTime(addMinutes(-10));
        const liveEnd = formatTime(addMinutes(40));

        const futureStart = formatTime(addMinutes(60));
        const futureEnd = formatTime(addMinutes(120));

        await Schedule.create({
            college: college._id,
            classGroup: classGroup._id,
            subject: dbms._id,
            teacher: teacher._id,
            classroom: classroom._id,
            day: today,
            startTime: liveStart,
            endTime: liveEnd
        });

        await Schedule.create({
            college: college._id,
            classGroup: classGroup._id,
            subject: os._id,
            teacher: teacher._id,
            classroom: classroom._id,
            day: today,
            startTime: futureStart,
            endTime: futureEnd
        });

        console.log("Initial data inserted successfully");
        console.log("--------------------------------");
        console.log("Admin Login:");
        console.log("Email: admin@college.com");
        console.log("Password: admin123");
        console.log("--------------------------------");
        console.log("Teacher Login:");
        console.log("Email: aman@college.com");
        console.log("Password: aman123");
        console.log("--------------------------------");
        console.log("Student Login:");
        console.log("Email: harsh@gmail.com");
        console.log("Password: harsh123");
        console.log("--------------------------------");
        console.log("Second Student:");
        console.log("Email: rahul@gmail.com");
        console.log("Password: rahul123");
        console.log("--------------------------------");

        mongoose.connection.close();

    } catch (err) {
        console.log("Init Error:", err);
        mongoose.connection.close();
    }
}

initData();