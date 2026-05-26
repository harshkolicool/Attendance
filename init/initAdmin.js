require("dotenv").config();

const mongoose = require("mongoose");
const Teacher = require("../models/teacherSchema");
const College = require("../models/collegeSchema");
const connectDB = require("../config/db");

async function initAdmin() {
    try {
        await connectDB();

        const adminEmail = process.env.SEED_COLLEGE_ADMIN_EMAIL || "admin@college.com";
        const adminPassword = process.env.SEED_COLLEGE_ADMIN_PASSWORD;
        const collegeCode = process.env.SEED_COLLEGE_CODE || "MIT001";

        if (!adminPassword) {
            throw new Error("SEED_COLLEGE_ADMIN_PASSWORD is missing in .env file");
        }

        const college = await College.findOne({ collegeCode: collegeCode });

        if (!college) {
            console.log("College " + collegeCode + " not found. Create a college first.");
            await mongoose.connection.close();
            return;
        }

        const aman = await Teacher.findOne({ email: "aman@college.com" });

        if (aman) {
            aman.role = "ADMIN";
            await aman.save();
            console.log("Updated aman@college.com to ADMIN role");
        }

        let adminUser = await Teacher.findOne({ email: adminEmail });

        if (!adminUser) {
            adminUser = await Teacher.create({
                fullName: "College Admin",
                email: adminEmail,
                password: adminPassword,
                employeeId: "ADMIN001",
                department: "CSE",
                college: college._id,
                role: "ADMIN",
                subjects: []
            });

            console.log("Created college admin:", adminEmail);
        } else {
            adminUser.role = "ADMIN";
            adminUser.college = college._id;
            await adminUser.save();
            console.log("Updated existing college admin:", adminEmail);
        }

        console.log("Admin setup complete");
        await mongoose.connection.close();

    } catch (err) {
        console.log("INIT ADMIN ERROR:", err.message);
        console.log(err.stack);
        await mongoose.connection.close();
    }
}

initAdmin();