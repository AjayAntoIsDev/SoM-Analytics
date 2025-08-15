#!/usr/bin/env node

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);

const scripts = [
  { name: 'users', file: path.resolve(__dirname, 'scraper', 'scrape_users.js') },
  { name: 'projects', file: path.resolve(__dirname, 'scraper', 'scrape_projects.js') },
  { name: 'comments', file: path.resolve(__dirname, 'scraper', 'scrape_comments.js') },
  { name: 'shells', file: path.resolve(__dirname, 'scraper', 'scrape_shells.js') },
];

function existsOrDie(file) {
  if (!fs.existsSync(file)) {
    console.error(`[runner] Missing script: ${file}`);
    process.exit(1);
  }
}

function runNodeScript(filePath, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const cmd = 'node';
    const cmdArgs = [filePath, ...extraArgs];
    console.log(`\n[runner] Starting: ${path.basename(filePath)} ${extraArgs.join(' ')}\n`);

    const child = spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('error', (err) => {
      console.error(`[runner] Failed to start ${filePath}:`, err.message);
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[runner] Finished: ${path.basename(filePath)} (exit ${code})`);
        resolve();
      } else {
        reject(new Error(`${path.basename(filePath)} exited with code ${code}`));
      }
    });
  });
}

function formatDuration(ms) {
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000);
  const msRem = Math.floor(ms % 1000);
  const pad = (n, w=2) => n.toString().padStart(w, '0');
  const base = `${h ? h + ':' : ''}${h ? pad(m) : m}:${pad(s)}.${pad(msRem,3)}`;
  return sign + base;
}

(async () => {
  for (const s of scripts) existsOrDie(s.file);

  const startedAt = new Date();
  console.log(`[runner] SoM scraper runner starting at ${startedAt.toISOString()}`);

  const timings = [];

  for (const s of scripts) {
    const t0 = Date.now();
    let success = true;
    try {
      await runNodeScript(s.file, args);
    } catch (err) {
      success = false;
      console.error(`[runner] Error running ${s.name}: ${err.message}`);
    } finally {
      const dt = Date.now() - t0;
      timings.push({ name: s.name, ms: dt, success });
      console.log(`[runner] Timing: ${s.name} took ${formatDuration(dt)}`);
    }
    if (!success) {
      const totalSoFar = timings.reduce((acc, t) => acc + t.ms, 0);
      console.log(`\n[runner] Summary so far:`);
      for (const t of timings) {
        console.log(` - ${t.name}: ${formatDuration(t.ms)} ${t.success ? '' : '(failed)'}`);
      }
      console.log(`[runner] Total elapsed: ${formatDuration(totalSoFar)}`);
      process.exitCode = 1;
      return;
    }
  }

  const finishedAt = new Date();
  const totalMs = finishedAt - startedAt;

  console.log(`\n[runner] Per-script timings:`);
  for (const t of timings) {
    console.log(` - ${t.name}: ${formatDuration(t.ms)}`);
  }
  console.log(`[runner] Total elapsed: ${formatDuration(totalMs)}`);
})();

