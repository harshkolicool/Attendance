/**
 * AttendifyGeo — high-accuracy geolocation engine for web-based attendance.
 *
 * Strategy:
 *   1.  Collect multiple GPS samples using watchPosition (continuous updates).
 *   2.  Compute a weighted centroid using 1/accuracy² weights so high-accuracy
 *       readings contribute far more than noisy ones.
 *   3.  Reject outlier samples that are statistically too far from the
 *       running centroid (more than 2× the best reported accuracy).
 *   4.  Return the best single sample *nearest* to the weighted centroid, so
 *       the returned object has a valid GeolocationPosition shape that all
 *       existing code can consume unchanged.
 *   5.  Expose a live progress callback so the UI can show improving accuracy.
 *
 * Limitations (browser-inherent, cannot be fixed in JS):
 *   - Indoor environments without Wi-Fi data may stay ≥ 20 m.
 *   - iOS always reports accuracy from Core Location; Chrome on Android uses
 *     the Fused Location Provider which is generally best-in-class.
 */

(function (root) {
    "use strict";

    // ── constants ────────────────────────────────────────────────────────────
    var TARGET_ACCURACY_M       = 15;   // resolve immediately if we hit this
    var ACCEPTABLE_ACCURACY_M   = 40;   // resolve after MIN_SAMPLES at this
    var MAX_ACCURACY_ALLOWED_M  = 150;  // reject samples worse than this outright
    var MIN_SAMPLES             = 4;    // minimum before considering resolve
    var MAX_SAMPLES             = 16;   // collect up to this many then stop
    var MAX_WAIT_MS             = 20000;// hard timeout
    var OUTLIER_SIGMA           = 2.5;  // reject if > N × bestAccuracy from centroid

    // ── Vincenty / Haversine distance (metres) ───────────────────────────────
    function distanceM(lat1, lon1, lat2, lon2) {
        var R  = 6371000;
        var φ1 = lat1 * Math.PI / 180;
        var φ2 = lat2 * Math.PI / 180;
        var Δφ = (lat2 - lat1) * Math.PI / 180;
        var Δλ = (lon2 - lon1) * Math.PI / 180;
        var a  = Math.sin(Δφ / 2) * Math.sin(Δφ / 2)
               + Math.cos(φ1) * Math.cos(φ2)
               * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── weighted centroid ────────────────────────────────────────────────────
    /**
     * Given an array of GeolocationPosition objects, return
     * { lat, lon, accuracy } where lat/lon is the inverse-accuracy²-weighted
     * mean and accuracy is the weighted RMS of individual accuracies.
     */
    function weightedCentroid(positions) {
        if (!positions || positions.length === 0) return null;

        var totalWeight = 0;
        var wLat = 0;
        var wLon = 0;

        for (var i = 0; i < positions.length; i++) {
            var c = positions[i].coords;
            var acc = Math.max(c.accuracy, 1); // avoid division by zero
            var w = 1 / (acc * acc);
            totalWeight += w;
            wLat += c.latitude  * w;
            wLon += c.longitude * w;
        }

        var lat = wLat / totalWeight;
        var lon = wLon / totalWeight;

        // Weighted RMS accuracy (rough but good enough for our use)
        var wAcc = 0;
        for (var j = 0; j < positions.length; j++) {
            var c2   = positions[j].coords;
            var acc2 = Math.max(c2.accuracy, 1);
            var w2   = 1 / (acc2 * acc2);
            wAcc += (acc2 * acc2) * w2;
        }
        var rmAcc = Math.sqrt(wAcc / totalWeight);

        return { lat: lat, lon: lon, accuracy: rmAcc };
    }

    // ── find sample nearest to centroid ──────────────────────────────────────
    function nearestSampleToCentroid(positions, centroid) {
        var best = null;
        var bestDist = Infinity;

        for (var i = 0; i < positions.length; i++) {
            var c    = positions[i].coords;
            var d    = distanceM(c.latitude, c.longitude, centroid.lat, centroid.lon);
            var score = d + c.accuracy * 0.5; // penalise poor accuracy

            if (score < bestDist) {
                bestDist = score;
                best = positions[i];
            }
        }

        return best;
    }

    // ── remove statistical outliers ──────────────────────────────────────────
    function rejectOutliers(positions, centroid, bestAcc) {
        var threshold = Math.max(bestAcc * OUTLIER_SIGMA, 30); // at least 30 m

        return positions.filter(function (pos) {
            var c = pos.coords;
            var d = distanceM(c.latitude, c.longitude, centroid.lat, centroid.lon);
            return d <= threshold;
        });
    }

    // ── main function ─────────────────────────────────────────────────────────
    /**
     * Collect GPS samples and return the best computed position.
     *
     * @param {function} onProgress  called with (currentBestAccuracyM, bestRawSample)
     * @returns {Promise<GeolocationPosition>}
     */
    function getBestPosition(onProgress) {
        return new Promise(function (resolve, reject) {
            var rawSamples  = [];
            var finished    = false;
            var watchId     = null;
            var timeoutId   = null;

            function cleanup() {
                if (timeoutId) clearTimeout(timeoutId);
                if (watchId !== null && navigator.geolocation) {
                    try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
                }
            }

            function getBestRaw() {
                if (rawSamples.length === 0) return null;
                return rawSamples.reduce(function (best, cur) {
                    return cur.coords.accuracy < best.coords.accuracy ? cur : best;
                });
            }

            function done(error) {
                if (finished) return;
                finished = true;
                cleanup();

                if (rawSamples.length === 0) {
                    reject(error || new Error("Location unavailable."));
                    return;
                }

                // Build centroid from all samples
                var centroid = weightedCentroid(rawSamples);

                // Reject outliers
                var best0 = getBestRaw();
                var filtered = rejectOutliers(rawSamples, centroid, best0.coords.accuracy);

                if (filtered.length < 2) {
                    // Too few samples survived — fall back to raw best
                    resolve(best0);
                    return;
                }

                // Recompute centroid with clean data
                var centroid2  = weightedCentroid(filtered);
                var resultSample = nearestSampleToCentroid(filtered, centroid2);

                // Build a synthetic position with the centroid coordinates and
                // the best remaining accuracy figure so existing code works unchanged.
                var synth = {
                    coords: {
                        latitude:         centroid2.lat,
                        longitude:        centroid2.lon,
                        accuracy:         Math.min(resultSample.coords.accuracy, centroid2.accuracy),
                        altitude:         resultSample.coords.altitude,
                        altitudeAccuracy: resultSample.coords.altitudeAccuracy,
                        heading:          resultSample.coords.heading,
                        speed:            resultSample.coords.speed
                    },
                    timestamp: resultSample.timestamp
                };

                resolve(synth);
            }

            function addSample(position) {
                if (finished || !position || !position.coords) return;

                var acc = position.coords.accuracy;

                // Discard completely unreliable readings
                if (acc > MAX_ACCURACY_ALLOWED_M) {
                    if (onProgress) onProgress(acc, getBestRaw());
                    return;
                }

                rawSamples.push(position);

                var best = getBestRaw();
                if (onProgress) onProgress(acc, best);

                // Early exit: excellent accuracy
                if (acc <= TARGET_ACCURACY_M && rawSamples.length >= MIN_SAMPLES) {
                    done();
                    return;
                }

                // Good enough after minimum samples
                if (acc <= ACCEPTABLE_ACCURACY_M && rawSamples.length >= MIN_SAMPLES) {
                    // Wait 1.5s more in case it improves further
                    setTimeout(function () {
                        if (!finished) done();
                    }, 1500);
                    return;
                }

                // Collected the maximum we want
                if (rawSamples.length >= MAX_SAMPLES) {
                    done();
                }
            }

            function handleError(error) {
                if (error && error.code === 1) {
                    // Permission denied — fail immediately
                    done(error);
                }
                // Other errors (timeout, unavailable) → keep trying until maxWait
            }

            var options = {
                enableHighAccuracy: true,
                timeout:            18000,
                maximumAge:         0
            };

            // Kick off both a one-shot + continuous watch for fastest first fix
            try {
                navigator.geolocation.getCurrentPosition(addSample, handleError, options);
            } catch (e) {}

            try {
                watchId = navigator.geolocation.watchPosition(addSample, handleError, options);
            } catch (e) {}

            timeoutId = setTimeout(function () { done(); }, MAX_WAIT_MS);
        });
    }

    // ── expose ────────────────────────────────────────────────────────────────
    root.AttendifyGeo = {
        getBestPosition: getBestPosition,
        distanceM:       distanceM,
        weightedCentroid: weightedCentroid
    };

}(window));
