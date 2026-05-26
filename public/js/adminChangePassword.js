document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("adminChangePasswordForm");

    const currentPassword = document.getElementById("currentPassword");
    const newPassword = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");

    const currentPasswordError = document.getElementById("currentPasswordError");
    const newPasswordError = document.getElementById("newPasswordError");
    const confirmPasswordError = document.getElementById("confirmPasswordError");

    document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
        button.addEventListener("click", function () {
            const inputId = button.getAttribute("data-toggle-password");
            const input = document.getElementById(inputId);
            const icon = button.querySelector("i");

            if (!input) {
                return;
            }

            if (input.type === "password") {
                input.type = "text";

                if (icon) {
                    icon.className = "fa-solid fa-eye-slash";
                }
            } else {
                input.type = "password";

                if (icon) {
                    icon.className = "fa-solid fa-eye";
                }
            }
        });
    });

    if (!form) {
        return;
    }

    form.addEventListener("submit", function (event) {
        let isValid = true;

        currentPasswordError.textContent = "";
        newPasswordError.textContent = "";
        confirmPasswordError.textContent = "";

        if (!currentPassword.value.trim()) {
            currentPasswordError.textContent = "Current password is required.";
            isValid = false;
        }

        if (!newPassword.value.trim()) {
            newPasswordError.textContent = "New password is required.";
            isValid = false;
        } else if (newPassword.value.length < 6) {
            newPasswordError.textContent = "New password must be at least 6 characters.";
            isValid = false;
        }

        if (!confirmPassword.value.trim()) {
            confirmPasswordError.textContent = "Confirm password is required.";
            isValid = false;
        } else if (newPassword.value !== confirmPassword.value) {
            confirmPasswordError.textContent = "Passwords do not match.";
            isValid = false;
        }

        if (
            currentPassword.value &&
            newPassword.value &&
            currentPassword.value === newPassword.value
        ) {
            newPasswordError.textContent = "New password cannot be the same as current password.";
            isValid = false;
        }

        if (!isValid) {
            event.preventDefault();
        }
    });
});