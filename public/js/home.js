document.addEventListener("DOMContentLoaded", function () {
    const menuButton = document.getElementById("homeMenuBtn");
    const navLinks = document.getElementById("homeNavLinks");

    if (!menuButton || !navLinks) {
        return;
    }

    menuButton.addEventListener("click", function () {
        navLinks.classList.toggle("open");

        const icon = menuButton.querySelector("i");

        if (!icon) {
            return;
        }

        if (navLinks.classList.contains("open")) {
            icon.classList.remove("fa-bars");
            icon.classList.add("fa-xmark");
        } else {
            icon.classList.remove("fa-xmark");
            icon.classList.add("fa-bars");
        }
    });
});