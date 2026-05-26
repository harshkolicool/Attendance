const mongoose = require("mongoose");

const attendanceRecordSchema = new mongoose.Schema({

    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true
    },

    attendanceSession: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AttendanceSession",
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

    status: {
        type: String,
        enum: ["PRESENT", "ABSENT", "LATE", "EXCUSED"],
        default: "PRESENT"
    },

    latitude: {
        type: Number,
        required: true
    },

    longitude: {
        type: Number,
        required: true
    },

    distanceFromClassroom: {
        type: Number,
        default: 0
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

    deviceInfo: {
        userAgent: {
            type: String
        },

        ip: {
            type: String
        },

        browserFingerprint: String,
        gpsAccuracy: Number,
        teacherGpsAccuracy: Number,
        measuredDistanceFromClassroom: Number,
        verifiedDistanceFromClassroom: Number,
        allowedRadius: Number,
        radiusUncertaintyAllowance: Number,
        minimumPossibleDistance: Number,
        passkeyCredentialId: String
    },

    markedAt: {
        type: Date,
        default: Date.now
    }

}, {
    timestamps: true
});

attendanceRecordSchema.index(
    { student: 1, attendanceSession: 1 },
    { unique: true }
);

attendanceRecordSchema.index({
    college: 1,
    classGroup: 1,
    subject: 1,
    markedAt: 1
});

const AttendanceRecord = mongoose.models.AttendanceRecord || mongoose.model(
    "AttendanceRecord",
    attendanceRecordSchema
);

module.exports = AttendanceRecord;
