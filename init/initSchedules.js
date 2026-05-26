require("dotenv").config();

const mongoose = require("mongoose");

const Schedule = require("../models/scheduleSchema");
const College = require("../models/collegeSchema");
const ClassGroup = require("../models/classGroupSchema");
const Subject = require("../models/subjectSchema");
const Teacher = require("../models/teacherSchema");
const Classroom = require("../models/classroomSchema");
const connectDB = require("../config/db");

const initSchedules = async () => {
    try {
        await connectDB();

        await Schedule.deleteMany({});

        const college = await College.findOne({
            collegeCode: process.env.SEED_COLLEGE_CODE || "MIT001"
        });

        const classGroup = await ClassGroup.findOne({
            name: process.env.SEED_CLASS_GROUP_NAME || "CSE 4A"
        });

        const teacher = await Teacher.findOne({
            email: process.env.SEED_TEACHER_EMAIL || "aman@college.com"
        });

        const classroom = await Classroom.findOne({
            classroomName: process.env.SEED_CLASSROOM_NAME || "Room 101"
        });

        const dbms = await Subject.findOne({ subjectCode: "CS401" });
        const os = await Subject.findOne({ subjectCode: "CS402" });

        if (!college || !classGroup || !teacher || !classroom || !dbms || !os) {
            throw new Error("Missing seed data. Please check college, class group, teacher, classroom, and subjects.");
        }

        const schedules = [
            {
                college: college._id,
                classGroup: classGroup._id,
                subject: dbms._id,
                teacher: teacher._id,
                classroom: classroom._id,
                day: "Friday",
                startTime: "09:00 AM",
                endTime: "10:00 AM"
            },
            {
                college: college._id,
                classGroup: classGroup._id,
                subject: os._id,
                teacher: teacher._id,
                classroom: classroom._id,
                day: "Friday",
                startTime: "10:15 AM",
                endTime: "11:15 AM"
            },
            {
                college: college._id,
                classGroup: classGroup._id,
                subject: dbms._id,
                teacher: teacher._id,
                classroom: classroom._id,
                day: "Friday",
                startTime: "12:30 PM",
                endTime: "01:30 PM"
            }
        ];

        await Schedule.insertMany(schedules);

        console.log("Schedules inserted successfully");

        await mongoose.connection.close();

    } catch (err) {
        console.log("INIT SCHEDULES ERROR:");
        console.log(err.message);
        console.log(err.stack);

        await mongoose.connection.close();
    }
};

initSchedules();