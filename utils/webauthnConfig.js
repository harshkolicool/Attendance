require("dotenv").config();

function removeProtocol(value) {
    const raw = String(value || "").trim();

    if (!raw) {
        return "";
    }

    const normalized = /^https?:\/\//i.test(raw)
        ? raw
        : "http://" + raw;

    try {
        return new URL(normalized).hostname.toLowerCase();
    } catch (err) {
        return raw
            .replace("https://", "")
            .replace("http://", "")
            .split("/")[0]
            .split(":")[0]
            .trim()
            .toLowerCase();
    }
}

function normalizeOrigin(value) {
    return String(value || "").replace(/\/+$/, "").trim();
}

function getRequestHost(req) {
    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost
        ? forwardedHost.split(",")[0].trim()
        : req.get("host");

    return removeProtocol(host);
}

function getRequestOrigin(req) {
    const forwardedHost = req.get("x-forwarded-host");
    const host = forwardedHost
        ? forwardedHost.split(",")[0].trim()
        : req.get("host");

    const forwardedProto = req.get("x-forwarded-proto");

    let protocol = req.protocol;

    if (forwardedProto) {
        protocol = forwardedProto.split(",")[0].trim();
    }

    return protocol + "://" + host;
}

function isLocalHost(value) {
    return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function hostMatchesRpID(host, rpID) {
    if (!host || !rpID) {
        return false;
    }

    if (host === rpID) {
        return true;
    }

    return host.endsWith("." + rpID);
}

function getWebAuthnConfig(req) {
    const requestHost = getRequestHost(req);
    const requestOrigin = normalizeOrigin(getRequestOrigin(req));

    const envRpID = removeProtocol(process.env.WEBAUTHN_RP_ID);
    const envOrigin = normalizeOrigin(process.env.WEBAUTHN_ORIGIN);

    if (isLocalHost(requestHost)) {
        return {
            rpName: "Attendify",
            rpID: requestHost,
            origin: requestOrigin
        };
    }

    if (
        envRpID &&
        envOrigin &&
        hostMatchesRpID(requestHost, envRpID) &&
        requestOrigin === envOrigin
    ) {
        return {
            rpName: "Attendify",
            rpID: envRpID,
            origin: envOrigin
        };
    }

    return {
        rpName: "Attendify",
        rpID: requestHost,
        origin: requestOrigin
    };
}

async function getSimpleWebAuthnServer() {
    const importedModule = await import("@simplewebauthn/server");
    return importedModule.default || importedModule;
}

module.exports = {
    getWebAuthnConfig,
    getSimpleWebAuthnServer
};
