const sidebarToggleButton = document.getElementById("adminSidebarToggle");

const savedSidebarState = localStorage.getItem("adminSidebarCollapsed");

if (savedSidebarState === "true") {
    document.body.classList.add("admin-sidebar-collapsed");
}

if (sidebarToggleButton) {
    sidebarToggleButton.addEventListener("click", function () {
        document.body.classList.toggle("admin-sidebar-collapsed");

        const isCollapsed = document.body.classList.contains("admin-sidebar-collapsed");

        localStorage.setItem("adminSidebarCollapsed", isCollapsed);
    });
}