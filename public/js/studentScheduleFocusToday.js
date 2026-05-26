(function () {
    "use strict";

    function getTodayPanel() {
        return document.querySelector(".weekly-day-panel[data-day-offset='0']");
    }

    function getTopOffset() {
        const header = document.querySelector(".dashboard-header");
        if (!header) {
            return 20;
        }

        return Math.round(header.getBoundingClientRect().height + 20);
    }

    function scrollToTodayPanel() {
        const todayPanel = getTodayPanel();
        if (!todayPanel) {
            return;
        }

        if (window.location.hash) {
            return;
        }

        const offset = getTopOffset();
        const top = todayPanel.getBoundingClientRect().top + window.scrollY - offset;

        window.scrollTo({
            top: Math.max(0, top),
            behavior: "auto"
        });
    }

    function runOnceReady() {
        if (!window.location.pathname.startsWith("/student/schedule")) {
            return;
        }

        // Wait for layout to settle before applying the initial focus.
        requestAnimationFrame(function () {
            requestAnimationFrame(scrollToTodayPanel);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runOnceReady);
    } else {
        runOnceReady();
    }

    window.addEventListener("load", function () {
        setTimeout(scrollToTodayPanel, 80);
    });
})();
