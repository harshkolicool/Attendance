(function () {
    const STORAGE_VERSION_KEY = "attendifyUiShellVersion";
    const CURRENT_VERSION = "2026-05-24-final-ui-stable-8";

    function resetOldBrokenStateOnce() {
        if (localStorage.getItem(STORAGE_VERSION_KEY) === CURRENT_VERSION) {
            return;
        }

        [
            "adminSidebarCollapsed",
            "studentSidebarCollapsed",
            "teacherSidebarCollapsed",
            "platformSidebarCollapsed",
            "appSidebarCollapsed"
        ].forEach(function (key) {
            localStorage.removeItem(key);
        });

        localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_VERSION);
    }

    function createLines() {
        const lines = document.createElement("span");
        lines.className = "ui-sidebar-toggle-lines";

        for (let i = 0; i < 3; i++) {
            lines.appendChild(document.createElement("span"));
        }

        return lines;
    }

    function createToggleButton(className) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.setAttribute("aria-label", "Toggle sidebar");
        button.appendChild(createLines());

        return button;
    }

    function getSidebar() {
        return document.querySelector(
            ".admin-sidebar, .student-sidebar, .schedule-sidebar, .teacher-sidebar, .platform-sidebar"
        );
    }

    function isDrawerMode() {
        return window.innerWidth <= 1280;
    }

    function getStorageKey(sidebar) {
        if (sidebar.classList.contains("admin-sidebar")) {
            return "adminSidebarCollapsed";
        }

        if (
            sidebar.classList.contains("student-sidebar") ||
            sidebar.classList.contains("schedule-sidebar")
        ) {
            return "studentSidebarCollapsed";
        }

        if (sidebar.classList.contains("teacher-sidebar")) {
            return "teacherSidebarCollapsed";
        }

        if (sidebar.classList.contains("platform-sidebar")) {
            return "platformSidebarCollapsed";
        }

        return "appSidebarCollapsed";
    }

    function wrapLooseSidebarText(sidebar) {
        const clickableItems = sidebar.querySelectorAll("a, button:not(.ui-sidebar-toggle)");

        clickableItems.forEach(function (item) {
            Array.from(item.childNodes).forEach(function (node) {
                if (node.nodeType !== Node.TEXT_NODE) {
                    return;
                }

                const text = node.textContent.replace(/\s+/g, " ").trim();

                if (!text) {
                    node.textContent = "";
                    return;
                }

                const span = document.createElement("span");
                span.className = "shell-text";
                span.textContent = text;

                item.replaceChild(span, node);
            });
        });
    }

    function normalizeExistingToggle(sidebar) {
        let button = document.getElementById("adminSidebarToggle");

        if (!button) {
            button = sidebar.querySelector(".admin-sidebar-toggle, .ui-sidebar-toggle");
        }

        if (!button) {
            return null;
        }

        button.classList.add("ui-sidebar-toggle");
        button.innerHTML = "";
        button.appendChild(createLines());

        return button;
    }

    function applyState(sidebar) {
        document.body.classList.remove("ui-sidebar-open");

        if (isDrawerMode()) {
            document.body.classList.remove("ui-sidebar-collapsed");
            document.body.classList.remove("admin-sidebar-collapsed");
            return;
        }

        const saved = localStorage.getItem(getStorageKey(sidebar));

        if (saved === "true") {
            document.body.classList.add("ui-sidebar-collapsed");
            document.body.classList.add("admin-sidebar-collapsed");
        } else {
            document.body.classList.remove("ui-sidebar-collapsed");
            document.body.classList.remove("admin-sidebar-collapsed");
        }
    }

    function toggleSidebar(sidebar) {
        if (isDrawerMode()) {
            document.body.classList.toggle("ui-sidebar-open");
            return;
        }

        document.body.classList.toggle("ui-sidebar-collapsed");
        document.body.classList.toggle("admin-sidebar-collapsed");

        const collapsed = document.body.classList.contains("ui-sidebar-collapsed");

        localStorage.setItem(getStorageKey(sidebar), collapsed ? "true" : "false");
    }

    function closeDrawer() {
        document.body.classList.remove("ui-sidebar-open");
    }

    function syncActiveSidebarLink(sidebar) {
        const sidebarLinks = sidebar.querySelectorAll(
            ".shell-sidebar-nav a[href], .shell-sidebar-footer a[href]"
        );

        if (!sidebarLinks.length) {
            return;
        }

        const currentUrl = new URL(window.location.href);
        let bestLink = null;
        let bestScore = -1;

        sidebarLinks.forEach(function (link) {
            const href = link.getAttribute("href");

            if (!href || href.startsWith("javascript:")) {
                return;
            }

            const targetUrl = new URL(href, window.location.origin);

            if (targetUrl.origin !== currentUrl.origin) {
                return;
            }

            let score = -1;

            if (targetUrl.pathname === currentUrl.pathname) {
                if (!targetUrl.hash && !currentUrl.hash) {
                    score = 2;
                } else if (targetUrl.hash && targetUrl.hash === currentUrl.hash) {
                    score = 3;
                } else if (!targetUrl.hash) {
                    score = 1;
                } else {
                    score = 0;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestLink = link;
            }
        });

        if (!bestLink) {
            return;
        }

        sidebarLinks.forEach(function (link) {
            link.classList.remove("active");
        });

        bestLink.classList.add("active");
    }

    function installShell() {
        if (document.documentElement.dataset.uiShellInstalled === "true") {
            return;
        }

        resetOldBrokenStateOnce();

        const sidebar = getSidebar();

        if (!sidebar) {
            return;
        }

        sidebar.classList.add("ui-sidebar");

        wrapLooseSidebarText(sidebar);
        syncActiveSidebarLink(sidebar);

        let desktopToggle = normalizeExistingToggle(sidebar);

        if (!desktopToggle) {
            desktopToggle = createToggleButton("ui-sidebar-toggle");
            sidebar.insertBefore(desktopToggle, sidebar.firstChild);
        }

        if (!document.querySelector(".ui-mobile-sidebar-toggle")) {
            const mobileToggle = createToggleButton("ui-mobile-sidebar-toggle");
            document.body.appendChild(mobileToggle);

            mobileToggle.addEventListener("click", function () {
                toggleSidebar(sidebar);
            });
        }

        if (!document.querySelector(".ui-sidebar-overlay")) {
            const overlay = document.createElement("div");
            overlay.className = "ui-sidebar-overlay";
            document.body.appendChild(overlay);

            overlay.addEventListener("click", closeDrawer);
        }

        desktopToggle.addEventListener("click", function () {
            toggleSidebar(sidebar);
        });

        sidebar.addEventListener("click", function (event) {
            const link = event.target.closest("a");

            if (link && isDrawerMode()) {
                closeDrawer();
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeDrawer();
            }
        });

        let resizeTimer = null;

        window.addEventListener("resize", function () {
            clearTimeout(resizeTimer);

            resizeTimer = setTimeout(function () {
                applyState(sidebar);
            }, 120);
        });

        window.addEventListener("hashchange", function () {
            syncActiveSidebarLink(sidebar);
        });

        window.addEventListener("popstate", function () {
            syncActiveSidebarLink(sidebar);
        });

        applyState(sidebar);

        document.documentElement.dataset.uiShellInstalled = "true";
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            if (
                src === "/socket.io/socket.io.js" &&
                typeof window.io !== "undefined"
            ) {
                resolve();
                return;
            }

            const existing = document.querySelector("script[data-ui-shell-src='" + src + "']");

            if (existing) {
                if (existing.dataset.loaded === "true") {
                    resolve();
                    return;
                }

                existing.addEventListener("load", function () {
                    existing.dataset.loaded = "true";
                    resolve();
                }, { once: true });

                existing.addEventListener("error", function () {
                    reject(new Error("Could not load script: " + src));
                }, { once: true });

                return;
            }

            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.dataset.uiShellSrc = src;

            script.addEventListener("load", function () {
                script.dataset.loaded = "true";
                resolve();
            }, { once: true });

            script.addEventListener("error", function () {
                reject(new Error("Could not load script: " + src));
            }, { once: true });

            document.head.appendChild(script);
        });
    }

    function getRealtimeRoleFromPath() {
        const path = window.location.pathname || "";

        if (path.indexOf("/student") === 0) {
            return "student";
        }

        if (path.indexOf("/teacher") === 0) {
            return "teacher";
        }

        if (path.indexOf("/admin") === 0) {
            return "admin";
        }

        if (path.indexOf("/platform-admin") === 0) {
            return "platform-admin";
        }

        return "";
    }

    function getUnreadCountApiPath(role) {
        if (role === "student") {
            return "/student/notifications/unread-count";
        }

        if (role === "teacher") {
            return "/teacher/notifications/unread-count";
        }

        if (role === "admin") {
            return "/admin/notifications/unread-count";
        }

        if (role === "platform-admin") {
            return "/platform-admin/notifications/unread-count";
        }

        return "";
    }

    function getNotificationRoleCode(role) {
        if (role === "student") {
            return "STUDENT";
        }

        if (role === "teacher") {
            return "TEACHER";
        }

        if (role === "admin") {
            return "ADMIN";
        }

        if (role === "platform-admin") {
            return "PLATFORM_ADMIN";
        }

        return "";
    }

    function updateNotificationBadges(count) {
        const badges = document.querySelectorAll(".js-notification-badge");
        const unread = Number(count || 0);
        const text = unread > 99 ? "99+" : String(unread);

        badges.forEach(function (badge) {
            if (unread > 0) {
                badge.textContent = text;
                badge.classList.add("has-unread");
            } else {
                badge.textContent = "";
                badge.classList.remove("has-unread");
            }
        });
    }

    function showRealtimeToast(message, type) {
        if (!message) {
            return;
        }

        let toast = document.getElementById("uiRealtimeToast");

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "uiRealtimeToast";
            toast.className = "ui-realtime-toast";
            document.body.appendChild(toast);
        }

        toast.classList.remove("danger");
        toast.classList.remove("success");

        if (type === "danger") {
            toast.classList.add("danger");
        } else if (type === "success") {
            toast.classList.add("success");
        }

        toast.textContent = message;
        toast.classList.add("show");

        setTimeout(function () {
            toast.classList.remove("show");
        }, 2600);
    }

    function shouldAutoReloadForUpdate(role) {
        const path = window.location.pathname || "";

        if (role === "student") {
            return (
                path === "/student/dashboard" ||
                path === "/student/schedule" ||
                path === "/student/passkeys" ||
                path === "/student/notifications"
            );
        }

        if (role === "teacher") {
            return (
                path === "/teacher/dashboard" ||
                path.indexOf("/teacher/manual-attendance") === 0 ||
                path === "/teacher/reports" ||
                path === "/teacher/notifications"
            );
        }

        if (role === "admin") {
            return path.indexOf("/admin/") === 0;
        }

        if (role === "platform-admin") {
            return path.indexOf("/platform-admin/") === 0;
        }

        return false;
    }

    function installRealtime() {
        const role = getRealtimeRoleFromPath();
        const path = window.location.pathname || "";

        if (!role || path.indexOf("/login") !== -1) {
            return;
        }

        loadScript("/socket.io/socket.io.js")
            .then(function () {
                if (typeof window.io === "undefined") {
                    return;
                }

                if (!window.AttendifySharedSocket) {
                    window.AttendifySharedSocket = window.io({
                        transports: ["websocket", "polling"],
                        withCredentials: true,
                        timeout: 20000,
                        reconnectionAttempts: 20,
                        reconnectionDelay: 1000,
                        reconnectionDelayMax: 5000
                    });
                }

                const socket = window.AttendifySharedSocket;

                if (!socket || socket.__uiShellRealtimeAttached === true) {
                    return;
                }

                socket.__uiShellRealtimeAttached = true;

                function joinRealtimeRooms() {
                    if (role === "student") {
                        socket.emit("student:join");
                    } else if (role === "teacher") {
                        socket.emit("teacher:join");
                    } else if (role === "admin") {
                        socket.emit("admin:join");
                        socket.emit("teacher:join");
                    } else if (role === "platform-admin") {
                        socket.emit("platform-admin:join");
                    }
                }

                socket.on("connect", function () {
                    joinRealtimeRooms();
                });

                if (socket.connected) {
                    joinRealtimeRooms();
                }

                let reloadPending = false;
                let lastSocketErrorToastAt = 0;

                function queueReload(message) {
                    if (reloadPending || !shouldAutoReloadForUpdate(role)) {
                        return;
                    }

                    reloadPending = true;
                    showRealtimeToast(message || "New update received. Refreshing...", "success");

                    setTimeout(function () {
                        window.location.reload();
                    }, 900);
                }

                function showSocketIssueToast(message) {
                    const now = Date.now();

                    if (now - lastSocketErrorToastAt < 5000) {
                        return;
                    }

                    lastSocketErrorToastAt = now;
                    showRealtimeToast(message, "danger");
                }

                if (!window.__attendifyRoleSpecificRealtime) {
                    socket.on("socket:error", function (payload) {
                        if (!payload || !payload.message) {
                            return;
                        }

                        showSocketIssueToast(payload.message);
                    });

                    socket.on("connect_error", function () {
                        showSocketIssueToast("Realtime connection issue. Reconnecting...");
                    });
                }

                const myNotificationRole = getNotificationRoleCode(role);

                socket.on("notification:new", function (payload) {
                    if (!payload || !payload.title) {
                        return;
                    }

                    if (
                        payload.recipientRole &&
                        myNotificationRole &&
                        payload.recipientRole !== myNotificationRole
                    ) {
                        return;
                    }

                    showRealtimeToast(payload.title, payload.level === "danger" ? "danger" : "success");

                    const currentBadge = document.querySelector(".js-notification-badge.has-unread");
                    const currentUnread = currentBadge
                        ? (parseInt(currentBadge.textContent || "0", 10) || 0)
                        : 0;
                    updateNotificationBadges(currentUnread + 1);

                    if (window.location.pathname.indexOf("/notifications") !== -1) {
                        queueReload("New notification received. Refreshing...");
                    }
                });

                socket.on("notification:unread-count", function (payload) {
                    if (!payload || !payload.recipientRole) {
                        return;
                    }

                    if (payload.recipientRole !== myNotificationRole) {
                        return;
                    }

                    updateNotificationBadges(payload.unreadCount || 0);
                });

                socket.on("schedule:changed", function () {
                    queueReload("Schedule updated. Refreshing...");
                });

                socket.on("attendance:started:admin", function () {
                    queueReload("Attendance session started. Refreshing...");
                });

                socket.on("attendance:ended:admin", function () {
                    queueReload("Attendance session ended. Refreshing...");
                });

                socket.on("attendance:started", function () {
                    if (
                        role === "student" &&
                        window.location.pathname !== "/student/dashboard" &&
                        window.location.pathname !== "/student/schedule"
                    ) {
                        queueReload("Class is live now. Refreshing...");
                    }
                });

                socket.on("attendance:ended", function () {
                    if (
                        role === "student" &&
                        window.location.pathname !== "/student/dashboard" &&
                        window.location.pathname !== "/student/schedule"
                    ) {
                        queueReload("Attendance window updated. Refreshing...");
                    }
                });

                const unreadCountApi = getUnreadCountApiPath(role);

                if (!unreadCountApi) {
                    return;
                }

                fetch(unreadCountApi, {
                    method: "GET",
                    credentials: "same-origin"
                })
                    .then(function (res) {
                        return res.json();
                    })
                    .then(function (data) {
                        if (!data || !data.success) {
                            return;
                        }

                        updateNotificationBadges(data.unreadCount || 0);
                    })
                    .catch(function () {
                        // Ignore unread count fetch failure silently.
                    });
            })
            .catch(function () {
                // Ignore realtime bootstrap failure silently.
            });
    }

    document.addEventListener("DOMContentLoaded", function () {
        installShell();
        installRealtime();
    });
})();
