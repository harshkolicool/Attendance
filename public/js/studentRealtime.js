document.addEventListener("DOMContentLoaded", function () {
    if (typeof io === "undefined") {
        return;
    }

    const socket =
        window.AttendifySharedSocket ||
        io({
            transports: ["websocket", "polling"],
            withCredentials: true,
            timeout: 20000,
            reconnectionAttempts: 20,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });
    window.AttendifySharedSocket = socket;

    if (socket.__studentRealtimeAttached === true) {
        return;
    }

    socket.__studentRealtimeAttached = true;
    window.__attendifyRoleSpecificRealtime = true;

    function joinStudentRealtime() {
        socket.emit("student:join");
    }

    socket.on("connect", function () {
        joinStudentRealtime();
    });

    if (socket.connected) {
        joinStudentRealtime();
    }

    function showRealtimeMessage(message, type) {
        if (typeof showMessage === "function") {
            showMessage(message, type || "success");
            return;
        }

        console.log(message);
    }

    socket.on("socket:error", function (payload) {
        if (!payload || !payload.message) {
            return;
        }

        showRealtimeMessage(payload.message, "error");
    });

    socket.on("connect_error", function () {
        showRealtimeMessage("Realtime connection issue. Trying to reconnect...", "error");
    });

    function getScheduleCard(scheduleId) {
        return document.querySelector("[data-schedule-id='" + scheduleId + "']");
    }

    function getActionBox(card) {
        if (!card) {
            return null;
        }

        return card.querySelector(".js-schedule-action");
    }

    function createStatusBadge(type, iconClass, text) {
        const badge = document.createElement("span");
        badge.className = "status-badge " + type;

        const icon = document.createElement("i");
        icon.className = iconClass;

        badge.appendChild(icon);
        badge.appendChild(document.createTextNode(" " + text));

        return badge;
    }

    function setTopStatusBadge(card, type, iconClass, text) {
        if (!card) {
            return;
        }

        const cardTop = card.querySelector(".class-card-top");

        if (!cardTop) {
            return;
        }

        const existingBadge = cardTop.querySelector(".status-badge");
        const newBadge = createStatusBadge(type, iconClass, text);

        if (existingBadge) {
            existingBadge.replaceWith(newBadge);
            return;
        }

        cardTop.appendChild(newBadge);
    }

    function createDisabledButton(text, variant) {
        const button = document.createElement("button");
        button.className = "view-btn";

        if (variant === "marked") {
            button.className += " marked";
        } else if (variant === "absent") {
            button.className += " marked absent";
        }

        button.type = "button";
        button.disabled = true;
        button.textContent = text;

        return button;
    }

    function timeToMinutes(timeText) {
        if (!timeText || typeof timeText !== "string") {
            return -1;
        }

        const text = timeText.trim().toUpperCase();
        const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);

        if (!match) {
            return -1;
        }

        let hours = Number(match[1]);
        const minutes = Number(match[2]);
        const meridian = match[3];

        if (meridian === "PM" && hours !== 12) {
            hours += 12;
        }

        if (meridian === "AM" && hours === 12) {
            hours = 0;
        }

        return (hours * 60) + minutes;
    }

    function isTodayCard(card) {
        const dayOffsetText = card ? card.getAttribute("data-day-offset") : null;

        if (dayOffsetText === null || dayOffsetText === "") {
            return true;
        }

        return Number(dayOffsetText) === 0;
    }

    function isCardInLiveWindow(card) {
        if (!card || !isTodayCard(card)) {
            return false;
        }

        const startTime = card.getAttribute("data-start-time") || "";
        const endTime = card.getAttribute("data-end-time") || "";

        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);

        if (startMinutes < 0 || endMinutes < 0) {
            return false;
        }

        const now = new Date();
        const nowMinutes = (now.getHours() * 60) + now.getMinutes();

        return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }

    function isCardPastEnd(card) {
        if (!card || !isTodayCard(card)) {
            return false;
        }

        const endTime = card.getAttribute("data-end-time") || "";
        const endMinutes = timeToMinutes(endTime);

        if (endMinutes < 0) {
            return false;
        }

        const now = new Date();
        const nowMinutes = (now.getHours() * 60) + now.getMinutes();

        return nowMinutes > endMinutes;
    }

    function setPresentUI(card) {
        const actionBox = getActionBox(card);

        if (!actionBox || !card) {
            return;
        }

        card.setAttribute("data-attendance-state", "present");
        setTopStatusBadge(card, "present", "fa-solid fa-circle-check", "Present");

        actionBox.textContent = "";
        actionBox.appendChild(createDisabledButton("Attendance Marked", "marked"));
    }

    function setOngoingUI(card) {
        const actionBox = getActionBox(card);

        if (!actionBox || !card) {
            return;
        }

        const currentState = card.getAttribute("data-attendance-state");

        if (currentState === "present" || currentState === "absent" || currentState === "live") {
            return;
        }

        card.setAttribute("data-attendance-state", "ongoing");
        card.setAttribute("data-session-id", "");
        setTopStatusBadge(card, "live", "fa-solid fa-circle-dot", "Live Class");

        actionBox.textContent = "";
        actionBox.appendChild(createDisabledButton("Teacher Not Started"));
    }

    function setLiveUI(card, sessionId) {
        const actionBox = getActionBox(card);

        if (!actionBox) {
            return;
        }

        actionBox.textContent = "";

        card.setAttribute("data-attendance-state", "live");
        card.setAttribute("data-session-id", sessionId);

        setTopStatusBadge(
            card,
            "live",
            "fa-solid fa-circle-dot",
            "Live Class"
        );

        const button = document.createElement("button");
        button.className = "view-btn live js-mark-attendance-btn";
        button.type = "button";
        button.setAttribute("data-session-id", sessionId);
        button.textContent = "Mark Attendance";

        actionBox.appendChild(button);
    }

    function setWaitingUI(card) {
        const actionBox = getActionBox(card);

        if (!actionBox || !card) {
            return;
        }

        const currentState = card.getAttribute("data-attendance-state");

        if (currentState === "present" || currentState === "absent" || currentState === "live") {
            return;
        }

        card.setAttribute("data-attendance-state", "waiting");
        card.setAttribute("data-session-id", "");
        setTopStatusBadge(card, "waiting", "fa-solid fa-clock", "Waiting");

        actionBox.textContent = "";
        actionBox.appendChild(createDisabledButton("Not Started"));
    }

    function setUnmarkedUI(card) {
        const actionBox = getActionBox(card);

        if (!actionBox || !card) {
            return;
        }

        const currentState = card.getAttribute("data-attendance-state");

        if (currentState === "present" || currentState === "absent" || currentState === "live") {
            return;
        }

        card.setAttribute("data-attendance-state", "unmarked");
        card.setAttribute("data-session-id", "");
        setTopStatusBadge(card, "unmarked", "fa-solid fa-triangle-exclamation", "Unmarked");

        actionBox.textContent = "";
        actionBox.appendChild(createDisabledButton("Unmarked", "unmarked"));
    }

    function syncOngoingCardsByClock() {
        const cards = document.querySelectorAll("[data-schedule-id]");

        cards.forEach(function (card) {
            const currentState = card.getAttribute("data-attendance-state");

            if (currentState === "present" || currentState === "absent" || currentState === "live") {
                return;
            }

            if (!isTodayCard(card)) {
                return;
            }

            if (isCardInLiveWindow(card)) {
                setOngoingUI(card);
            } else if (isCardPastEnd(card)) {
                setUnmarkedUI(card);
            } else if (currentState === "ongoing" || currentState === "unmarked") {
                setWaitingUI(card);
            }
        });
    }

    function setAbsentUI(card) {
        const actionBox = getActionBox(card);

        if (!actionBox) {
            return;
        }

        const currentState = card.getAttribute("data-attendance-state");

        if (currentState === "present" || currentState === "absent") {
            return;
        }

        actionBox.textContent = "";

        card.setAttribute("data-attendance-state", "absent");

        setTopStatusBadge(
            card,
            "absent",
            "fa-solid fa-circle-xmark",
            "Absent"
        );

        actionBox.appendChild(createDisabledButton("Marked Absent", "absent"));
    }

    socket.on("attendance:started", function (payload) {
        const card = getScheduleCard(payload.scheduleId);

        if (!card) {
            return;
        }

        const currentState = card.getAttribute("data-attendance-state");

        if (currentState === "present" || currentState === "absent") {
            return;
        }

        setLiveUI(card, payload.sessionId);

        showRealtimeMessage(
            "Attendance started for " + (payload.subjectName || "this subject") + ". You can mark now.",
            "success"
        );
    });

    socket.on("attendance:ended", function (payload) {
        const card = getScheduleCard(payload.scheduleId);

        if (!card) {
            return;
        }

        const currentState = card.getAttribute("data-attendance-state");

        if (currentState === "live" || currentState === "ongoing" || currentState === "waiting") {
            setAbsentUI(card);
            showRealtimeMessage("Attendance session ended.", "error");
        }
    });

    socket.on("attendance:marked:self", function (payload) {
        const card = getScheduleCard(payload.scheduleId);

        if (!card) {
            return;
        }

        setPresentUI(card);
    });

    syncOngoingCardsByClock();
    setInterval(syncOngoingCardsByClock, 30000);
});
