(function () {
    const START_ATTENDANCE_PATH = "/teacher/attendance/start";

    function showLocationError(message) {
        const text = message || "Please allow location access to start attendance.";
        const box = document.createElement("div");
        box.className = "alert-box error";

        const icon = document.createElement("i");
        icon.className = "fa-solid fa-circle-exclamation";

        box.appendChild(icon);
        box.appendChild(document.createTextNode(" " + text));

        const main = document.querySelector(".teacher-main");
        const header = main ? main.querySelector(".teacher-header") : null;

        if (main && header) {
            const oldBox = main.querySelector("#teacherLocationClientError");

            if (oldBox) {
                oldBox.remove();
            }

            box.id = "teacherLocationClientError";
            header.insertAdjacentElement("afterend", box);

            box.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            return;
        }

        alert(text);
    }

    function getStartButton(form) {
        if (!form) {
            return null;
        }

        return form.querySelector("button[type='submit']");
    }

    function setButtonLoading(form, loadingText) {
        const button = getStartButton(form);

        if (!button) {
            return "";
        }

        const oldText = button.textContent;
        button.textContent = loadingText || "Getting Location...";
        button.disabled = true;

        return oldText;
    }

    function resetButton(form, oldText) {
        const button = getStartButton(form);

        if (!button) {
            return;
        }

        if (oldText) {
            button.textContent = oldText;
        }

        button.disabled = false;
    }

    function getLocationInputs(form) {
        return {
            latitudeInput: form.querySelector("input[name='teacherLatitude']"),
            longitudeInput: form.querySelector("input[name='teacherLongitude']"),
            accuracyInput: form.querySelector("input[name='teacherAccuracy']")
        };
    }

    function isStartAttendanceForm(form) {
        if (!form) {
            return false;
        }

        const action = form.getAttribute("action") || "";

        if (!action) {
            return false;
        }

        try {
            const url = new URL(action, window.location.origin);
            return url.pathname === START_ATTENDANCE_PATH;
        } catch (err) {
            return action.indexOf(START_ATTENDANCE_PATH) !== -1;
        }
    }

    function getGeoErrorMessage(error) {
        if (!error || typeof error.code === "undefined") {
            return "Please allow location access to start attendance.";
        }

        if (error.code === 1) {
            return "Location access is blocked. Please allow location permission in browser/site settings and try again.";
        }

        if (error.code === 2) {
            return "Unable to detect your location. Check GPS/network and try again.";
        }

        if (error.code === 3) {
            return "Location request timed out. Please try again.";
        }

        return "Please allow location access to start attendance.";
    }

    function getBestTeacherLocationPosition() {
        return new Promise(function (resolve, reject) {
            const samples = [];
            let lastError = null;
            let finished = false;
            let watchId = null;
            let timeoutId = null;

            const targetAccuracyMeters = 20;
            const acceptableAccuracyMeters = 50;
            const minimumSamples = 3;
            const maxWaitMs = 18000;

            function cleanup() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                }
            }

            function getAccuracy(position) {
                return Number(
                    position &&
                    position.coords &&
                    Number.isFinite(Number(position.coords.accuracy))
                        ? position.coords.accuracy
                        : 999999
                );
            }

            function getBestSample() {
                samples.sort(function (first, second) {
                    return getAccuracy(first) - getAccuracy(second);
                });

                return samples[0];
            }

            function finish(error) {
                if (finished) {
                    return;
                }

                finished = true;
                cleanup();

                if (samples.length === 0) {
                    reject(error || lastError || new Error("Could not get location."));
                    return;
                }

                resolve(getBestSample());
            }

            function addSample(position) {
                if (finished || !position || !position.coords) {
                    return;
                }

                samples.push(position);

                const accuracy = getAccuracy(position);

                if (samples.length >= minimumSamples && accuracy <= targetAccuracyMeters) {
                    finish();
                    return;
                }

                if (samples.length >= minimumSamples && accuracy <= acceptableAccuracyMeters) {
                    setTimeout(function () {
                        if (!finished) {
                            finish();
                        }
                    }, 1200);
                }
            }

            function handleError(error) {
                lastError = error;

                if (error && Number(error.code) === 1) {
                    finish(error);
                }
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            };

            navigator.geolocation.getCurrentPosition(addSample, handleError, options);

            try {
                watchId = navigator.geolocation.watchPosition(addSample, handleError, options);
            } catch (error) {
                lastError = error;
            }

            timeoutId = setTimeout(function () {
                finish();
            }, maxWaitMs);
        });
    }

    function requestAndSubmitTeacherLocation(form) {
        const inputs = getLocationInputs(form);

        if (!inputs.latitudeInput || !inputs.longitudeInput || !inputs.accuracyInput) {
            showLocationError("Location inputs are missing in the form.");
            return false;
        }

        if (!navigator.geolocation) {
            showLocationError("Your browser does not support location access.");
            return false;
        }

        if (
            !window.isSecureContext &&
            window.location.hostname !== "localhost" &&
            window.location.hostname !== "127.0.0.1"
        ) {
            showLocationError("Location works only on HTTPS or localhost. Please open the secure URL and try again.");
            return false;
        }

        if (form.dataset.locationPending === "true") {
            return false;
        }

        form.dataset.locationPending = "true";

        const oldText = setButtonLoading(form, "Getting Best Location...");

        getBestTeacherLocationPosition()
            .then(function (position) {
                inputs.latitudeInput.value = position.coords.latitude;
                inputs.longitudeInput.value = position.coords.longitude;
                inputs.accuracyInput.value = position.coords.accuracy;

                form.dataset.locationPending = "false";
                HTMLFormElement.prototype.submit.call(form);
            })
            .catch(function (error) {
                form.dataset.locationPending = "false";
                resetButton(form, oldText);
                showLocationError(getGeoErrorMessage(error));
            });

        return false;
    }

    function handleStartAttendanceSubmit(event) {
        const form = event.target;

        if (!isStartAttendanceForm(form)) {
            return;
        }

        event.preventDefault();
        requestAndSubmitTeacherLocation(form);
    }

    function registerStartAttendanceHandlers() {
        document.addEventListener("submit", handleStartAttendanceSubmit, true);
    }

    function getTeacherLocationAndSubmit(event, form) {
        if (event && typeof event.preventDefault === "function") {
            event.preventDefault();
        }

        if (!form || !isStartAttendanceForm(form)) {
            return true;
        }

        return requestAndSubmitTeacherLocation(form);
    }

    window.getTeacherLocationAndSubmit = getTeacherLocationAndSubmit;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", registerStartAttendanceHandlers);
    } else {
        registerStartAttendanceHandlers();
    }
})();