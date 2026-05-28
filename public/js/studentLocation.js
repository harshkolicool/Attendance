function showMessage(message, type) {
    const messageBox = document.getElementById("messageBox");

    if (!messageBox) {
        alert(message);
        return;
    }

    messageBox.textContent = "";

    const div = document.createElement("div");
    div.className = type === "success" ? "success-box" : "error-box";
    div.textContent = message;

    messageBox.appendChild(div);

    setTimeout(function () {
        div.remove();
    }, 5000);
}

function getBrowserFingerprint() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";

    return [
        navigator.userAgent || "unknown",
        navigator.language || "unknown",
        timezone,
        screen.width + "x" + screen.height,
        screen.colorDepth || "unknown"
    ].join("|");
}

function createIcon(className) {
    const icon = document.createElement("i");
    icon.className = className;
    return icon;
}

function createPresentBadge() {
    const badge = document.createElement("span");
    badge.className = "status-badge present";
    badge.appendChild(createIcon("fa-solid fa-circle-check"));
    badge.appendChild(document.createTextNode(" Present"));
    return badge;
}

function setAttendancePresentUI(button) {
    const card = button.closest("[data-schedule-id]");

    if (card) {
        card.setAttribute("data-attendance-state", "present");

        const cardTop = card.querySelector(".class-card-top");

        if (cardTop) {
            const existingBadge = cardTop.querySelector(".status-badge");
            const presentBadge = createPresentBadge();

            if (existingBadge) {
                existingBadge.replaceWith(presentBadge);
            } else {
                cardTop.appendChild(presentBadge);
            }
        }
    }

    const actionBox = button.closest(".js-schedule-action");

    if (!actionBox) {
        button.textContent = "Marked";
        button.classList.add("marked");
        button.disabled = true;
        return;
    }

    actionBox.textContent = "";

    const markedButton = document.createElement("button");
    markedButton.className = "view-btn marked";
    markedButton.type = "button";
    markedButton.disabled = true;
    markedButton.textContent = "Attendance Marked";

    actionBox.appendChild(markedButton);
}


async function readJsonResponse(response, fallbackMessage) {
    const text = await response.text();

    if (!text) {
        return {
            success: response.ok,
            message: fallbackMessage || "Request completed."
        };
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        return {
            success: false,
            message: fallbackMessage || "Server returned an invalid response. Please refresh and try again."
        };
    }
}

async function getAttendanceTokenWithTrustedDevice(sessionId) {
    const fingerprint = encodeURIComponent(getBrowserFingerprint());

    const response = await fetch(
        "/student/attendance/device-token/" + sessionId + "?browserFingerprint=" + fingerprint,
        {
            method: "GET",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json"
            }
        }
    );

    const data = await readJsonResponse(response, "Trusted browser verification failed.");

    if (response.ok && data.success) {
        return data.attendanceToken;
    }

    if (data.needTrustedDevice) {
        throw new Error(
            data.message ||
            "This browser is not trusted. Ask admin to allow browser fallback, then set it up before class."
        );
    }

    if (data.trustedDevicePending) {
        throw new Error(
            data.message ||
            "This trusted browser is still activating. Please wait before using it for attendance."
        );
    }

    throw new Error(data.message || "Trusted browser verification failed.");
}

async function getBestAttendanceToken(sessionId, button) {
    if (
        typeof getAttendanceTokenWithPasskey !== "function" ||
        typeof passkeyLibraryReady !== "function" ||
        typeof getPasskeyBrowserHelpMessage !== "function"
    ) {
        button.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Trusted Browser...';
        return await getAttendanceTokenWithTrustedDevice(sessionId);
    }

    const browserHelp = getPasskeyBrowserHelpMessage();

    if (browserHelp) {
        button.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Trusted Browser...';
        return await getAttendanceTokenWithTrustedDevice(sessionId);
    }

    button.innerHTML = '<i class="fa-solid fa-fingerprint"></i> Verify Passkey...';

    try {
        return await getAttendanceTokenWithPasskey(sessionId);
    } catch (err) {
        const message = (err && err.message ? err.message : "").toLowerCase();

        const canFallback =
            message.includes("does not support passkeys") ||
            message.includes("passkey library is not loaded") ||
            message.includes("please register your passkey") ||
            message.includes("passkey verification is not available") ||
            message.includes("passkeys need https") ||
            message.includes("not supported");

        if (!canFallback) {
            throw err;
        }

        button.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Trusted Browser...';
        return await getAttendanceTokenWithTrustedDevice(sessionId);
    }
}

function resetAttendanceButton(button, oldHtml) {
    if (!button) {
        return;
    }

    button.innerHTML = oldHtml;
    button.disabled = false;
    button.dataset.pending = "false";
}

function markAttendance(sessionId, button) {
    if (!button || !sessionId) {
        return;
    }

    if (button.dataset.pending === "true") {
        return;
    }

    if (!navigator.geolocation) {
        showMessage("Your browser does not support location access.", "error");
        return;
    }

    if (
        !window.isSecureContext &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1"
    ) {
        showMessage(
            "Location and passkeys work only on HTTPS or localhost. Open the secure URL and try again.",
            "error"
        );
        return;
    }

    const oldHtml = button.innerHTML;

    button.dataset.pending = "true";
    button.disabled = true;

    getBestAttendanceToken(sessionId, button)
        .then(function (attendanceToken) {
            button.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Getting Location...';

            return getBestStudentLocationPosition(function(currentAccuracy, bestSample) {
                const bestAcc = bestSample && bestSample.coords ? Math.round(bestSample.coords.accuracy) : Math.round(currentAccuracy);
                button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> GPS: ' + bestAcc + 'm';
            }).then(function (position) {
                return {
                    position: position,
                    attendanceToken: attendanceToken
                };
            });
        })
        .then(function (payload) {
            const position = payload.position;
            const attendanceToken = payload.attendanceToken;

            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Marking...';

            return fetch("/student/attendance/mark", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    sessionId: sessionId,
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    attendanceToken: attendanceToken,
                    browserFingerprint: getBrowserFingerprint()
                })
            });
        })
        .then(function (response) {
            return readJsonResponse(response, "Could not mark attendance. Please refresh and try again.");
        })
        .then(function (data) {
            if (data.success) {
                button.dataset.pending = "false";
                showMessage(data.message || "Attendance marked successfully.", "success");

                if (data.alreadyPresent) {
                    setAttendancePresentUI(button);
                    return;
                }

                setAttendancePresentUI(button);
                return;
            }

            showMessage(data.message || "Could not mark attendance.", "error");
            resetAttendanceButton(button, oldHtml);
        })
        .catch(function (err) {
            console.log(err);

            getStudentGeolocationPermissionState()
                .then(function (permissionState) {
                    showMessage(
                        getStudentLocationErrorMessage(err, permissionState),
                        "error"
                    );
                })
                .catch(function () {
                    showMessage(getStudentLocationErrorMessage(err), "error");
                })
                .then(function () {
                    resetAttendanceButton(button, oldHtml);
                });
        });
}

function getStudentGeolocationPermissionState() {
    if (
        !navigator.permissions ||
        typeof navigator.permissions.query !== "function"
    ) {
        return Promise.resolve("unknown");
    }

    return navigator.permissions
        .query({ name: "geolocation" })
        .then(function (status) {
            return status && status.state ? status.state : "unknown";
        })
        .catch(function () {
            return "unknown";
        });
}

function getStudentLocationErrorMessage(error, permissionState) {
    const code = Number(error && error.code);
    const name = String(error && error.name ? error.name : "").toUpperCase();
    const message = String(error && error.message ? error.message : "");
    const lowerMessage = message.toLowerCase();
    const hasStandardCode = code === 1 || code === 2 || code === 3;
    const geoKeywords = ["location", "geolocation", "gps", "position"];
    const hasGeoKeyword = geoKeywords.some(function (keyword) {
        return lowerMessage.indexOf(keyword) !== -1;
    });
    const isGeoName =
        name.indexOf("PERMISSION_DENIED") !== -1 ||
        name.indexOf("POSITION_UNAVAILABLE") !== -1 ||
        name.indexOf("TIMEOUT") !== -1;

    if (message && !hasStandardCode && !isGeoName && !hasGeoKeyword) {
        return message;
    }

    if (
        code === 1 ||
        name.indexOf("PERMISSION_DENIED") !== -1 ||
        (lowerMessage.indexOf("permission") !== -1 && hasGeoKeyword) ||
        permissionState === "denied"
    ) {
        return "Location access is blocked. Please allow location permission in browser/site settings.";
    }

    if (code === 2 || name.indexOf("POSITION_UNAVAILABLE") !== -1) {
        return "Could not detect your location. Move near a window/open area and try again.";
    }

    if (code === 3 || name.indexOf("TIMEOUT") !== -1) {
        return "Location request timed out. Please try again.";
    }

    if (permissionState === "granted") {
        return "Location permission is enabled, but GPS fix is unavailable right now. Move near a window/open area and try again.";
    }

    if (message) {
        return message;
    }

    return "Please allow location access to mark attendance.";
}

function getBestStudentLocationPosition(onProgress) {
    // Use AttendifyGeo engine if available (weighted centroid + outlier rejection)
    if (window.AttendifyGeo && typeof window.AttendifyGeo.getBestPosition === "function") {
        return window.AttendifyGeo.getBestPosition(onProgress);
    }

    // Fallback: original simple sampler
    return new Promise(function (resolve, reject) {
        const samples = [];
        let lastError = null;
        let finished = false;
        let watchId = null;
        let timeoutId = null;

        const targetAccuracyMeters = 20;
        const acceptableAccuracyMeters = 50;
        const minimumSamples = 4;
        const maxWaitMs = 20000;

        function cleanup() {
            if (timeoutId) clearTimeout(timeoutId);
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        }

        function getAccuracy(position) {
            return Number(
                position && position.coords &&
                Number.isFinite(Number(position.coords.accuracy))
                    ? position.coords.accuracy : 999999
            );
        }

        function getBestSample() {
            samples.sort(function (a, b) { return getAccuracy(a) - getAccuracy(b); });
            return samples[0];
        }

        function finish(error) {
            if (finished) return;
            finished = true;
            cleanup();
            if (samples.length === 0) {
                reject(error || lastError || new Error("Location is not available."));
                return;
            }
            resolve(getBestSample());
        }

        function addSample(position) {
            if (finished || !position || !position.coords) return;
            samples.push(position);
            const accuracy = getAccuracy(position);
            if (onProgress && typeof onProgress === "function") onProgress(accuracy, getBestSample());
            if (accuracy <= targetAccuracyMeters && samples.length >= minimumSamples) { finish(); return; }
            if (samples.length >= minimumSamples && accuracy <= acceptableAccuracyMeters) {
                setTimeout(function () { if (!finished) finish(); }, 1500);
            }
        }

        function handleError(error) {
            lastError = error;
            if (error && Number(error.code) === 1) finish(error);
        }

        const options = { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 };
        navigator.geolocation.getCurrentPosition(addSample, handleError, options);
        try { watchId = navigator.geolocation.watchPosition(addSample, handleError, options); } catch (e) { lastError = e; }
        timeoutId = setTimeout(function () { finish(); }, maxWaitMs);
    });
}

let studentAttendanceTouchTs = 0;

function handleMarkAttendanceTrigger(event) {
    const rawTarget = event.target;

    const target = rawTarget && rawTarget.nodeType === 3
        ? rawTarget.parentElement
        : rawTarget;

    if (!target || typeof target.closest !== "function") {
        return;
    }

    const button = target.closest(".js-mark-attendance-btn[data-session-id]");

    if (!button) {
        return;
    }

    if (event.type === "touchend") {
        studentAttendanceTouchTs = Date.now();
        event.preventDefault();
    }

    if (
        event.type === "click" &&
        Date.now() - studentAttendanceTouchTs < 650
    ) {
        return;
    }

    const sessionId = button.getAttribute("data-session-id");

    if (!sessionId) {
        return;
    }

    markAttendance(sessionId, button);
}

document.addEventListener("click", handleMarkAttendanceTrigger, true);
document.addEventListener("touchend", handleMarkAttendanceTrigger, {
    capture: true,
    passive: false
});
