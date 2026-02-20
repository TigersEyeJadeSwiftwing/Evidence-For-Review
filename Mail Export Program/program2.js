#!/usr/bin/env node
// program.js - Batch files into independent .7z and self-extracting .exe archives,
// each archive's *uncompressed* size <= MAX_CHUNK_BYTES.
// Runs 7z in the foreground and prints its normal output to the same console.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// Default chunk size (200 KB)
let MAX_CHUNK_BYTES = 200 * 1024;

const PATH_7Z = 'C:\\Program Files\\7-Zip\\7z.exe';
const SFX_MODULE = 'C:\\Program Files\\7-Zip\\7zCon.sfx';

// -----------------------------
// Parse chunk size argument
// -----------------------------
function parseChunkSizeArg(arg) {
  // Accept "-chunksize=250KB" or "-cs=250KB"
  const m = arg.match(/^-(?:chunksize|cs)=(.+)$/i);
  if (!m) return null;

  const raw = m[1].trim();
  const numMatch = raw.match(/^(\d+)([a-zA-Z]*)$/);

  if (!numMatch) {
    throw new Error(`Invalid chunk size format: ${raw}`);
  }

  const value = parseInt(numMatch[1], 10);
  const unit = numMatch[2].toLowerCase();

  if (isNaN(value)) {
    throw new Error(`Invalid numeric chunk size: ${raw}`);
  }

  switch (unit) {
    case "":
      return value; // bytes
    case "kb":
      return value * 1024;
    case "mb":
      return value * 1024 * 1024;
    default:
      throw new Error(`Unknown size unit in: ${raw}`);
  }
}

// -----------------------------
// Utility functions
// -----------------------------
function writeFileList(filePaths) {
  const tmpName = path.join(
    os.tmpdir(),
    `7z_filelist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`
  );
  const content = filePaths.map(p => path.resolve(p)).join('\r\n');
  fs.writeFileSync(tmpName, content, { encoding: 'utf8' });
  return tmpName;
}

function run7z(args) {
  const res = spawnSync(PATH_7Z, args, { stdio: 'inherit' });
  return res;
}

function zeroPad(n, w) {
  return String(n).padStart(w, '0');
}

// -----------------------------
// Create final archives
// -----------------------------
function createFinalArchives(batchFiles, indexNum) {
  const nameNum = zeroPad(indexNum, 4);
  const out7z = path.join(z7Folder, `messages_${nameNum}.7z`);
  const outExe = path.join(exeFolder, `messages_self_extracting_${nameNum}.exe`);

  const listPath = writeFileList(batchFiles);
  // console.log("LISTPATH: " + listPath);

  try {
    // Create .7z
    let res = run7z(['a', '-t7z', out7z, '-ssw', '-mx=5', '-mmt=16', '-y', `@${listPath}`]);
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to create ${out7z} (status ${res.status}).`);
    }

    // Create SFX
    if (!fs.existsSync(SFX_MODULE)) {
      throw new Error(`SFX module not found: ${SFX_MODULE}`);
    }

    res = run7z(['a', '-t7z', outExe, `@${listPath}`, '-ssw', '-mx=5', '-mmt=16', `-sfx${SFX_MODULE}`, '-y']);
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to create SFX ${outExe} (status ${res.status}).`);
    }

    console.log(`Finished batch ${nameNum}: ${path.basename(out7z)}, ${path.basename(outExe)}.`);
  } finally {
    try { if (fs.existsSync(listPath)) fs.unlinkSync(listPath); } catch (e) {}
  }
}

// -----------------------------
// File listing (non-recursive)
// -----------------------------
function* listFiles(folder) {
  const dir = fs.opendirSync(folder);
  try {
    let d;
    while ((d = dir.readSync()) !== null) {
      if (!d.isFile()) continue;
      const full = path.join(folder, d.name);
      const rel = path.relative(folder, full);
      if (rel.startsWith('exe' + path.sep) || rel.startsWith('7z' + path.sep)) continue;
      yield full;
    }
  } finally {
    dir.closeSync();
  }
}

// -----------------------------
// Argument parsing
// -----------------------------
if (process.argv.length < 3) {
  console.error('Usage: node program.js [-chunksize=VALUE | -cs=VALUE] "path\\to\\sourceFolder"');
  process.exit(2);
}

let srcFolder = null;

// Process arguments after "program.js"
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];

  if (arg.startsWith('-')) {
    const parsed = parseChunkSizeArg(arg);
    if (parsed !== null) {
      MAX_CHUNK_BYTES = parsed;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  } else {
    srcFolder = path.resolve(arg);
    break;
  }
}

if (!srcFolder) {
  console.error('Source folder not specified.');
  process.exit(2);
}

if (!fs.existsSync(srcFolder) || !fs.statSync(srcFolder).isDirectory()) {
  console.error(`Source folder not found or not a directory: ${srcFolder}`);
  process.exit(2);
}

const exeFolder = path.join(srcFolder, 'exe');
const z7Folder = path.join(srcFolder, '7z');

for (const d of [exeFolder, z7Folder]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  else if (!fs.statSync(d).isDirectory()) {
    console.error('Path exists and is not a directory:', d);
    process.exit(3);
  }
}

// -----------------------------
// Main batching logic
// -----------------------------
(function main() {
  console.log(
    `Source: ${srcFolder}\n` +
    `Output (7z): ${z7Folder}\n` +
    `Output (exe): ${exeFolder}\n` +
    `7z path: ${PATH_7Z}\n` +
    `SFX module: ${SFX_MODULE}\n` +
    `Max chunk bytes (uncompressed): ${MAX_CHUNK_BYTES}\n`
  );

  let batch = [];
  let batchSize = 0;
  let batchIndex = 1;

  for (const filePath of listFiles(srcFolder)) {
    const fileSize = fs.statSync(filePath).size;

    // If adding this file exceeds the chunk size, finalize current batch
    if (batch.length > 0 && batchSize + fileSize > MAX_CHUNK_BYTES) {
      createFinalArchives(batch, batchIndex++);
      batch = [];
      batchSize = 0;
    }

    // Add file to batch
    batch.push(filePath);
    batchSize += fileSize;

    // If a single file exceeds the limit, warn but still allow it
    if (batch.length === 1 && fileSize > MAX_CHUNK_BYTES) {
      console.warn(`Warning: single file ${path.basename(filePath)} is ${fileSize} bytes > limit.`);
    }
  }

  // Final batch
  if (batch.length) {
    createFinalArchives(batch, batchIndex);
  }

  console.log('\nAll done.');
})();
