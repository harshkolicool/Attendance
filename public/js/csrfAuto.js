(function () {
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');

        if (!meta) {
            return "";
        }

        return meta.getAttribute("content") || "";
    }

    function isUnsafeMethod(method) {
        const upperMethod = String(method || "GET").toUpperCase();

        return (
            upperMethod === "POST" ||
            upperMethod === "PUT" ||
            upperMethod === "PATCH" ||
            upperMethod === "DELETE"
        );
    }

    function isMultipartForm(form) {
        const enctype = String(
            form.getAttribute("enctype") ||
            form.enctype ||
            ""
        ).toLowerCase();

        return enctype.includes("multipart/form-data");
    }

    function addCsrfToFormAction(form, token) {
        if (!form || !token) {
            return;
        }

        const currentAction = form.getAttribute("action") || window.location.href;
        const url = new URL(currentAction, window.location.origin);

        url.searchParams.set("_csrf", token);

        form.setAttribute("action", url.pathname + url.search + url.hash);
    }

    function ensureFormToken(form) {
        if (!form) {
            return;
        }

        const method = String(form.getAttribute("method") || "GET").toUpperCase();

        if (!isUnsafeMethod(method)) {
            return;
        }

        const token = getCsrfToken();

        if (!token) {
            return;
        }

        let input = form.querySelector("input[name='_csrf']");

        if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = "_csrf";
            form.appendChild(input);
        }

        input.value = token;

        if (isMultipartForm(form)) {
            addCsrfToFormAction(form, token);
        }
    }

    function prepareAllForms() {
        const forms = document.querySelectorAll("form");

        forms.forEach(function (form) {
            ensureFormToken(form);
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        prepareAllForms();
    });

    document.addEventListener(
        "submit",
        function (event) {
            ensureFormToken(event.target);
        },
        true
    );

    const originalFetch = window.fetch;

    window.fetch = function (input, init) {
        init = init || {};

        let method = init.method;

        if (!method && input && typeof input === "object" && input.method) {
            method = input.method;
        }

        method = method || "GET";

        if (isUnsafeMethod(method)) {
            const token = getCsrfToken();

            if (token) {
                if (!init.headers) {
                    init.headers = {};
                }

                if (init.headers instanceof Headers) {
                    init.headers.set("X-CSRF-Token", token);
                } else if (Array.isArray(init.headers)) {
                    init.headers.push(["X-CSRF-Token", token]);
                } else {
                    init.headers["X-CSRF-Token"] = token;
                }
            }
        }

        return originalFetch(input, init);
    };
})();