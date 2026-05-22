function resetSelect(select, placeholderText) {
    if (!select) {
        return;
    }

    const options = select.querySelectorAll("option");

    options.forEach(function (option) {
        if (option.value === "") {
            option.textContent = placeholderText || "Select";
            option.hidden = false;
            option.disabled = false;
            option.selected = true;
        } else {
            option.hidden = true;
            option.disabled = true;
            option.selected = false;
        }
    });

    select.disabled = true;
}

function enableSelect(select) {
    if (select) {
        select.disabled = false;
    }
}

function getSelectedOption(select) {
    if (!select) {
        return null;
    }

    return select.options[select.selectedIndex] || null;
}

function setupSubjectFormAutoFill() {
    const subjectForm = document.querySelector("form[action='/admin/subjects/create']");

    if (!subjectForm) {
        return;
    }

    const classGroupSelect = subjectForm.querySelector("select[name='classGroupId']");
    const departmentInput = subjectForm.querySelector("input[name='department']");
    const semesterInput = subjectForm.querySelector("input[name='semester']");

    if (!classGroupSelect) {
        return;
    }

    classGroupSelect.addEventListener("change", function () {
        const selectedOption = getSelectedOption(classGroupSelect);

        if (!selectedOption || !selectedOption.value) {
            return;
        }

        const department = selectedOption.getAttribute("data-department");
        const semester = selectedOption.getAttribute("data-semester");

        if (departmentInput && department) {
            departmentInput.value = department;
        }

        if (semesterInput && semester) {
            semesterInput.value = semester;
        }
    });
}

function setupStudentFormAutoFill() {
    const studentForm = document.querySelector("form[action='/admin/students/create']");

    if (!studentForm) {
        return;
    }

    const classGroupSelect = studentForm.querySelector("select[name='classGroupId']");
    const departmentInput = studentForm.querySelector("input[name='department']");
    const semesterInput = studentForm.querySelector("input[name='semester']");

    if (!classGroupSelect) {
        return;
    }

    classGroupSelect.addEventListener("change", function () {
        const selectedOption = getSelectedOption(classGroupSelect);

        if (!selectedOption || !selectedOption.value) {
            return;
        }

        const department = selectedOption.getAttribute("data-department");
        const semester = selectedOption.getAttribute("data-semester");

        if (departmentInput && department) {
            departmentInput.value = department;
        }

        if (semesterInput && semester) {
            semesterInput.value = semester;
        }
    });
}

function showScheduleHint(text, type) {
    const hintBox = document.getElementById("scheduleDynamicHint");

    if (!hintBox) {
        return;
    }

    hintBox.textContent = text;
    hintBox.className = "admin-dynamic-hint";

    if (type) {
        hintBox.classList.add(type);
    }
}

function setupScheduleFormFilters() {
    const scheduleForm = document.querySelector("form[action='/admin/schedules/create']");

    if (!scheduleForm) {
        return;
    }

    const classGroupSelect = scheduleForm.querySelector("select[name='classGroupId']");
    const subjectSelect = scheduleForm.querySelector("select[name='subjectId']");
    const teacherSelect = scheduleForm.querySelector("select[name='teacherId']");

    if (!classGroupSelect || !subjectSelect || !teacherSelect) {
        return;
    }

    resetSelect(subjectSelect, "Select Class Group First");
    resetSelect(teacherSelect, "Select Subject First");

    classGroupSelect.addEventListener("change", function () {
        const classGroupId = classGroupSelect.value;

        resetSelect(subjectSelect, "Select Subject");
        resetSelect(teacherSelect, "Select Subject First");

        if (!classGroupId) {
            resetSelect(subjectSelect, "Select Class Group First");
            showScheduleHint("Select a class group to load its subjects.", "info");
            return;
        }

        let visibleSubjects = 0;

        const subjectOptions = subjectSelect.querySelectorAll("option");

        subjectOptions.forEach(function (option) {
            if (option.value === "") {
                option.hidden = false;
                option.disabled = false;
                option.selected = true;
                return;
            }

            const subjectClassGroupId = option.getAttribute("data-class-group-id");

            if (subjectClassGroupId === classGroupId) {
                option.hidden = false;
                option.disabled = false;
                visibleSubjects++;
            }
        });

        enableSelect(subjectSelect);

        if (visibleSubjects === 0) {
            resetSelect(subjectSelect, "No Subjects In This Class");
            showScheduleHint("No subjects found for this class group. Create a subject first.", "error");
        } else {
            showScheduleHint("Subjects filtered by selected class group.", "success");
        }
    });

    subjectSelect.addEventListener("change", function () {
        const selectedSubjectOption = getSelectedOption(subjectSelect);

        resetSelect(teacherSelect, "Select Teacher");

        if (!selectedSubjectOption || !selectedSubjectOption.value) {
            resetSelect(teacherSelect, "Select Subject First");
            showScheduleHint("Select a subject to load assigned teachers.", "info");
            return;
        }

        const teacherIdsText = selectedSubjectOption.getAttribute("data-teacher-ids") || "";
        const allowedTeacherIds = teacherIdsText
            .split(",")
            .map(function (id) {
                return id.trim();
            })
            .filter(function (id) {
                return id.length > 0;
            });

        let visibleTeachers = 0;

        const teacherOptions = teacherSelect.querySelectorAll("option");

        teacherOptions.forEach(function (option) {
            if (option.value === "") {
                option.hidden = false;
                option.disabled = false;
                option.selected = true;
                return;
            }

            if (allowedTeacherIds.includes(option.value)) {
                option.hidden = false;
                option.disabled = false;
                visibleTeachers++;
            }
        });

        enableSelect(teacherSelect);

        if (visibleTeachers === 0) {
            resetSelect(teacherSelect, "No Teacher Assigned");
            showScheduleHint("No teacher is assigned to this subject. Update subject first.", "error");
        } else {
            showScheduleHint("Teachers filtered by selected subject.", "success");
        }
    });

    scheduleForm.addEventListener("submit", function (event) {
        const selectedSubjectOption = getSelectedOption(subjectSelect);
        const classGroupId = classGroupSelect.value;
        const teacherId = teacherSelect.value;

        if (!classGroupId || !subjectSelect.value || !teacherId) {
            event.preventDefault();
            showScheduleHint("Please select class group, subject and teacher correctly.", "error");
            return false;
        }

        const subjectClassGroupId = selectedSubjectOption.getAttribute("data-class-group-id");

        if (subjectClassGroupId !== classGroupId) {
            event.preventDefault();
            showScheduleHint("Selected subject does not belong to this class group.", "error");
            return false;
        }

        const teacherIdsText = selectedSubjectOption.getAttribute("data-teacher-ids") || "";
        const allowedTeacherIds = teacherIdsText
            .split(",")
            .map(function (id) {
                return id.trim();
            });

        if (!allowedTeacherIds.includes(teacherId)) {
            event.preventDefault();
            showScheduleHint("Selected teacher is not assigned to this subject.", "error");
            return false;
        }

        return true;
    });
}

function setupAdminDynamicForms() {
    setupSubjectFormAutoFill();
    setupStudentFormAutoFill();
    setupScheduleFormFilters();
}

document.addEventListener("DOMContentLoaded", setupAdminDynamicForms);