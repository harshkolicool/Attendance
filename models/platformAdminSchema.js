const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const platformAdminSchema = new mongoose.Schema({

    fullName: {
        type: String,
        required: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    password: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ["SUPER_ADMIN"],
        default: "SUPER_ADMIN"
    },

    isBlocked: {
        type: Boolean,
        default: false
    },

    lastLogin: {
        type: Date
    }

}, {
    timestamps: true
});

platformAdminSchema.pre("save", async function () {
    if (!this.isModified("password")) {
        return;
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

platformAdminSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const PlatformAdmin = mongoose.model("PlatformAdmin", platformAdminSchema);

module.exports = PlatformAdmin;