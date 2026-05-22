function setupAdminSearch() {
    const searchInputs = document.querySelectorAll("[data-admin-search]");

    searchInputs.forEach(function (input) {
        const targetName = input.getAttribute("data-admin-search");
        const items = document.querySelectorAll("[data-search-group='" + targetName + "']");

        input.addEventListener("input", function () {
            const query = input.value.toLowerCase().trim();

            items.forEach(function (item) {
                const text = item.innerText.toLowerCase();

                if (text.includes(query)) {
                    item.classList.remove("hidden-by-search");
                } else {
                    item.classList.add("hidden-by-search");
                }
            });
        });
    });
}

function confirmAdminDelete(message) {
    return confirm(message || "Are you sure you want to delete this record?");
}

document.addEventListener("DOMContentLoaded", setupAdminSearch);