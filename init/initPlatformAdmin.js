require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const PlatformAdmin = require("../models/platformAdminSchema");

async function initializePlatformAdmin() {
    try {
        await connectDB();

        const platformAdminName = process.env.SEED_PLATFORM_ADMIN_NAME || "Platform Super Admin";
        const platformAdminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL || "superadmin@attendify.com";
        const platformAdminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD;

        if (!platformAdminPassword) {
            throw new Error("SEED_PLATFORM_ADMIN_PASSWORD is missing in .env file");
        }

        const existingPlatformAdmin = await PlatformAdmin.findOne({
            email: platformAdminEmail
        });

        if (existingPlatformAdmin) {
            console.log("Platform admin already exists:", platformAdminEmail);
            await mongoose.connection.close();
            return;
        }

        await PlatformAdmin.create({
            fullName: platformAdminName,
            email: platformAdminEmail,
            password: platformAdminPassword,
            role: "SUPER_ADMIN",
            isBlocked: false
        });

        console.log("Platform admin created successfully:", platformAdminEmail);

        await mongoose.connection.close();

    } catch (err) {
        console.log("INIT PLATFORM ADMIN ERROR:");
        console.log(err.message);
        console.log(err.stack);

        await mongoose.connection.close();
    }
}

initializePlatformAdmin();