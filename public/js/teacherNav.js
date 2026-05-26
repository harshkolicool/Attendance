(function () {
    function getDashboardSections() {
        return {
            schedule: document.getElementById("schedule-section"),
            attendance: document.getElementById("attendance-section")
        };
    }

    function scrollToSection(section) {
        if (!section) {
            return;
        }

        const top =
            section.getBoundingClientRect().top +
            window.scrollY -
            96;

        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }

    function updateDashboardNavActive() {
        if (window.location.pathname !== "/teacher/dashboard") {
            return;
        }

        const hash = (window.location.hash || "").replace("#", "");
        const links = document.querySelectorAll(".teacher-sidebar .menu-link");

        links.forEach(function (link) {
            const href = link.getAttribute("href") || "";
            link.classList.remove("active");

            if (hash === "schedule-section" && href.includes("#schedule-section")) {
                link.classList.add("active");
            } else if (hash === "attendance-section" && href.includes("#attendance-section")) {
                link.classList.add("active");
            } else if (!hash && href === "/teacher/dashboard") {
                link.classList.add("active");
            }
        });
    }

    function handleHashOnLoad() {
        const sections = getDashboardSections();
        const hash = window.location.hash;

        if (hash === "#schedule-section") {
            scrollToSection(sections.schedule);
            updateDashboardNavActive();
        } else if (hash === "#attendance-section") {
            scrollToSection(sections.attendance);
            updateDashboardNavActive();
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (window.location.pathname === "/teacher/dashboard") {
            handleHashOnLoad();
        }

        document.querySelectorAll('.teacher-sidebar a[href*="#"]').forEach(function (link) {
            link.addEventListener("click", function (event) {
                const href = link.getAttribute("href") || "";

                if (!href.includes("/teacher/dashboard#")) {
                    return;
                }

                if (window.location.pathname !== "/teacher/dashboard") {
                    return;
                }

                event.preventDefault();

                const hash = href.split("#")[1];
                const sections = getDashboardSections();

                if (hash === "schedule-section") {
                    scrollToSection(sections.schedule);
                } else if (hash === "attendance-section") {
                    scrollToSection(sections.attendance);
                }

                history.replaceState(null, "", "#" + hash);
                updateDashboardNavActive();
            });
        });

        window.addEventListener("hashchange", function () {
            if (window.location.pathname === "/teacher/dashboard") {
                handleHashOnLoad();
            }
        });
    });
})();
