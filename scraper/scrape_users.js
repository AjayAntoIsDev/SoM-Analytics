const fs = require("fs");
const path = require("path");
const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

const OUTPUT_FILE = path.resolve(__dirname, "users.json");
const RESUME_FILE = path.resolve(__dirname, "resume.json");

const BASE_URL = "https://summer.hackclub.com/api/v1/users?page=";

const MAX_RETRIES = 5;
const BASE_WAIT_MS = 2000;

const DEFAULT_START_COOKIE = "";

// --- Simple Cookie Jar ------------------------------------------------------
const cookieJar = {};
const INITIAL_COOKIE_HEADER = (() => {
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith("--cookies=")) return arg.slice("--cookies=".length);
    }
    return process.env.SOM_COOKIES || process.env.COOKIES || "";
})();
function loadInitialCookies(header) {
    if (!header) return;
    header.split(/;\s*/).forEach((kv) => {
        const eq = kv.indexOf("=");
        if (eq === -1) return;
        const k = kv.slice(0, eq).trim();
        const v = kv.slice(eq + 1).trim();
        if (k) cookieJar[k] = v;
    });
}
function setCookie(cookieStr) {
    const parts = cookieStr.split(/;\s*/);
    const [nameValue, ...attrs] = parts;
    const eqIdx = nameValue.indexOf("=");
    if (eqIdx === -1) return;
    const name = nameValue.slice(0, eqIdx).trim();
    const value = nameValue.slice(eqIdx + 1).trim();
    if (!name) return;
    if (value === "" || /deleted/i.test(value)) return;
    cookieJar[name] = value;
}
function captureSetCookies(res) {
    const raw = res.headers.raw?.()["set-cookie"] || [];
    for (const c of raw) setCookie(c);
}
function getCookieHeader() {
    const entries = Object.entries(cookieJar);
    if (!entries.length) return "";
    return entries.map(([k, v]) => `${k}=${v}`).join("; ");
}

function serializeCookies() {
    return cookieJar;
}
function restoreCookies(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) cookieJar[k] = v;
}

async function fetchPage(page, retry = 0) {
    const url = BASE_URL + page;
    try {
        const headers = {
            "User-Agent": "SoMUsersScraper/1.0 (Pls dont ban)",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            Pragma: "no-cache",
            "Cache-Control": "no-cache",
        };
        const cookieHeader = getCookieHeader();
        if (cookieHeader) headers.Cookie = cookieHeader;
        const res = await fetch(url, { method: "GET", headers });
        captureSetCookies(res);
        if (res.status === 429) {
            if (retry >= MAX_RETRIES)
                throw new Error("429 rate limit: max retries reached");
            const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10) * 1000;
            const wait = retryAfter || Math.min(60000, BASE_WAIT_MS * Math.pow(2, retry));
            console.warn(`Rate limited (429). Waiting ${wait / 1000}s then retrying page ${page} (attempt ${retry + 1})`);
            await new Promise((r) => setTimeout(r, wait));
            return fetchPage(page, retry + 1);
        }
        if (!res.ok) {
            if (retry >= MAX_RETRIES)
                throw new Error(`HTTP ${res.status} on page ${page}: max retries reached`);
            const wait = Math.min(60000, BASE_WAIT_MS * Math.pow(2, retry));
            console.warn(`HTTP ${res.status} for page ${page}. Waiting ${wait / 1000}s then retrying (attempt ${retry + 1})`);
            await new Promise((r) => setTimeout(r, wait));
            return fetchPage(page, retry + 1);
        }
        return res.json();
    } catch (e) {
        if (retry >= MAX_RETRIES) throw e;
        const wait = Math.min(60000, BASE_WAIT_MS * Math.pow(2, retry));
        console.warn(`Network error on page ${page}: ${e.message}. Waiting ${wait / 1000}s then retrying (attempt ${retry + 1})`);
        await new Promise((r) => setTimeout(r, wait));
        return fetchPage(page, retry + 1);
    }
}

async function main() {
    let users = [];
    let page = 1;
    let totalPages = null;
    let totalCount = null;
    const seen = new Set();

    const hasResume = fs.existsSync(RESUME_FILE);
    if (!hasResume) {
        if (INITIAL_COOKIE_HEADER) {
            loadInitialCookies(INITIAL_COOKIE_HEADER);
            console.log(`Loaded initial cookies (CLI/env): ${Object.keys(cookieJar).join(', ') || 'none'}`);
        } else if (DEFAULT_START_COOKIE) {
            loadInitialCookies(DEFAULT_START_COOKIE);
            console.log(`Loaded default start cookie: ${Object.keys(cookieJar).join(', ')}`);
        }
    }

    // Resume support
    if (hasResume) {
        try {
            const resume = JSON.parse(fs.readFileSync(RESUME_FILE, "utf-8"));
            page = resume.page;
            users = resume.users || [];
            totalPages = resume.totalPages || null;
            totalCount = resume.totalCount || null;
            restoreCookies(resume.cookies);
            for (const u of users) seen.add(u.id);
            console.log(`Resuming from page ${page} (already have ${users.length} users); cookies: ${Object.keys(cookieJar).join(', ') || 'none'}`);
        } catch (e) {
            console.warn("Could not parse resume file, starting fresh.");
        }
    }

    while (true) {
        console.log(`Fetching page ${page}...`);
        let data;
        try {
            data = await fetchPage(page);
        } catch (err) {
            console.error("Fatal error fetching page:", err.message);
            console.log("Progress saved. You can re-run to resume.");
            break;
        }
        if (!totalPages) {
            totalPages = data.pagination?.pages || null;
            totalCount = data.pagination?.count || null;
            console.log(`Discovered total pages=${totalPages}, total users=${totalCount}`);
        }
        const batch = data.users || [];
        if (batch.length === 0) {
            console.log("No users in response, stopping.");
            break;
        }
        let added = 0;
        for (const u of batch) {
            if (!seen.has(u.id)) {
                users.push(u);
                seen.add(u.id);
                added++;
            }
        }
        console.log(`Page ${page}: received ${batch.length}, added ${added}, total stored ${users.length}`);
        fs.writeFileSync(RESUME_FILE, JSON.stringify({ page: page + 1, users, totalPages, totalCount, cookies: serializeCookies() }, null, 2));
        if (totalPages && page >= totalPages) {
            console.log("Reached last page.");
            break;
        }
        page += 1;
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ scraped_at: new Date().toISOString(), total: users.length, expected_total: totalCount, users, cookies: serializeCookies() }, null, 2));
    if (fs.existsSync(RESUME_FILE)) fs.unlinkSync(RESUME_FILE);
    console.log(`Done. Saved ${users.length} users to ${path.basename(OUTPUT_FILE)}.`);
}

main();
