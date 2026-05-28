/**
 * Stabilizes noisy GPS coordinates so stationary devices do not drift on the map.
 */
(function (root) {
    "use strict";

    function distanceM(lat1, lon1, lat2, lon2) {
        const r = 6371000;
        const p1 = (lat1 * Math.PI) / 180;
        const p2 = (lat2 * Math.PI) / 180;
        const dp = ((lat2 - lat1) * Math.PI) / 180;
        const dl = ((lon2 - lon1) * Math.PI) / 180;
        const a =
            Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);

        return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function createStabilizer(options) {
        const opts = options || {};
        const minMoveMeters = Number(opts.minMoveMeters) || 4;
        const accuracyRatio = Number(opts.accuracyRatio) || 0.35;
        const emaAlpha = Number(opts.emaAlpha) || 0.2;
        const heartbeatMs = Number(opts.heartbeatMs) || 28000;
        const bufferSize = Number(opts.bufferSize) || 10;

        let displayLat = null;
        let displayLon = null;
        let lastHeartbeatAt = 0;
        const buffer = [];

        function getWeightedTarget() {
            if (!buffer.length) {
                return null;
            }

            let totalWeight = 0;
            let lat = 0;
            let lon = 0;

            for (let i = 0; i < buffer.length; i++) {
                const sample = buffer[i];
                const accuracy = Math.max(Number(sample.accuracy) || 25, 1);
                const weight = 1 / (accuracy * accuracy);
                totalWeight += weight;
                lat += sample.lat * weight;
                lon += sample.lon * weight;
            }

            if (!totalWeight) {
                return null;
            }

            return {
                lat: lat / totalWeight,
                lon: lon / totalWeight
            };
        }

        return {
            reset: function () {
                displayLat = null;
                displayLon = null;
                lastHeartbeatAt = 0;
                buffer.length = 0;
            },

            update: function (latitude, longitude, accuracy) {
                const lat = Number(latitude);
                const lon = Number(longitude);
                const acc = Number(accuracy);

                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    return {
                        lat: displayLat,
                        lon: displayLon,
                        moved: false,
                        skipped: true
                    };
                }

                const safeAcc = Number.isFinite(acc) && acc > 0 ? acc : 25;

                buffer.push({
                    lat: lat,
                    lon: lon,
                    accuracy: safeAcc,
                    at: Date.now()
                });

                while (buffer.length > bufferSize) {
                    buffer.shift();
                }

                const target = getWeightedTarget();

                if (!target) {
                    return { lat: lat, lon: lon, moved: true, isFirst: true };
                }

                if (displayLat === null || displayLon === null) {
                    displayLat = target.lat;
                    displayLon = target.lon;
                    lastHeartbeatAt = Date.now();

                    return {
                        lat: displayLat,
                        lon: displayLon,
                        moved: true,
                        isFirst: true
                    };
                }

                const deltaToTarget = distanceM(displayLat, displayLon, target.lat, target.lon);
                const threshold = Math.max(minMoveMeters, safeAcc * accuracyRatio);
                const now = Date.now();
                const heartbeatDue = now - lastHeartbeatAt >= heartbeatMs;

                if (deltaToTarget < threshold && !heartbeatDue) {
                    return {
                        lat: displayLat,
                        lon: displayLon,
                        moved: false,
                        jitterMeters: Math.round(deltaToTarget * 10) / 10
                    };
                }

                const step =
                    deltaToTarget > threshold * 2.5
                        ? Math.min(0.5, emaAlpha * 2)
                        : emaAlpha;

                displayLat = displayLat + (target.lat - displayLat) * step;
                displayLon = displayLon + (target.lon - displayLon) * step;
                lastHeartbeatAt = now;

                return {
                    lat: displayLat,
                    lon: displayLon,
                    moved: true,
                    jitterMeters: Math.round(deltaToTarget * 10) / 10
                };
            }
        };
    }

    root.AttendifyLocationStabilizer = {
        create: createStabilizer,
        distanceM: distanceM
    };
})(window);
