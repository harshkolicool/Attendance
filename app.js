require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const passport = require("passport");
const helmet = require("helmet");

const connectDB = require("./config/db");
require("./config/passport");

const csrfProtection = require("./middlewares/csrfProtection");

const authRoutes = require("./routes/authRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const studentRoutes = require("./routes/studentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const collegeRegistrationRoutes = require("./routes/collegeRegistrationRoutes");
const platformAdminRoutes = require("./routes/platformAdminRoutes");

const app = express();

const isProduction = process.env.NODE_ENV === "production";

/*
    Keep this opt-in. When enabled on localhost, Safari can upgrade
    css/js requests to https://localhost and static assets fail to load.
*/
const forceUpgradeInsecureRequests =
    process.env.CSP_UPGRADE_INSECURE_REQUESTS === "true";

const helmetDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://unpkg.com"
    ],
    styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.googleapis.com"
    ],
    fontSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        "https://fonts.gstatic.com",
        "data:"
    ],
    imgSrc: [
        "'self'",
        "data:",
        "blob:"
    ],
    connectSrc: [
        "'self'",
        "https:",
        "wss:"
    ],
    // Current templates still use some inline onclick/onsubmit handlers.
    scriptSrcAttr: ["'unsafe-inline'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"]
};

if (forceUpgradeInsecureRequests) {
    helmetDirectives.upgradeInsecureRequests = [];
} else {
    helmetDirectives.upgradeInsecureRequests = null;
}

app.use(
    helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
            useDefaults: true,
            directives: helmetDirectives
        }
    })
);

app.set("trust proxy", 1);
connectDB();

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
    throw new Error("SESSION_SECRET is missing in .env file");
}

if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long");
}

if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env file");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
    name: "attendance.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: "sessions",
        ttl: 60 * 60 * 8
    }),
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 8
    }
});

app.set("sessionMiddleware", sessionMiddleware);
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

app.use(csrfProtection());

app.use("/", authRoutes);
app.use("/", collegeRegistrationRoutes);
app.use("/", platformAdminRoutes);
app.use("/teacher", teacherRoutes);
app.use("/student", studentRoutes);
app.use("/admin", adminRoutes);

app.use(function (req, res) {
    res.status(404).send("404 - Page not found");
});

app.use(function (err, req, res, next) {
    console.log("SERVER ERROR:", err.message);
    console.log(err.stack);

    if (isProduction) {
        return res.status(500).send("Something went wrong. Please try again later.");
    }

    res.status(500).send("Server error: " + err.message);
});

module.exports = app;
