const mongoose = require("mongoose");

const studentAttendanceSnapshotSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Student",
            required: true
        },

        fullName: {
            type: String,
            required: true
        },

        enrollmentNumber: {
            type: String,
            required: true
        },

        status: {
            type: String,
            enum: ["PRESENT", "ABSENT"],
            required: true
        },

        attendanceRecord: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AttendanceRecord"
        },

        markedAt: {
            type: Date,
            default: Date.now
        },

        verificationMethod: {
            type: String,
            enum: [
                "GEOLOCATION",
                "PASSKEY_GEOLOCATION",
                "TRUSTED_DEVICE_GEOLOCATION",
                "MANUAL",
                "AUTO_ABSENT"
            ],
            default: "GEOLOCATION"
        },

        distanceFromClassroom: {
            type: Number,
            default: 0
        }
    },
    {
        _id: false
    }
);

const attendanceSessionSchema = new mongoose.Schema({

    schedule: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Schedule"
    },

    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher",
        required: true
    },

    subject: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
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

    classroom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Classroom",
        required: true
    },

    latitude: {
        type: Number
    },

    longitude: {
        type: Number
    },

    teacherGpsAccuracy: {
        type: Number
    },

    locationSource: {
        type: String,
        enum: ["TEACHER_GPS"],
        default: "TEACHER_GPS"
    },

    radius: {
        type: Number,
        default: 100
    },



    startTime: {
        type: Date,
        default: Date.now
    },

    endTime: {
        type: Date,
        required: true
    },

    status: {
        type: String,
        enum: ["ACTIVE", "CLOSED", "EXPIRED", "CANCELLED"],
        default: "ACTIVE"
    },

    isActive: {
        type: Boolean,
        default: true
    },

    closedAt: {
        type: Date
    },

    expiredAt: {
        type: Date
    },

    absentsMarkedAt: {
        type: Date
    },

    closedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher"
    },

    attendanceRecords: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AttendanceRecord"
        }
    ],

    presentStudents: [studentAttendanceSnapshotSchema],

    absentStudents: [studentAttendanceSnapshotSchema],

    attendanceSummary: {
        totalPresent: {
            type: Number,
            default: 0
        },

        totalAbsent: {
            type: Number,
            default: 0
        },

        totalMarked: {
            type: Number,
            default: 0
        }
    }

}, {
    timestamps: true
});

attendanceSessionSchema.index({
    college: 1,
    classGroup: 1,
    classroom: 1,
    subject: 1,
    startTime: 1
});

attendanceSessionSchema.index({
    schedule: 1,
    teacher: 1,
    startTime: 1
});

const AttendanceSession = mongoose.models.AttendanceSession || mongoose.model(
    "AttendanceSession",
    attendanceSessionSchema
);

module.exports = AttendanceSession;