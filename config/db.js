require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;

        if (!mongoUri) {
            throw new Error("MONGO_URI is missing in .env file");
        }

        await mongoose.connect(mongoUri);

        console.log("MongoDB Connected");

    } catch (err) {
        console.log("MongoDB Error:", err.message);
        console.log(err.stack);
        process.exit(1);
    }
};

module.exports = connectDB;