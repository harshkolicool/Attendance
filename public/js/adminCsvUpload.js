document.addEventListener("DOMContentLoaded", function () {
    const csvInput = document.getElementById("studentsCsvInput");
    const fileNameText = document.getElementById("studentsCsvFileName");

    if (!csvInput || !fileNameText) {
        return;
    }

    csvInput.addEventListener("change", function () {
        if (csvInput.files && csvInput.files.length > 0) {
            fileNameText.textContent = csvInput.files[0].name;
        } else {
            fileNameText.textContent = "Choose CSV file";
        }
    });
});