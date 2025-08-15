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

(async () => {
  for (const s of scripts) existsOrDie(s.file);

  const startedAt = new Date();
  console.log(`[runner] SoM scraper runner starting at ${startedAt.toISOString()}`);

  for (const s of scripts) {
    try {
      await runNodeScript(s.file, args);
    } catch (err) {
      console.error(`[runner] Error running ${s.name}: ${err.message}`);
      console.error('[runner] Stopping further execution.');
      process.exitCode = 1;
      return;
    }
  }

  const finishedAt = new Date();
  const mins = ((finishedAt - startedAt) / 60000).toFixed(2);
  console.log(`\n[runner] All scrapers completed successfully in ${mins} minutes.`);
})();

