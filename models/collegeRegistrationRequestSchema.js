const mongoose = require("mongoose");

const collegeRegistrationRequestSchema = new mongoose.Schema({

    collegeName: {
        type: String,
        required: true,
        trim: true
    },

    address: {
        type: String,
        required: true,
        trim: true
    },

    city: {
        type: String,
        required: true,
        trim: true
    },

    state: {
        type: String,
        required: true,
        trim: true
    },

    adminFullName: {
        type: String,
        required: true,
        trim: true
    },

    adminEmail: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },

    adminPhone: {
        type: String,
        required: true,
        trim: true
    },

    status: {
        type: String,
        enum: ["PENDING", "APPROVED", "REJECTED"],
        default: "PENDING"
    },

    generatedCollegeCode: {
        type: String,
        trim: true,
        uppercase: true
    },

    generatedAdminEmployeeId: {
        type: String,
        trim: true,
        uppercase: true
    },

    createdCollege: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "College"
    },

    createdAdmin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher"
    },

    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PlatformAdmin"
    },

    reviewedAt: {
        type: Date
    },

    rejectionReason: {
        type: String,
        trim: true
    }

}, {
    timestamps: true
});

collegeRegistrationRequestSchema.index({
    adminEmail: 1,
    status: 1
});

collegeRegistrationRequestSchema.index({
    collegeName: 1,
    city: 1,
    state: 1,
    status: 1
});

const CollegeRegistrationRequest = mongoose.models.CollegeRegistrationRequest || mongoose.model(
    "CollegeRegistrationRequest",
    collegeRegistrationRequestSchema
);

module.exports = CollegeRegistrationRequest;