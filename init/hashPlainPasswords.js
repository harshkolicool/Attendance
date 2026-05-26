const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const connectDB = require("../config/db");
const Teacher = require("../models/teacherSchema");
const Student = require("../models/studentSchema");

function isBcryptHash(value) {
    return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

async function hashPlainTeacherPasswords() {
    const teachers = await Teacher.find({});
    let updatedCount = 0;

    for (let i = 0; i < teachers.length; i++) {
        const teacher = teachers[i];

        if (!teacher.password || isBcryptHash(teacher.password)) {
            continue;
        }

        const hashedPassword = await bcrypt.hash(teacher.password, 10);

        await Teacher.updateOne(
            { _id: teacher._id },
            {
                $set: {
                    password: hashedPassword
                }
            }
        );

        updatedCount++;
    }

    return updatedCount;
}

async function hashPlainStudentPasswords() {
    const students = await Student.find({});
    let updatedCount = 0;

    for (let i = 0; i < students.length; i++) {
        const student = students[i];

        if (!student.password || isBcryptHash(student.password)) {
            continue;
        }

        const hashedPassword = await bcrypt.hash(student.password, 10);

        await Student.updateOne(
            { _id: student._id },
            {
                $set: {
                    password: hashedPassword
                }
            }
        );

        updatedCount++;
    }

    return updatedCount;
}

async function runMigration() {
    try {
        await connectDB();

        const updatedTeachers = await hashPlainTeacherPasswords();
        const updatedStudents = await hashPlainStudentPasswords();

        console.log("Plain teacher/admin passwords hashed:", updatedTeachers);
        console.log("Plain student passwords hashed:", updatedStudents);

    } catch (err) {
        console.log("PASSWORD HASH MIGRATION ERROR:");
        console.log(err.message);
        console.log(err.stack);
    } finally {
        await mongoose.connection.close();
    }
}

runMigration();