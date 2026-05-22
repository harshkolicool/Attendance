const mongoose = require("mongoose");
const connectDB = require("../config/db");
const PlatformAdmin = require("../models/platformAdminSchema");

async function initializePlatformAdmin() {
    try {
        await connectDB();

        const existingPlatformAdmin = await PlatformAdmin.findOne({
            email: "superadmin@attendify.com"
        });

        if (existingPlatformAdmin) {
            console.log("Platform admin already exists");
            console.log("Email: superadmin@attendify.com");
            await mongoose.connection.close();
            return;
        }

        await PlatformAdmin.create({
            fullName: "Platform Super Admin",
            email: "superadmin@attendify.com",
            password: "super123",
            role: "SUPER_ADMIN",
            isBlocked: false
        });

        console.log("Platform admin created successfully");
        console.log("Email: superadmin@attendify.com");
        console.log("Password: super123");

        await mongoose.connection.close();

    } catch (err) {
        console.log("INIT PLATFORM ADMIN ERROR:");
        console.log(err.message);
        console.log(err.stack);

        await mongoose.connection.close();
    }
}

initializePlatformAdmin();