const mongoose = require("mongoose");

const passkeySetupRequestSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Student",
            required: true
        },

        college: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "College",
            required: true
        },

        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Student",
            required: true
        },

        status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED"],
            default: "PENDING"
        },

        requestedAt: {
            type: Date,
            default: Date.now
        },

        reviewedAt: {
            type: Date
        },

        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Teacher"
        },

        reviewNote: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
);

passkeySetupRequestSchema.index({
    college: 1,
    status: 1,
    createdAt: -1
});

passkeySetupRequestSchema.index(
    {
        student: 1,
        status: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            status: "PENDING"
        }
    }
);

passkeySetupRequestSchema.index({
    requestedBy: 1,
    createdAt: -1
});

const PasskeySetupRequest = mongoose.models.PasskeySetupRequest || mongoose.model(
    "PasskeySetupRequest",
    passkeySetupRequestSchema
);

module.exports = PasskeySetupRequest;
