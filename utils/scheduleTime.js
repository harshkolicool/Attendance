function timeToMinutes(timeText) {
    if (!timeText || typeof timeText !== "string") {
        return null;
    }

    const rawTime = timeText.trim().toUpperCase();

    const twelveHourMatch = rawTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);

    if (twelveHourMatch) {
        let hours = Number(twelveHourMatch[1]);
        const minutes = Number(twelveHourMatch[2]);
        const period = twelveHourMatch[3];

        if (
            Number.isNaN(hours) ||
            Number.isNaN(minutes) ||
            hours < 1 ||
            hours > 12 ||
            minutes < 0 ||
            minutes > 59
        ) {
            return null;
        }

        if (period === "AM" && hours === 12) {
            hours = 0;
        }

        if (period === "PM" && hours !== 12) {
            hours = hours + 12;
        }

        return hours * 60 + minutes;
    }

    const twentyFourHourMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);

    if (twentyFourHourMatch) {
        const hours = Number(twentyFourHourMatch[1]);
        const minutes = Number(twentyFourHourMatch[2]);

        if (
            Number.isNaN(hours) ||
            Number.isNaN(minutes) ||
            hours < 0 ||
            hours > 23 ||
            minutes < 0 ||
            minutes > 59
        ) {
            return null;
        }

        return hours * 60 + minutes;
    }

    return null;
}

function sortSchedulesByTime(schedules) {
    schedules.sort(function (a, b) {
        const firstTime = timeToMinutes(a.startTime);
        const secondTime = timeToMinutes(b.startTime);

        if (firstTime === null && secondTime === null) {
            return 0;
        }

        if (firstTime === null) {
            return 1;
        }

        if (secondTime === null) {
            return -1;
        }

        return firstTime - secondTime;
    });

    return schedules;
}

function sortSchedulesByDayAndTime(schedules) {
    const dayOrder = {
        Sunday: 0,
        Monday: 1,
        Tuesday: 2,
        Wednesday: 3,
        Thursday: 4,
        Friday: 5,
        Saturday: 6
    };

    schedules.sort(function (a, b) {
        const firstDay = dayOrder[a.day];
        const secondDay = dayOrder[b.day];

        const safeFirstDay = firstDay === undefined ? 99 : firstDay;
        const safeSecondDay = secondDay === undefined ? 99 : secondDay;

        if (safeFirstDay !== safeSecondDay) {
            return safeFirstDay - safeSecondDay;
        }

        const firstTime = timeToMinutes(a.startTime);
        const secondTime = timeToMinutes(b.startTime);

        if (firstTime === null && secondTime === null) {
            return 0;
        }

        if (firstTime === null) {
            return 1;
        }

        if (secondTime === null) {
            return -1;
        }

        return firstTime - secondTime;
    });

    return schedules;
}

function getTodayRange() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    return {
        start: start,
        end: end
    };
}

function getScheduleTimeStatus(startTime, endTime, currentDate) {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (startMinutes === null || endMinutes === null) {
        return "invalid";
    }

    if (endMinutes <= startMinutes) {
        return "invalid";
    }

    const now = currentDate || new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (currentMinutes < startMinutes) {
        return "upcoming";
    }

    if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
        return "live";
    }

    return "ended";
}

module.exports = {
    timeToMinutes,
    sortSchedulesByTime,
    sortSchedulesByDayAndTime,
    getTodayRange,
    getScheduleTimeStatus
};