const mongoose = require("mongoose");

const classroomSchema = new mongoose.Schema({

    classroomName: {
        type: String,
        required: true,
        trim: true
    },

    buildingName: {
        type: String,
        required: true,
        trim: true
    },

    floorNumber: {
        type: Number,
        required: true
    },

    radius: {
        type: Number,
        default: 100,
        min: 10,
        max: 10000
    },

    college: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "College",
        required: true
    },

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
    ]

}, {
    timestamps: true
});

classroomSchema.index(
    {
        college: 1,
        classroomName: 1,
        buildingName: 1,
        floorNumber: 1
    },
    {
        unique: true
    }
);

const Classroom = mongoose.model("Classroom", classroomSchema);

module.exports = Classroom;