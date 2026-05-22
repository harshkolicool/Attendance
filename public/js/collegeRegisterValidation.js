function cleanValue(value) {
    if (!value) {
        return "";
    }

    return value.toString().trim();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
    return /^[0-9+\-\s]{7,20}$/.test(phone);
}

function showErrors(form, errors) {
    let errorBox = form.querySelector(".form-error-box");

    if (!errorBox) {
        errorBox = document.createElement("div");
        errorBox.className = "form-error-box";
        form.insertBefore(errorBox, form.firstChild);
    }

    let html = "<strong>Please fix these errors:</strong><ul>";

    errors.forEach(function (error) {
        html += "<li>" + error + "</li>";
    });

    html += "</ul>";

    errorBox.innerHTML = html;
}

function clearErrors(form) {
    const oldBox = form.querySelector(".form-error-box");

    if (oldBox) {
        oldBox.remove();
    }

    const invalidFields = form.querySelectorAll(".field-invalid");

    invalidFields.forEach(function (field) {
        field.classList.remove("field-invalid");
    });
}

function markInvalid(form, name) {
    const field = form.elements[name];

    if (field) {
        field.classList.add("field-invalid");
    }
}

function validateRequired(form, name, label, errors) {
    const value = cleanValue(form.elements[name] ? form.elements[name].value : "");

    if (!value) {
        errors.push(label + " is required.");
        markInvalid(form, name);
        return false;
    }

    return true;
}

document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("collegeRegisterForm");

    if (!form) {
        return;
    }

    form.addEventListener("input", function () {
        clearErrors(form);
    });

    form.addEventListener("submit", function (event) {
        clearErrors(form);

        const errors = [];

        validateRequired(form, "collegeName", "College Name", errors);
        validateRequired(form, "address", "Address", errors);
        validateRequired(form, "city", "City", errors);
        validateRequired(form, "state", "State", errors);
        validateRequired(form, "adminFullName", "Admin Full Name", errors);

        if (validateRequired(form, "adminEmail", "Admin Email", errors)) {
            const email = cleanValue(form.elements.adminEmail.value);

            if (!isValidEmail(email)) {
                errors.push("Admin Email must be valid.");
                markInvalid(form, "adminEmail");
            }
        }

        if (validateRequired(form, "adminPhone", "Phone Number", errors)) {
            const phone = cleanValue(form.elements.adminPhone.value);

            if (!isValidPhone(phone)) {
                errors.push("Phone number must be valid.");
                markInvalid(form, "adminPhone");
            }
        }

        if (errors.length > 0) {
            event.preventDefault();
            showErrors(form, errors);

            const firstInvalid = form.querySelector(".field-invalid");

            if (firstInvalid) {
                firstInvalid.focus();
            }

            return false;
        }

        const button = form.querySelector("button[type='submit']");

        if (button) {
            button.disabled = true;
            button.innerHTML = "Submitting...";
        }

        return true;
    });
});