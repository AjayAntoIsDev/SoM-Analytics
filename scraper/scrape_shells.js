const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const OUTPUT_FILE = path.resolve(__dirname, "../data/raw", "shells.json");

const BASE_URL = "https://explorpheus.hackclub.com/leaderboard";

const MAX_RETRIES = 5;
const BASE_WAIT_MS = 2000;

async function fetchOnce(retry = 0) {
  try {
    const headers = {
      "User-Agent": "SoM-Analytics/1.0 (Pls dont ban)",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      Pragma: "no-cache",
      "Cache-Control": "no-cache"
    };
    const res = await fetch(BASE_URL, { method: "GET", headers });

    if (res.status === 429) {
      if (retry >= MAX_RETRIES) throw new Error("429 rate limit: max retries reached");
      const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10) * 1000;
      const wait = retryAfter || Math.min(60000, BASE_WAIT_MS * Math.pow(2, retry));
      console.warn(`Rate limited (429). Waiting ${wait/1000}s then retrying (attempt ${retry+1})`);
      await new Promise(r => setTimeout(r, wait));
      return fetchOnce(retry + 1);
    }
    if (!res.ok) {
      if (retry >= MAX_RETRIES) throw new Error(`HTTP ${res.status}: max retries reached`);
      const wait = Math.min(60000, BASE_WAIT_MS * Math.pow(2, retry));
      console.warn(`HTTP ${res.status}. Waiting ${wait/1000}s then retrying (attempt ${retry+1})`);
      await new Promise(r => setTimeout(r, wait));
      return fetchOnce(retry + 1);
    }

    return res.json();
  } catch (e) {
    if (retry >= MAX_RETRIES) throw e;
    const wait = Math.min(60000, BASE_WAIT_MS * Math.pow(2, retry));
    console.warn(`Network error: ${e.message}. Waiting ${wait/1000}s then retrying (attempt ${retry+1})`);
    await new Promise(r => setTimeout(r, wait));
    return fetchOnce(retry + 1);
  }
}

async function main() {
  console.log(`Fetching leaderboard...`);
  let data;
  try {
    data = await fetchOnce(0);
  } catch (err) {
    console.error('Fatal error fetching leaderboard:', err.message);
    process.exit(1);
  }

  const entries = Array.isArray(data) ? data : (data.items || []);
  console.log(`Received ${entries.length} leaderboard entries.`);

  const payload = {
    scraped_at: new Date().toISOString(),
    total: entries.length,
    entries
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Done. Saved ${entries.length} entries to ${path.basename(OUTPUT_FILE)}.`);
}

main();
