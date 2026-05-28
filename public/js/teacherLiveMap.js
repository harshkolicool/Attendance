document.addEventListener("DOMContentLoaded", function () {
    if (typeof io === "undefined" || typeof L === "undefined") {
        return;
    }

    const mapEl = document.getElementById("teacherLiveMap");

    if (!mapEl || window.__attendifyTeacherMapAttached === true) {
        return;
    }

    window.__attendifyTeacherMapAttached = true;

    // Re-use the shared socket that teacherRealtime.js already set up.
    // teacherRealtime.js has already emitted teacher:join and handles the teacher room.
    // We should NOT call teacher:join again here to avoid duplicate joins.
    const socket =
        window.AttendifySharedSocket ||
        io({
            transports: ["websocket", "polling"],
            withCredentials: true,
            timeout: 20000,
            reconnectionAttempts: 20,
            reconnectionDelayMax: 5000
        });
    window.AttendifySharedSocket = socket;

    // If the shared socket hasn't joined as teacher yet, do it now.
    // teacherRealtime.js normally does this first, but just in case:
    function ensureTeacherJoined() {
        if (!socket.__teacherRealtimeAttached) {
            socket.emit("teacher:join");
        }
    }

    socket.on("connect", ensureTeacherJoined);

    if (socket.connected) {
        ensureTeacherJoined();
    }

    const insidePill = document.getElementById("teacherMapInsidePill");
    const nearPill = document.getElementById("teacherMapNearPill");
    const outsidePill = document.getElementById("teacherMapOutsidePill");
    const trackingPill = document.getElementById("teacherMapTrackingPill");
    const poorPill = document.getElementById("teacherMapPoorPill");
    
    const hintEl = document.getElementById("teacherMapHint");
    const rosterEl = document.getElementById("teacherMapRoster");
    const sessionSelectEl = document.getElementById("teacherMapSessionSelect");
    const mapOverlay = document.getElementById("teacherMapOverlay");
    const searchInput = document.getElementById("teacherMapSearch");

    let map = null;
    let teacherMarker = null;
    let radiusCircle = null;
    let effectiveRadiusCircle = null;
    let activeSessionId = "";
    let mapInitialized = false;
    let currentSearchTerm = "";
    
    const deviceMarkers = new Map();
    const deviceState = new Map();
    const rosterByStudent = new Map();

    function readBootstrap() {
        const el = document.getElementById("teacherLiveMapBootstrap");
        if (!el || !el.textContent) return [];
        try {
            const parsed = JSON.parse(el.textContent);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function setHint(text) {
        if (hintEl) hintEl.textContent = text || "";
    }

    function formatTime(value) {
        if (!value) return "—";
        try {
            return new Date(value).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
        } catch (e) {
            return "—";
        }
    }
    
    function formatDistance(meters) {
        if (typeof meters !== 'number' || isNaN(meters)) return "Unknown";
        if (meters < 1000) return Math.round(meters) + " m away";
        return (meters / 1000).toFixed(1) + " km away";
    }

    function recalcCounts() {
        let inside = 0;
        let near = 0;
        let outside = 0;
        let poor = 0;
        let onlineDevices = 0;

        deviceState.forEach(function (device) {
            if (device.online !== false) {
                onlineDevices += 1;
                if (device.status === "INSIDE") inside++;
                else if (device.status === "NEAR") near++;
                else if (device.status === "OUTSIDE") outside++;
                else if (device.status === "POOR_ACCURACY") poor++;
            }
        });

        if (insidePill) insidePill.textContent = inside + " inside";
        if (nearPill) nearPill.textContent = near + " near";
        if (outsidePill) outsidePill.textContent = outside + " outside";
        if (poorPill) poorPill.textContent = poor + " poor GPS";
        if (trackingPill) trackingPill.textContent = onlineDevices + " live";
    }

    // Always initialize map
    if (!mapInitialized) {
        map = L.map(mapEl, {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([0, 0], 2);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 20,
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);
        
        mapInitialized = true;
        
        setTimeout(function() {
            if (map) map.invalidateSize();
        }, 300);
        
        // Recalculate map size after window resize OR sidebar toggle
        function invalidateMap() {
            if (map) map.invalidateSize();
        }
        window.addEventListener('resize', invalidateMap);
        window.addEventListener('attendify:layout-changed', invalidateMap);
    }

    function clearSession() {
        activeSessionId = "";
        if (mapOverlay) mapOverlay.style.display = "flex";
        
        deviceMarkers.forEach(function (marker) {
            try { marker.remove(); } catch (e) {}
        });
        deviceMarkers.clear();
        deviceState.clear();
        rosterByStudent.clear();

        if (teacherMarker) {
            try { teacherMarker.remove(); } catch (e) {}
            teacherMarker = null;
        }
        if (radiusCircle) {
            try { radiusCircle.remove(); } catch (e) {}
            radiusCircle = null;
        }
        if (effectiveRadiusCircle) {
            try { effectiveRadiusCircle.remove(); } catch (e) {}
            effectiveRadiusCircle = null;
        }

        if (rosterEl) rosterEl.innerHTML = '<div class="teacher-map-roster-empty">Waiting for students with location enabled…</div>';

        recalcCounts();
        setHint("Start a live session to see the radius and student markers.");
    }

    function watchSession(sessionId) {
        if (!sessionId) return;
        socket.emit("teacher:watch-session", { sessionId: String(sessionId) });
    }

    function setSessionCenter(payload) {
        if (!payload) return;

        const sessionId = String(payload.sessionId || "");
        const lat = Number(payload.latitude || 0);
        const lon = Number(payload.longitude || 0);
        const radius = Number(payload.radius || 0);

        if (!sessionId || !Number.isFinite(lat) || !Number.isFinite(lon) || radius <= 0) {
            setHint("Live session is active but location center is not configured yet.");
            return;
        }

        activeSessionId = sessionId;
        if (mapOverlay) mapOverlay.style.display = "none";

        if (teacherMarker) {
            teacherMarker.setLatLng([lat, lon]);
        } else {
            const teacherIcon = L.divIcon({
                className: "custom-teacher-marker",
                html: '<div style="width: 20px; height: 20px; background: #0f172a; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-chalkboard-user" style="color:white; font-size: 10px;"></i></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            teacherMarker = L.marker([lat, lon], { icon: teacherIcon, title: "Teacher Location", zIndexOffset: 1000 }).addTo(map);
            teacherMarker.bindPopup("<b>Teacher / Classroom Center</b><br>Attendance radius originates here.");
        }

        if (radiusCircle) {
            radiusCircle.setLatLng([lat, lon]);
            radiusCircle.setRadius(radius);
        } else {
            radiusCircle = L.circle([lat, lon], {
                radius: radius,
                color: "#16a34a",
                weight: 2,
                fillColor: "#16a34a",
                fillOpacity: 0.1,
                dashArray: "5, 5"
            }).addTo(map);
        }

        map.setView([lat, lon], 18);

        setTimeout(function () {
            if (map) map.invalidateSize();
        }, 300);

        setHint("Showing live student devices for this session.");
    }

    function seedRoster(roster) {
        if (!Array.isArray(roster)) return;

        for (let i = 0; i < roster.length; i++) {
            const row = roster[i];
            if (!row || !row.studentId) continue;

            rosterByStudent.set(String(row.studentId), {
                studentId: String(row.studentId),
                fullName: row.fullName || "Student",
                enrollmentNumber: row.enrollmentNumber || row.email || ""
            });
        }
    }

    function getStudentMeta(studentId) {
        return rosterByStudent.get(String(studentId)) || {
            studentId: String(studentId),
            fullName: "Student",
            enrollmentNumber: ""
        };
    }

    function getStatusColors(status) {
        if (status === "INSIDE") return { bg: "#dcfce7", color: "#16a34a", border: "#bbf7d0", text: "Inside" };
        if (status === "NEAR") return { bg: "#fef3c7", color: "#d97706", border: "#fde68a", text: "Near Boundary" };
        if (status === "OUTSIDE") return { bg: "#e0e7ff", color: "#4f46e5", border: "#c7d2fe", text: "Outside" };
        if (status === "POOR_ACCURACY") return { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0", text: "Poor GPS" };
        return { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0", text: "Unknown" };
    }

    function renderRoster() {
        if (!rosterEl) return;

        const grouped = new Map();
        deviceState.forEach(function (device) {
            const sid = device.studentId;
            if (!grouped.has(sid)) grouped.set(sid, []);
            grouped.get(sid).push(device);
        });

        let rows = [];
        grouped.forEach(function (devices, studentId) {
            const meta = getStudentMeta(studentId);
            const latest = devices.reduce(function (best, device) {
                const ts = new Date(device.updatedAt || device.lastSeenAt || 0).getTime();
                const bestTs = new Date(best.updatedAt || best.lastSeenAt || 0).getTime();
                return ts > bestTs ? device : best;
            }, devices[0]);

            rows.push({
                meta: meta,
                devices: devices,
                latest: latest,
                distance: latest.distance || 999999,
                status: latest.online === false ? "OFFLINE" : latest.status
            });
        });

        // Add students without devices
        rosterByStudent.forEach(function (meta, studentId) {
            if (!grouped.has(studentId)) {
                rows.push({
                    meta: meta,
                    devices: [],
                    latest: null,
                    distance: 999999,
                    status: "NO_DATA"
                });
            }
        });

        // Filter by search
        if (currentSearchTerm) {
            const term = currentSearchTerm.toLowerCase();
            rows = rows.filter(r => 
                r.meta.fullName.toLowerCase().includes(term) || 
                r.meta.enrollmentNumber.toLowerCase().includes(term)
            );
        }

        // Sort: Active first, then by distance nearest
        rows.sort(function (a, b) {
            if (a.status === "NO_DATA" && b.status !== "NO_DATA") return 1;
            if (b.status === "NO_DATA" && a.status !== "NO_DATA") return -1;
            if (a.status === "OFFLINE" && b.status !== "OFFLINE") return 1;
            if (b.status === "OFFLINE" && a.status !== "OFFLINE") return -1;
            return a.distance - b.distance;
        });

        if (rows.length === 0) {
            rosterEl.innerHTML = '<div class="teacher-map-roster-empty">No students found.</div>';
            return;
        }
        
        function escapeHtml(value) {
            return String(value || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        rosterEl.innerHTML = rows.map(function (row) {
            const isOnline = row.status !== "OFFLINE" && row.status !== "NO_DATA";
            const escapedName = escapeHtml(row.meta.fullName || "Student");
            const escapedEnrollment = escapeHtml(row.meta.enrollmentNumber || "—");
            const initial = escapedName.charAt(0).toUpperCase();
            
            const c = isOnline ? getStatusColors(row.status) : { bg: "#f1f5f9", color: "#94a3b8", border: "#e2e8f0", text: "Offline" };
            
            let details = "";
            if (row.latest && isOnline) {
                details = `
                    <div style="display:flex; justify-content:space-between; margin-top: 6px; font-size: 0.8rem; color: #64748b;">
                        <span><i class="fa-solid fa-location-arrow"></i> ${formatDistance(row.latest.distance)}</span>
                        <span><i class="fa-solid fa-satellite-dish"></i> ±${Math.round(row.latest.accuracy || 0)}m</span>
                    </div>
                    <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">Last: ${escapeHtml(formatTime(row.latest.updatedAt))}</div>
                `;
            }

            return `
                <article class="teacher-map-student-card" style="border: 1px solid ${c.border}; background: #fff; border-radius: 12px; padding: 12px; margin-bottom: 8px;">
                    <div style="display: flex; gap: 12px; align-items: flex-start;">
                        <div style="width: 36px; height: 36px; border-radius: 50%; background: ${c.bg}; color: ${c.color}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; border: 2px solid ${c.border};">
                            ${initial}
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <strong style="font-size: 0.9rem; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 120px;">${escapedName}</strong>
                                <span style="font-size: 0.7rem; font-weight: 800; padding: 2px 6px; border-radius: 99px; background: ${c.bg}; color: ${c.color}; border: 1px solid ${c.border};">${c.text}</span>
                            </div>
                            <p style="font-size: 0.75rem; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapedEnrollment}</p>
                            ${details}
                        </div>
                    </div>
                </article>
            `;
        }).join("");
    }

    if (searchInput) {
        searchInput.addEventListener("input", function(e) {
            currentSearchTerm = e.target.value.trim();
            renderRoster();
        });
    }

    function upsertStudent(payload) {
        if (!payload || !payload.sessionId) return;
        const sessionId = String(payload.sessionId);
        if (!activeSessionId || sessionId !== activeSessionId) return;
        
        const studentId = String(payload.studentId || "");
        if (!studentId) return;

        const deviceId = payload.deviceId ? String(payload.deviceId) : "default";
        const markerKey = studentId + ":" + deviceId;

        const lat = Number(payload.latitude);
        const lon = Number(payload.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const online = payload.online !== false;
        const distance = Number(payload.distance || 0);
        const accuracy = payload.accuracy === null || payload.accuracy === undefined ? null : Number(payload.accuracy);
        
        const configuredRadius = payload.configuredRadius || 0;
        const effectiveRadius = payload.effectiveRadius || 0;
        const status = payload.status || "UNKNOWN";
        const meta = getStudentMeta(studentId);
        const fullName = payload.studentName || meta.fullName;
        const enrollment = payload.enrollmentNumber || meta.enrollmentNumber;

        deviceState.set(markerKey, {
            sessionId: sessionId,
            studentId: studentId,
            studentName: fullName,
            enrollmentNumber: enrollment,
            deviceId: deviceId,
            deviceLabel: payload.deviceLabel || "Device",
            latitude: lat,
            longitude: lon,
            accuracy: accuracy,
            distance: distance,
            configuredRadius: configuredRadius,
            effectiveRadius: effectiveRadius,
            status: status,
            online: online,
            updatedAt: payload.updatedAt || new Date()
        });

        if (online) {
            const colors = getStatusColors(status);
            const initial = fullName.charAt(0).toUpperCase();
            
            // Custom circular div icon
            const markerIcon = L.divIcon({
                className: "custom-student-marker",
                html: `
                    <div style="width: 28px; height: 28px; background: #fff; border-radius: 50%; border: 3px solid ${colors.color}; box-shadow: 0 3px 8px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; color: ${colors.color}; font-family: sans-serif;">
                        ${initial}
                    </div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            let marker = deviceMarkers.get(markerKey);
            if (marker) {
                marker.setLatLng([lat, lon]);
                marker.setIcon(markerIcon);
            } else {
                marker = L.marker([lat, lon], { icon: markerIcon, title: fullName }).addTo(map);
                deviceMarkers.set(markerKey, marker);
            }

            const popupContent = `
                <div style="font-family: var(--shell-font, sans-serif); min-width: 180px;">
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;">
                        <strong style="display: block; font-size: 15px; color: #0f172a;">${fullName}</strong>
                        <span style="font-size: 12px; color: #64748b;">${enrollment || "No ID"}</span>
                    </div>
                    <div style="display: grid; gap: 6px; font-size: 13px; color: #334155;">
                        <div style="display: flex; justify-content: space-between;">
                            <span>Distance:</span> <strong>${formatDistance(distance)}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Status:</span> <strong style="color: ${colors.color};">${colors.text}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>GPS Accuracy:</span> <strong>±${Math.round(accuracy || 0)}m</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Base Radius:</span> <strong>${configuredRadius}m</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Effective Radius:</span> <strong>${effectiveRadius}m</strong>
                        </div>
                    </div>
                    <div style="margin-top: 8px; font-size: 11px; color: #94a3b8; text-align: right;">
                        Updated ${formatTime(payload.updatedAt || new Date())}
                    </div>
                </div>
            `;
            marker.bindPopup(popupContent, { maxWidth: 260, offset: [0, -10] });
        } else {
            let marker = deviceMarkers.get(markerKey);
            if (marker) {
                marker.remove();
                deviceMarkers.delete(markerKey);
            }
        }

        recalcCounts();
        renderRoster();
    }

    function applySnapshot(snapshot) {
        if (!Array.isArray(snapshot)) return;
        for (let i = 0; i < snapshot.length; i++) upsertStudent(snapshot[i]);
    }

    function populateSessionSelect(sessions) {
        if (!sessionSelectEl) return;
        sessionSelectEl.innerHTML = "";
        
        if (!sessions.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No live session";
            sessionSelectEl.appendChild(option);
            sessionSelectEl.disabled = true;
            return;
        }

        sessionSelectEl.disabled = sessions.length < 2;

        for (let i = 0; i < sessions.length; i++) {
            const row = sessions[i];
            const option = document.createElement("option");
            option.value = row.sessionId;
            option.textContent = (row.subjectName || "Session") + " · " + (row.classGroupName || "Class");
            sessionSelectEl.appendChild(option);
        }

        sessionSelectEl.onchange = function () {
            const nextId = sessionSelectEl.value;
            if (!nextId) return;

            deviceMarkers.forEach(m => m.remove());
            deviceMarkers.clear();
            deviceState.clear();

            watchSession(nextId);
        };
    }

    socket.on("attendance:started:teacher", function (payload) {
        if (!payload || !payload.sessionId) return;
        setSessionCenter(payload);
        watchSession(payload.sessionId);
    });

    // When attendance is reopened, re-init the map for that session
    socket.on("attendance:started:teacher", function (payload) {
        if (!payload || !payload.sessionId) return;
        // already handled above, but guard duplicate entries
    });

    socket.on("teacher:watch-session:ok", function (payload) {
        if (!payload || !payload.sessionId) return;
        if (sessionSelectEl && sessionSelectEl.value !== String(payload.sessionId)) {
            sessionSelectEl.value = String(payload.sessionId);
        }

        seedRoster(payload.roster);
        setSessionCenter(payload);
        applySnapshot(payload.snapshot || []);
    });

    socket.on("attendance:ended:teacher", function (payload) {
        if (!payload || !payload.sessionId) return;
        if (String(payload.sessionId) === activeSessionId) clearSession();
    });

    socket.on("student:location:update", function (payload) {
        upsertStudent(payload);
    });

    // When AUTO_ABSENT is overridden to PRESENT, update present/absent pill counters
    socket.on("attendance:record-updated", function (payload) {
        if (!payload || payload.newStatus !== "PRESENT") return;

        // Update the counters shown on teacher live cards
        var sessionId = payload.sessionId ? String(payload.sessionId) : "";
        if (!sessionId) return;

        var card = document.querySelector(".live-card[data-session-id='" + sessionId + "']");
        if (!card) return;

        var presentEl = card.querySelector(".js-live-present-count");
        var absentEl = card.querySelector(".js-live-absent-count");

        if (presentEl) {
            var p = parseInt(presentEl.textContent, 10) || 0;
            presentEl.textContent = p + 1;
        }

        if (absentEl) {
            var a = parseInt(absentEl.textContent, 10) || 0;
            if (a > 0) absentEl.textContent = a - 1;
        }
    });

    // Handle initial state
    const bootstrap = readBootstrap();
    populateSessionSelect(bootstrap);

    let initialSessionId = "";
    if (bootstrap.length > 0) {
        initialSessionId = bootstrap[0].sessionId;
    } else {
        const firstLive = document.querySelector(".live-card[data-session-id]");
        if (firstLive) initialSessionId = firstLive.getAttribute("data-session-id") || "";
    }

    if (initialSessionId) {
        if (sessionSelectEl) sessionSelectEl.value = initialSessionId;
        const bootRow = bootstrap.find(row => String(row.sessionId) === String(initialSessionId));
        if (bootRow) setSessionCenter(bootRow);
        watchSession(initialSessionId);
    } else {
        if (mapOverlay) mapOverlay.style.display = "flex";
    }
});
