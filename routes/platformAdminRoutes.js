const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const PlatformAdmin = require("../models/platformAdminSchema");
const CollegeRegistrationRequest = require("../models/collegeRegistrationRequestSchema");
const College = require("../models/collegeSchema");
const Teacher = require("../models/teacherSchema");

const isPlatformAdmin = require("../middlewares/isPlatformAdmin");

function cleanText(value) {
    if (!value) {
        return "";
    }

    return value.toString().trim();
}

function cleanEmail(value) {
    return cleanText(value).toLowerCase();
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExactRegex(value) {
    return new RegExp("^" + escapeRegex(value) + "$", "i");
}

function getLoginMessage(code) {
    if (code === "invalid") {
        return "Invalid email or password.";
    }

    if (code === "blocked") {
        return "Your platform admin account is blocked.";
    }

    if (code === "logout") {
        return "Logged out successfully.";
    }

    return null;
}

function getFlash(req) {
    const flash = req.session.platformFlash || null;
    req.session.platformFlash = null;
    return flash;
}

function setFlash(req, type, title, message, extra) {
    req.session.platformFlash = {
        type,
        title,
        message,
        extra: extra || null
    };
}

const COMMON_COLLEGE_WORDS = [
    "COLLEGE",
    "UNIVERSITY",
    "INSTITUTE",
    "SCHOOL",
    "OF",
    "THE",
    "AND",
    "FOR",
    "ENGINEERING",
    "TECHNOLOGY",
    "SCIENCE",
    "SCIENCES",
    "ARTS",
    "COMMERCE",
    "MANAGEMENT"
];

function getCollegeBaseCode(collegeName) {
    const words = cleanText(collegeName)
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    if (words.length === 0) {
        return "COL";
    }

    const firstWord = words[0];

    if (
        firstWord.length >= 2 &&
        firstWord.length <= 5 &&
        !COMMON_COLLEGE_WORDS.includes(firstWord)
    ) {
        return firstWord;
    }

    const meaningfulWords = words.filter(function (word) {
        return !COMMON_COLLEGE_WORDS.includes(word);
    });

    const acronym = meaningfulWords.map(function (word) {
        return word[0];
    }).join("");

    if (acronym.length >= 3) {
        return acronym.slice(0, 5);
    }

    const firstMeaningfulWord = meaningfulWords[0];

    if (firstMeaningfulWord) {
        return firstMeaningfulWord.slice(0, 5);
    }

    return words[0].slice(0, 5);
}

async function generateCollegeCode(collegeName) {
    const baseCode = getCollegeBaseCode(collegeName);

    for (let number = 1; number <= 999; number++) {
        const paddedNumber = number.toString().padStart(3, "0");
        const candidateCode = baseCode + paddedNumber;

        const existingCollege = await College.findOne({
            collegeCode: candidateCode
        });

        if (!existingCollege) {
            return candidateCode;
        }
    }

    throw new Error("Unable to generate college code");
}

async function generateAdminEmployeeId(collegeId, collegeCode) {
    for (let number = 1; number <= 999; number++) {
        const paddedNumber = number.toString().padStart(3, "0");
        const candidateEmployeeId = collegeCode + "-ADM-" + paddedNumber;

        const existingTeacher = await Teacher.findOne({
            college: collegeId,
            employeeId: candidateEmployeeId
        });

        if (!existingTeacher) {
            return candidateEmployeeId;
        }
    }

    throw new Error("Unable to generate admin employee ID");
}

function generateTemporaryPassword(collegeCode) {
    const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    return collegeCode + "@Admin" + randomPart;
}

router.get("/platform-admin", function (req, res) {
    if (req.session && req.session.platformAdminId) {
        return res.redirect("/platform-admin/dashboard");
    }

    res.redirect("/platform-admin/login");
});

router.get("/platform-admin/login", function (req, res) {
    res.render("platformAdmin/login", {
        message: getLoginMessage(req.query.message)
    });
});

router.post("/platform-admin/login", async function (req, res) {
    try {
        const email = cleanEmail(req.body.email);
        const password = cleanText(req.body.password);

        if (!email || !password) {
            return res.redirect("/platform-admin/login?message=invalid");
        }

        const platformAdmin = await PlatformAdmin.findOne({
            email: email
        });

        if (!platformAdmin) {
            return res.redirect("/platform-admin/login?message=invalid");
        }

        if (platformAdmin.isBlocked) {
            return res.redirect("/platform-admin/login?message=blocked");
        }

        const isPasswordCorrect = await platformAdmin.comparePassword(password);

        if (!isPasswordCorrect) {
            return res.redirect("/platform-admin/login?message=invalid");
        }

        platformAdmin.lastLogin = new Date();
        await platformAdmin.save();

        req.session.platformAdminId = platformAdmin._id.toString();

        res.redirect("/platform-admin/dashboard");

    } catch (err) {
        console.log("PLATFORM ADMIN LOGIN ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.redirect("/platform-admin/login?message=invalid");
    }
});

router.post("/platform-admin/logout", function (req, res) {
    req.session.platformAdminId = null;
    res.redirect("/platform-admin/login?message=logout");
});

router.get("/platform-admin/dashboard", isPlatformAdmin, async function (req, res) {
    try {
        const pendingRequestsCount = await CollegeRegistrationRequest.countDocuments({
            status: "PENDING"
        });

        const approvedRequestsCount = await CollegeRegistrationRequest.countDocuments({
            status: "APPROVED"
        });

        const rejectedRequestsCount = await CollegeRegistrationRequest.countDocuments({
            status: "REJECTED"
        });

        const collegesCount = await College.countDocuments();

        const recentRequests = await CollegeRegistrationRequest.find()
            .sort({ createdAt: -1 })
            .limit(8);

        res.render("platformAdmin/dashboard", {
            activePage: "dashboard",
            flash: getFlash(req),
            pendingRequestsCount,
            approvedRequestsCount,
            rejectedRequestsCount,
            collegesCount,
            recentRequests
        });

    } catch (err) {
        console.log("PLATFORM ADMIN DASHBOARD ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).send("Dashboard error: " + err.message);
    }
});

router.get("/platform-admin/requests", isPlatformAdmin, async function (req, res) {
    try {
        const status = cleanText(req.query.status).toUpperCase();

        const filter = {};

        if (["PENDING", "APPROVED", "REJECTED"].includes(status)) {
            filter.status = status;
        }

        const requests = await CollegeRegistrationRequest.find(filter)
            .populate("createdCollege")
            .populate("createdAdmin")
            .populate("reviewedBy")
            .sort({ createdAt: -1 });

        res.render("platformAdmin/requests", {
            activePage: "requests",
            selectedStatus: status || "ALL",
            flash: getFlash(req),
            requests
        });

    } catch (err) {
        console.log("PLATFORM ADMIN REQUESTS ERROR:");
        console.log(err.message);
        console.log(err.stack);

        res.status(500).send("Requests error: " + err.message);
    }
});

router.post("/platform-admin/requests/:id/approve", isPlatformAdmin, async function (req, res) {
    try {
        const requestId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            setFlash(
                req,
                "error",
                "Invalid Request",
                "The selected registration request is invalid."
            );

            return res.redirect("/platform-admin/requests?status=PENDING");
        }

        const registrationRequest = await CollegeRegistrationRequest.findOne({
            _id: requestId,
            status: "PENDING"
        });

        if (!registrationRequest) {
            setFlash(
                req,
                "error",
                "Request Not Found",
                "This request may already be approved or rejected."
            );

            return res.redirect("/platform-admin/requests");
        }

        const existingCollege = await College.findOne({
            collegeName: getExactRegex(registrationRequest.collegeName),
            city: getExactRegex(registrationRequest.city),
            state: getExactRegex(registrationRequest.state)
        });

        if (existingCollege) {
            setFlash(
                req,
                "error",
                "Duplicate College",
                "A college with the same name, city and state already exists."
            );

            return res.redirect("/platform-admin/requests?status=PENDING");
        }

        const existingAdmin = await Teacher.findOne({
            email: registrationRequest.adminEmail
        });

        if (existingAdmin) {
            setFlash(
                req,
                "error",
                "Duplicate Admin Email",
                "A teacher/admin account with this email already exists."
            );

            return res.redirect("/platform-admin/requests?status=PENDING");
        }

        const generatedCollegeCode = await generateCollegeCode(
            registrationRequest.collegeName
        );

        const createdCollege = await College.create({
            collegeName: registrationRequest.collegeName,
            collegeCode: generatedCollegeCode,
            address: registrationRequest.address,
            city: registrationRequest.city,
            state: registrationRequest.state,
            isActive: true,
            classrooms: [],
            students: [],
            teachers: []
        });

        const generatedAdminEmployeeId = await generateAdminEmployeeId(
            createdCollege._id,
            generatedCollegeCode
        );

        const temporaryPassword = generateTemporaryPassword(generatedCollegeCode);

        let createdAdmin = null;

        try {
            createdAdmin = await Teacher.create({
                fullName: registrationRequest.adminFullName,
                email: registrationRequest.adminEmail,
                password: temporaryPassword,
                employeeId: generatedAdminEmployeeId,
                department: "ADMINISTRATION",
                college: createdCollege._id,
                subjects: [],
                attendanceSessions: [],
                role: "ADMIN",
                isBlocked: false
            });

            await College.updateOne(
                {
                    _id: createdCollege._id
                },
                {
                    $addToSet: {
                        teachers: createdAdmin._id
                    }
                }
            );

            registrationRequest.status = "APPROVED";
            registrationRequest.generatedCollegeCode = generatedCollegeCode;
            registrationRequest.generatedAdminEmployeeId = generatedAdminEmployeeId;
            registrationRequest.createdCollege = createdCollege._id;
            registrationRequest.createdAdmin = createdAdmin._id;
            registrationRequest.reviewedBy = req.platformAdmin._id;
            registrationRequest.reviewedAt = new Date();

            await registrationRequest.save();

        } catch (innerErr) {
            await College.deleteOne({
                _id: createdCollege._id
            });

            throw innerErr;
        }

        setFlash(
            req,
            "success",
            "College Approved",
            "College and first admin were created successfully.",
            {
                collegeName: createdCollege.collegeName,
                collegeCode: generatedCollegeCode,
                adminEmail: createdAdmin.email,
                adminEmployeeId: generatedAdminEmployeeId,
                temporaryPassword: temporaryPassword
            }
        );

        res.redirect("/platform-admin/requests?status=PENDING");

    } catch (err) {
        console.log("PLATFORM ADMIN APPROVE REQUEST ERROR:");
        console.log(err.message);
        console.log(err.stack);

        setFlash(
            req,
            "error",
            "Approval Failed",
            "Approval error: " + err.message
        );

        res.redirect("/platform-admin/requests?status=PENDING");
    }
});

router.post("/platform-admin/requests/:id/reject", isPlatformAdmin, async function (req, res) {
    try {
        const requestId = req.params.id;
        const rejectionReason = cleanText(req.body.rejectionReason);

        if (!mongoose.Types.ObjectId.isValid(requestId)) {
            setFlash(
                req,
                "error",
                "Invalid Request",
                "The selected registration request is invalid."
            );

            return res.redirect("/platform-admin/requests?status=PENDING");
        }

        const registrationRequest = await CollegeRegistrationRequest.findOne({
            _id: requestId,
            status: "PENDING"
        });

        if (!registrationRequest) {
            setFlash(
                req,
                "error",
                "Request Not Found",
                "This request may already be approved or rejected."
            );

            return res.redirect("/platform-admin/requests");
        }

        registrationRequest.status = "REJECTED";
        registrationRequest.rejectionReason = rejectionReason || "Request rejected by platform admin.";
        registrationRequest.reviewedBy = req.platformAdmin._id;
        registrationRequest.reviewedAt = new Date();

        await registrationRequest.save();

        setFlash(
            req,
            "success",
            "Request Rejected",
            "College registration request was rejected."
        );

        res.redirect("/platform-admin/requests?status=PENDING");

    } catch (err) {
        console.log("PLATFORM ADMIN REJECT REQUEST ERROR:");
        console.log(err.message);
        console.log(err.stack);

        setFlash(
            req,
            "error",
            "Reject Failed",
            "Reject error: " + err.message
        );

        res.redirect("/platform-admin/requests?status=PENDING");
    }
});

module.exports = router;