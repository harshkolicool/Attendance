(function () {
    function formatTime(hour, minute) {
        let period = "AM";
        let displayHour = hour;

        if (hour === 0) {
            displayHour = 12;
        } else if (hour === 12) {
            period = "PM";
        } else if (hour > 12) {
            displayHour = hour - 12;
            period = "PM";
        }

        const displayMinute = minute.toString().padStart(2, "0");
        const formattedHour = displayHour.toString().padStart(2, "0");

        return formattedHour + ":" + displayMinute + " " + period;
    }

    function convertInputTimeToDisplay(inputTime) {
        if (!inputTime) {
            return "";
        }

        const parts = inputTime.split(":");

        if (parts.length !== 2) {
            return "";
        }

        const hour = Number(parts[0]);
        const minute = Number(parts[1]);

        if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
            return "";
        }

        return formatTime(hour, minute);
    }

    function convertDisplayTimeToInput(timeText) {
        if (!timeText) {
            return "";
        }

        const parts = timeText.trim().split(" ");

        if (parts.length !== 2) {
            return "";
        }

        const timePart = parts[0];
        const period = parts[1].toUpperCase();
        const timeParts = timePart.split(":");

        if (timeParts.length !== 2) {
            return "";
        }

        let hour = Number(timeParts[0]);
        const minute = Number(timeParts[1]);

        if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
            return "";
        }

        if (period === "AM" && hour === 12) {
            hour = 0;
        }

        if (period === "PM" && hour !== 12) {
            hour = hour + 12;
        }

        return (
            hour.toString().padStart(2, "0") +
            ":" +
            minute.toString().padStart(2, "0")
        );
    }

    function convertTimeToMinutes(timeText) {
        if (!timeText) {
            return null;
        }

        const parts = timeText.trim().split(" ");

        if (parts.length !== 2) {
            return null;
        }

        const timePart = parts[0];
        const period = parts[1].toUpperCase();
        const timeParts = timePart.split(":");

        if (timeParts.length !== 2) {
            return null;
        }

        let hour = Number(timeParts[0]);
        const minute = Number(timeParts[1]);

        if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
            return null;
        }

        if (period === "AM" && hour === 12) {
            hour = 0;
        }

        if (period === "PM" && hour !== 12) {
            hour = hour + 12;
        }

        return hour * 60 + minute;
    }

    function addTimeOptions(select) {
        if (!select || select.dataset.loaded === "true") {
            return;
        }

        const startHour = 7;
        const endHour = 20;
        const intervalMinutes = 15;

        for (let hour = startHour; hour <= endHour; hour++) {
            for (let minute = 0; minute < 60; minute += intervalMinutes) {
                if (hour === endHour && minute > 0) {
                    break;
                }

                const timeText = formatTime(hour, minute);

                const option = document.createElement("option");
                option.value = timeText;
                option.textContent = timeText;

                select.appendChild(option);
            }
        }

        const customOption = document.createElement("option");
        customOption.value = "CUSTOM";
        customOption.textContent = "Custom Time";
        select.appendChild(customOption);

        select.dataset.loaded = "true";
    }

    function optionExists(select, value) {
        return Array.from(select.options).some(function (option) {
            return option.value === value;
        });
    }

    function getSelectedTime(presetSelect, customInput) {
        if (!presetSelect) {
            return "";
        }

        if (presetSelect.value === "CUSTOM") {
            return convertInputTimeToDisplay(customInput.value);
        }

        return presetSelect.value;
    }

    function updateHiddenValues(elements) {
        elements.finalStart.value = getSelectedTime(
            elements.startPreset,
            elements.customStart
        );

        elements.finalEnd.value = getSelectedTime(
            elements.endPreset,
            elements.customEnd
        );
    }

    function toggleCustomInputs(elements) {
        if (elements.startPreset.value === "CUSTOM") {
            elements.customStart.hidden = false;
            elements.customStart.required = true;
        } else {
            elements.customStart.hidden = true;
            elements.customStart.required = false;
            elements.customStart.value = "";
        }

        if (elements.endPreset.value === "CUSTOM") {
            elements.customEnd.hidden = false;
            elements.customEnd.required = true;
        } else {
            elements.customEnd.hidden = true;
            elements.customEnd.required = false;
            elements.customEnd.value = "";
        }

        updateHiddenValues(elements);
    }

    function filterEndTimeOptions(elements) {
        const startTime = getSelectedTime(
            elements.startPreset,
            elements.customStart
        );

        const startMinutes = convertTimeToMinutes(startTime);

        Array.from(elements.endPreset.options).forEach(function (option) {
            if (!option.value || option.value === "CUSTOM") {
                option.hidden = false;
                option.disabled = false;
                return;
            }

            const endMinutes = convertTimeToMinutes(option.value);

            if (
                startMinutes !== null &&
                endMinutes !== null &&
                endMinutes <= startMinutes
            ) {
                option.hidden = true;
                option.disabled = true;
            } else {
                option.hidden = false;
                option.disabled = false;
            }
        });

        const endTime = getSelectedTime(
            elements.endPreset,
            elements.customEnd
        );

        const endMinutes = convertTimeToMinutes(endTime);

        if (
            elements.endPreset.value !== "CUSTOM" &&
            startMinutes !== null &&
            endMinutes !== null &&
            endMinutes <= startMinutes
        ) {
            elements.endPreset.value = "";
            elements.finalEnd.value = "";
        }
    }

    function setInitialTimeValues(elements) {
        const existingStartTime = elements.finalStart.value;
        const existingEndTime = elements.finalEnd.value;

        if (existingStartTime) {
            if (optionExists(elements.startPreset, existingStartTime)) {
                elements.startPreset.value = existingStartTime;
            } else {
                elements.startPreset.value = "CUSTOM";
                elements.customStart.value = convertDisplayTimeToInput(existingStartTime);
            }
        } else {
            elements.startPreset.value = "09:00 AM";
        }

        if (existingEndTime) {
            if (optionExists(elements.endPreset, existingEndTime)) {
                elements.endPreset.value = existingEndTime;
            } else {
                elements.endPreset.value = "CUSTOM";
                elements.customEnd.value = convertDisplayTimeToInput(existingEndTime);
            }
        } else {
            elements.endPreset.value = "10:00 AM";
        }

        toggleCustomInputs(elements);
        updateHiddenValues(elements);
        filterEndTimeOptions(elements);
    }

    function showScheduleTimeError(form, message) {
        let errorBox = form.querySelector(".admin-form-error-box");

        if (!errorBox) {
            errorBox = document.createElement("div");
            errorBox.className = "admin-form-error-box";
            form.insertBefore(errorBox, form.firstChild);
        }

        errorBox.innerHTML =
            "<strong>Please fix this error:</strong><ul><li>" +
            message +
            "</li></ul>";
    }

    function clearScheduleTimeError(form) {
        const errorBox = form.querySelector(".admin-form-error-box");

        if (errorBox) {
            errorBox.remove();
        }
    }

    function setupOneScheduleForm(form) {
        const elements = {
            form: form,
            startPreset: form.querySelector(".js-start-time-preset"),
            endPreset: form.querySelector(".js-end-time-preset"),
            customStart: form.querySelector(".js-custom-start-time"),
            customEnd: form.querySelector(".js-custom-end-time"),
            finalStart: form.querySelector(".js-final-start-time"),
            finalEnd: form.querySelector(".js-final-end-time")
        };

        if (
            !elements.startPreset ||
            !elements.endPreset ||
            !elements.customStart ||
            !elements.customEnd ||
            !elements.finalStart ||
            !elements.finalEnd
        ) {
            return;
        }

        addTimeOptions(elements.startPreset);
        addTimeOptions(elements.endPreset);

        setInitialTimeValues(elements);

        elements.startPreset.addEventListener("change", function () {
            clearScheduleTimeError(form);
            toggleCustomInputs(elements);
            filterEndTimeOptions(elements);
            updateHiddenValues(elements);
        });

        elements.endPreset.addEventListener("change", function () {
            clearScheduleTimeError(form);
            toggleCustomInputs(elements);
            updateHiddenValues(elements);
        });

        elements.customStart.addEventListener("change", function () {
            clearScheduleTimeError(form);
            filterEndTimeOptions(elements);
            updateHiddenValues(elements);
        });

        elements.customEnd.addEventListener("change", function () {
            clearScheduleTimeError(form);
            updateHiddenValues(elements);
        });

        form.addEventListener("submit", function (event) {
            updateHiddenValues(elements);

            const startMinutes = convertTimeToMinutes(elements.finalStart.value);
            const endMinutes = convertTimeToMinutes(elements.finalEnd.value);

            if (startMinutes === null || endMinutes === null) {
                event.preventDefault();
                showScheduleTimeError(form, "Please select start time and end time.");
                return false;
            }

            if (endMinutes <= startMinutes) {
                event.preventDefault();
                showScheduleTimeError(form, "End time must be greater than start time.");
                return false;
            }

            return true;
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        const scheduleForms = document.querySelectorAll(".js-schedule-form");

        scheduleForms.forEach(function (form) {
            setupOneScheduleForm(form);
        });
    });
})();