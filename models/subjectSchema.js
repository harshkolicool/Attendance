const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema({

    subjectName: {
        type: String,
        required: true,
        trim: true,
        uppercase: true
    },

    subjectCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },

    department: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },

    semester: {
        type: Number,
        required: true
    },

    college: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "College",
        required: true
    },

    classGroup: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ClassGroup",
        required: true
    },

    teachers: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Teacher"
        }
    ],

    students: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Student"
        }
    ],

    attendanceSessions: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AttendanceSession"
        }
    ],

    isActive: {
        type: Boolean,
        default: true
    }

}, {
    timestamps: true
});

subjectSchema.index(
    { college: 1, classGroup: 1, subjectCode: 1 },
    { unique: true }
);

const Subject = mongoose.models.Subject || mongoose.model("Subject", subjectSchema);

module.exports = Subject;