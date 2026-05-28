document.addEventListener("DOMContentLoaded", function () {
    if (typeof io === "undefined") {
        return;
    }

    function getSocket() {
        if (!window.AttendifySharedSocket) {
            window.AttendifySharedSocket = io({
                transports: ["websocket", "polling"],
                withCredentials: true,
                timeout: 20000,
                reconnectionAttempts: 20,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000
            });
        }

        return window.AttendifySharedSocket;
    }

    const socket = getSocket();

    if (socket.__studentLiveLocationAttached === true) {
        return;
    }

    socket.__studentLiveLocationAttached = true;

    let watchId = null;
    let activeSessionId = "";
    let lastSentAt = 0;
    let deviceId = "";
    let studentJoined = false;
    const pendingAfterJoin = [];

    function getOrCreateDeviceId() {
        try {
            const key = "attendifyDeviceId";
            const existing = localStorage.getItem(key);

            if (existing) {
                return existing;
            }

            const id =
                "dev_" +
                Math.random().toString(16).slice(2) +
                "_" +
                Date.now().toString(16);
            localStorage.setItem(key, id);
            return id;
        } catch (e) {
            return "dev_" + Date.now().toString(16);
        }
    }

    function getDeviceLabel() {
        const ua = String(navigator.userAgent || "");

        if (/iPhone|iPad|iPod/i.test(ua)) {
            return "iPhone / iPad";
        }

        if (/Android/i.test(ua)) {
            return "Android";
        }

        if (/Macintosh/i.test(ua)) {
            return "Mac";
        }

        if (/Windows/i.test(ua)) {
            return "Windows";
        }

        if (/CrOS/i.test(ua)) {
            return "Chromebook";
        }

        return "Browser";
    }

    function canUseGeolocation() {
        return (
            typeof navigator !== "undefined" &&
            navigator.geolocation &&
            (window.isSecureContext ||
                window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1")
        );
    }

    function persistSessionId(sessionId) {
        try {
            if (sessionId) {
                sessionStorage.setItem("attendifyLiveSessionId", String(sessionId));
            } else {
                sessionStorage.removeItem("attendifyLiveSessionId");
            }
        } catch (e) {
            // ignore
        }
    }

    function readPersistedSessionId() {
        try {
            return sessionStorage.getItem("attendifyLiveSessionId") || "";
        } catch (e) {
            return "";
        }
    }

    function readBootstrapSessions() {
        const el = document.getElementById("studentLiveSessionBootstrap");

        if (!el || !el.textContent) {
            return [];
        }

        try {
            const parsed = JSON.parse(el.textContent);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function ensureStudentJoined(callback) {
        if (studentJoined) {
            callback();
            return;
        }

        pendingAfterJoin.push(callback);
        socket.emit("student:join");
    }

    socket.on("student:joined", function () {
        studentJoined = true;

        while (pendingAfterJoin.length > 0) {
            const next = pendingAfterJoin.shift();

            try {
                next();
            } catch (e) {
                // ignore
            }
        }
    });

    socket.on("connect", function () {
        studentJoined = false;
        socket.emit("student:join");
    });

    if (socket.connected) {
        socket.emit("student:join");
    }

    function stopWatch() {
        if (watchId !== null && navigator.geolocation) {
            try {
                navigator.geolocation.clearWatch(watchId);
            } catch (e) {
                // ignore
            }
        }

        watchId = null;
    }

    function sendLocation(position) {
        if (!position || !position.coords || !activeSessionId) {
            return;
        }

        const now = Date.now();

        if (now - lastSentAt < 2000) {
            return;
        }

        if (
            !Number.isFinite(position.coords.latitude) ||
            !Number.isFinite(position.coords.longitude) ||
            !Number.isFinite(position.coords.accuracy)
        ) {
            return;
        }

        lastSentAt = now;

        const payload = {
            sessionId: activeSessionId,
            deviceId: deviceId,
            deviceLabel: getDeviceLabel(),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed
        };

        ensureStudentJoined(function () {
            socket.emit("student:location:update", payload);
        });
    }

    function startWatch(sessionId) {
        if (!sessionId || !canUseGeolocation()) {
            return;
        }

        if (activeSessionId === sessionId && watchId !== null) {
            return;
        }

        activeSessionId = String(sessionId);
        persistSessionId(activeSessionId);
        stopWatch();

        const options = {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000
        };

        try {
            navigator.geolocation.getCurrentPosition(
                sendLocation,
                function () {
                    // keep trying via watch
                },
                options
            );

            watchId = navigator.geolocation.watchPosition(
                sendLocation,
                function (error) {
                    if (error && error.code === 1) {
                        stopWatch();
                    }
                },
                options
            );
        } catch (e) {
            stopWatch();
        }
    }

    function findFirstLiveSessionIdOnPage() {
        const liveCard =
            document.querySelector("[data-attendance-state='live'][data-session-id]") ||
            document.querySelector(".js-mark-attendance-btn[data-session-id]");

        if (liveCard) {
            const fromDom = liveCard.getAttribute("data-session-id") || "";

            if (fromDom) {
                return fromDom;
            }
        }

        const bootstrap = readBootstrapSessions();

        for (let i = 0; i < bootstrap.length; i++) {
            if (bootstrap[i] && bootstrap[i].sessionId) {
                return String(bootstrap[i].sessionId);
            }
        }

        return readPersistedSessionId();
    }

    function refreshFromDom() {
        const sessionId = findFirstLiveSessionIdOnPage();

        if (!sessionId) {
            if (!activeSessionId) {
                stopWatch();
            }

            return;
        }

        startWatch(sessionId);
    }

    deviceId = getOrCreateDeviceId();
    refreshFromDom();

    socket.on("attendance:started", function (payload) {
        if (payload && payload.sessionId) {
            startWatch(String(payload.sessionId));
        }
    });

    socket.on("attendance:ended", function (payload) {
        if (payload && payload.sessionId && String(payload.sessionId) === activeSessionId) {
            activeSessionId = "";
            persistSessionId("");
            stopWatch();
        }
    });

    setInterval(refreshFromDom, 4000);
});
