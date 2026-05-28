const getDistanceInMeters = require("./geoDistance");

// ─── Environment-tunable constants ────────────────────────────────────────────
const MAX_GPS_ACCURACY_METERS       = Number(process.env.GPS_MAX_ACCEPTABLE_ACCURACY_METERS   || 150);
const MAX_GPS_UNCERTAINTY_ALLOWANCE = Number(process.env.GPS_UNCERTAINTY_CAP_METERS           || 60);
const SMALL_RADIUS_THRESHOLD        = Number(process.env.GPS_MIN_PRACTICAL_RADIUS_METERS      || 15);
const SMALL_RADIUS_GRACE            = Number(process.env.GPS_SMALL_RADIUS_GRACE_METERS        || 10);
const NEAR_BOUNDARY_RATIO           = Number(process.env.GPS_NEAR_BOUNDARY_RATIO              || 0.70);
// Minimum practical classroom radius — admin setting below this is ignored.
// Indoor GPS cannot reliably verify less than this distance.
const MINIMUM_CLASSROOM_RADIUS      = Number(process.env.GPS_MINIMUM_CLASSROOM_RADIUS_METERS  || 50);

// Re-export for convenience
const MAX_GPS_ACCURACY_METERS_EXPORT       = MAX_GPS_ACCURACY_METERS;
const MAX_GPS_UNCERTAINTY_ALLOWANCE_EXPORT = MAX_GPS_UNCERTAINTY_ALLOWANCE;
const SMALL_RADIUS_THRESHOLD_EXPORT        = SMALL_RADIUS_THRESHOLD;
const SMALL_RADIUS_GRACE_EXPORT            = SMALL_RADIUS_GRACE;

/**
 * Normalizes GPS accuracy: must be a finite non-negative number.
 * Returns 0 if the value is missing/invalid.
 */
function normalizeGpsAccuracy(accuracy) {
    const num = Number(accuracy);
    return Number.isFinite(num) && num >= 0 ? num : 0;
}

/**
 * Formats a distance value in metres into a human-readable label.
 */
function formatDistance(meters) {
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
        return "Unknown";
    }
    if (meters < 1000) {
        return Math.round(meters) + " m away";
    }
    return (meters / 1000).toFixed(1) + " km away";
}

/**
 * Core accuracy-aware range evaluator.
 *
 * ── Decision model ────────────────────────────────────────────────────────────
 *
 * GPS accuracy is a 68% confidence radius. When two devices are in the same
 * room, their reported GPS coordinates can differ by up to
 * (studentAccuracy + teacherAccuracy) metres even when actual distance = 0.
 *
 * Correct decision rule (confidence-interval lower bound):
 *
 *   minimumPossibleDistance = max(0, measuredDistance − studentAccuracy − teacherAccuracy)
 *
 *   If minimumPossibleDistance ≤ effectiveRadius  →  student MAY be inside  →  PASS
 *   If minimumPossibleDistance >  effectiveRadius  →  student CANNOT be inside →  FAIL
 *
 * Additionally, the effectiveRadius is set to at least the combined GPS
 * accuracy floor — it is physically impossible to verify that two devices
 * are within 1m of each other using GPS that has 3m accuracy.
 *
 *   effectiveRadius = max(configuredRadius, combinedAccuracy)
 *
 * This guarantees: if measuredDistance ≤ combined accuracy (student could be
 * at 0m from teacher), they ALWAYS pass regardless of configured radius.
 */
function evaluateLocationRange(
    teacherLat,
    teacherLon,
    studentLat,
    studentLon,
    configuredRadiusMeters,
    studentAccuracyMeters,
    teacherAccuracyMeters
) {
    const rawDistance    = getDistanceInMeters(teacherLat, teacherLon, studentLat, studentLon);
    const distanceMeters = Math.round(rawDistance);

    // Enforce minimum practical radius — 1m admin setting is physically unverifiable
    const configuredRadius = Math.max(
        Number(configuredRadiusMeters) || MINIMUM_CLASSROOM_RADIUS,
        MINIMUM_CLASSROOM_RADIUS
    );

    const sAcc = normalizeGpsAccuracy(studentAccuracyMeters);
    const tAcc = normalizeGpsAccuracy(teacherAccuracyMeters);

    // Combined accuracy: full sum (student + teacher) for CI lower-bound.
    // Capped to prevent fake high-accuracy exploitation.
    const cappedCombinedAccuracy = Math.min(sAcc + tAcc, MAX_GPS_UNCERTAINTY_ALLOWANCE);

    // Small-radius grace buffer
    const smallRadiusGrace = configuredRadius < SMALL_RADIUS_THRESHOLD ? SMALL_RADIUS_GRACE : 0;

    // ── Effective radius ───────────────────────────────────────────────────────
    // Must be AT LEAST the combined GPS accuracy, because it is physically
    // impossible to resolve positions more precisely than GPS allows.
    // Example: accuracy = 3m + 3m = 6m → effectiveRadius = max(configuredRadius, 6m)
    // If student is 12m away with 3+3=6m accuracy, minPossibleDist = 6m ≤ 50m → PASS.
    const effectiveRadius = Math.max(
        configuredRadius + smallRadiusGrace,
        cappedCombinedAccuracy
    );

    // ── Minimum possible distance ─────────────────────────────────────────────
    const minimumPossibleDistance = Math.max(0, distanceMeters - cappedCombinedAccuracy);

    // ── Decisions ─────────────────────────────────────────────────────────────
    const isAccuracyPoor = sAcc > MAX_GPS_ACCURACY_METERS;
    const isOutside      = minimumPossibleDistance > effectiveRadius;

    // NEAR: raw measured distance is above NEAR_BOUNDARY_RATIO × radius,
    // BUT minimum-possible-distance is 0 (student could literally be at teacher's feet).
    // In this case force INSIDE — don't show "Near Boundary" for someone who
    // could physically be at 0m.
    const couldBeAtZero = minimumPossibleDistance === 0;
    const isNear        = !isOutside && !couldBeAtZero &&
                          distanceMeters > configuredRadius * NEAR_BOUNDARY_RATIO;

    // ── Status ────────────────────────────────────────────────────────────────
    let status;
    let reasonCode;

    if (isOutside) {
        status     = "OUTSIDE";
        reasonCode = "TOO_FAR";
    } else if (isNear) {
        status     = "NEAR";
        reasonCode = "NEAR_BOUNDARY";
    } else {
        // couldBeAtZero OR genuinely inside configured radius
        status     = "INSIDE";
        reasonCode = isAccuracyPoor ? "OK_POOR_GPS" : "OK";
    }

    return {
        measuredDistance:        distanceMeters,
        minimumPossibleDistance: minimumPossibleDistance,
        configuredRadius:        configuredRadius,
        effectiveRadius:         effectiveRadius,
        uncertaintyAllowance:    cappedCombinedAccuracy,
        studentAccuracy:         sAcc,
        teacherAccuracy:         tAcc,
        isOutside:               isOutside,
        isAccuracyPoor:          isAccuracyPoor,
        isNear:                  isNear,
        status:                  status,
        reasonCode:              reasonCode,
        distanceLabel:           formatDistance(distanceMeters)
    };
}

/**
 * Returns a human-readable explanation of the evaluation result.
 */
function getLocationDecisionMessage(evaluation) {
    if (!evaluation) return "Location could not be evaluated.";

    if (evaluation.isOutside) {
        return (
            "You are outside the allowed range. " +
            "Measured distance: " + evaluation.measuredDistance + " m, " +
            "Minimum possible distance: " + evaluation.minimumPossibleDistance + " m, " +
            "Allowed radius: " + Math.round(evaluation.effectiveRadius) + " m."
        );
    }

    if (evaluation.isNear) {
        return (
            "You are near the classroom boundary. " +
            "Distance: " + evaluation.measuredDistance + " m, " +
            "Configured radius: " + evaluation.configuredRadius + " m. Attendance accepted."
        );
    }

    if (evaluation.isAccuracyPoor) {
        return (
            "GPS accuracy is low (" + Math.round(evaluation.studentAccuracy) + " m) " +
            "but you appear to be within range. Attendance accepted."
        );
    }

    return "Inside allowed range. Attendance accepted.";
}

module.exports = {
    getDistanceInMeters,
    normalizeGpsAccuracy,
    formatDistance,
    evaluateLocationRange,
    getLocationDecisionMessage,
    MAX_GPS_ACCURACY_METERS:              MAX_GPS_ACCURACY_METERS_EXPORT,
    MAX_GPS_UNCERTAINTY_ALLOWANCE_METERS: MAX_GPS_UNCERTAINTY_ALLOWANCE_EXPORT,
    SMALL_RADIUS_THRESHOLD_METERS:        SMALL_RADIUS_THRESHOLD_EXPORT,
    SMALL_RADIUS_GRACE_METERS:            SMALL_RADIUS_GRACE_EXPORT,
    NEAR_BOUNDARY_RATIO,
    MINIMUM_CLASSROOM_RADIUS
};
