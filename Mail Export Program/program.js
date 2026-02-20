#!/usr/bin/env node
// program.js - Batch files into independent .7z and self-extracting .exe archives,
// each archive's compressed size <= MAX_COMPRESSED_BYTES.
// Runs 7z in the foreground and prints its normal output to the same console.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const os = require('os');
const crypto = require('crypto');

const MAX_COMPRESSED_BYTES = 200 * 1024; // KB, default
const PATH_7Z = 'C:\\Program Files\\7-Zip\\7z.exe'; // adjust if needed
const SFX_MODULE = 'C:\\Program Files\\7-Zip\\7zCon.sfx'; // required for SFX creation

function writeFileList(filePaths) {
  // console.log("Function writeFileList: " + filePaths);
  const tmpName = path.join(os.tmpdir(), `7z_filelist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`);
  // const tmpName = `7z_filelist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`;
  // console.log(tmpName);
  const content = filePaths.map(p => path.resolve(p)).join('\r\n');
  fs.writeFileSync(tmpName, content, { encoding: 'utf8' });
  // console.log("Wrote " + tmpName);
  return tmpName;
}

// Run 7z synchronously with stdio inherited (visible). args is array.
function run7z(args) {
  const cmd = PATH_7Z;
  // console.log(cmd + ' ' + args.join(' '));
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  return res;
}

// Create final archives using a list file for the .7z creation and for SFX add (SFX add can take the .7z filename only).
function createFinalArchives(batchFiles, indexNum) {
  const nameNum = zeroPad(indexNum, 4);
  const out7z = path.join(z7Folder, `messages_${nameNum}.7z`);
  const outExe = path.join(exeFolder, `messages_self_extracting_${nameNum}.exe`);

  // console.log(`\nCreating ${out7z} with ${batchFiles.length} files...`);
  const listPath = writeFileList(batchFiles);
  console.log("LISTPATH: " + listPath);
  try {
    // Create final .7z using @list to avoid long command line
    let res = run7z(['a', '-t7z', out7z, '-ssw', '-mx=5', '-mmt=16', '-y', `@${listPath}`]);
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to create ${out7z} (status ${res.status}).`);
    }

    // console.log(`\nCreating SFX ${outExe} from ${out7z}...`);
    if (!fs.existsSync(SFX_MODULE)) {
      throw new Error(`SFX module not found: ${SFX_MODULE}`);
    }
    // For SFX creation we add the .7z into the exe; this is a short argument list.
    res = run7z(['a', '-t7z', outExe, `@${listPath}`, '-ssw', '-mx=5', '-mmt=16', `-sfx${SFX_MODULE}`, '-y']);
    // res = run7z(['a', outExe, out7z, `-sfx${SFX_MODULE}`, '-y']);
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to create SFX ${outExe} (status ${res.status}).`);
    }

    console.log(`Finished batch ${nameNum}: ${path.basename(out7z)}, ${path.basename(outExe)}.`);
  } finally {
    try { if (fs.existsSync(listPath)) fs.unlinkSync(listPath); } catch (e) {}
  }
}

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node program.js "path\\to\\sourceFolder"');
  process.exit(2);
}

function zeroPad(n, w) { return String(n).padStart(w, '0'); }

// Measure compressed size of fileList using a temporary list file and temporary archive.
// Returns size in bytes or throws on error.
function measureCompressedSize(fileList) {
  const listPath = writeFileList(fileList);
  try {
    const tmpArchive = path.join(os.tmpdir(), `.tmp_size_check_${Date.now()}_${Math.random().toString(36).slice(2)}.7z`);
    // Use @list.txt syntax: -i@listfile not needed for 'a' command; 7z accepts @listfile directly as input file(s)
    // We pass the @list file as the file to add.
    const args = ['a', '-t7z', tmpArchive, '-ssw', '-mx=5', '-mmt=16', '-y', `@${listPath}`];
    const res = run7z(args);
    if (res.error || res.status !== 0) {
      try { if (fs.existsSync(tmpArchive)) fs.unlinkSync(tmpArchive); } catch (e) {}
      throw new Error(`7z test-archive creation failed (status ${res.status}).`);
    }
    const size = fs.statSync(tmpArchive).size;
    fs.unlinkSync(tmpArchive);
    return size;
  } finally {
    try { if (fs.existsSync(listPath)) fs.unlinkSync(listPath); } catch (e) {}
  }
}

// Generator: yield file paths (non-recursive) in srcFolder excluding our output directories.
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

if (process.argv.length < 3) usageAndExit();

const srcFolder = path.resolve(process.argv[2]);
if (!fs.existsSync(srcFolder) || !fs.statSync(srcFolder).isDirectory()) {
  usageAndExit(`Source folder not found or not a directory: ${srcFolder}`);
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

// Main
(function main() {
  console.log(`Source: ${srcFolder}\n` + `Output (7z): ${z7Folder}\n` + `Output (exe): ${exeFolder}\n` + `7z path: ${PATH_7Z}\n` + `SFX module: ${SFX_MODULE}\n` + `Max compressed bytes: ${MAX_COMPRESSED_BYTES}\n`);
  /*
  console.log(`Output (7z): ${z7Folder}`);
  console.log(`Output (exe): ${exeFolder}`);
  console.log(`7z path: ${PATH_7Z}`);
  console.log(`SFX module: ${SFX_MODULE}`);
  console.log(`Max compressed bytes: ${MAX_COMPRESSED_BYTES}`);
  */

  let batch = [];
  let batchIndex = 1;

  for (const filePath of listFiles(srcFolder)) {
    // Candidate: test batch + file
    const candidateList = batch.length ? [...batch, filePath] : [filePath];

    try {
      const compSize = measureCompressedSize(candidateList);
      // console.log("compSize: " + compSize);
      // console.log(`Test compressed size for ${candidateList.length} files -> ${compSize} bytes`);
      if (compSize > MAX_COMPRESSED_BYTES && batch.length > 0) {
        // finalize current batch (without this file)
        createFinalArchives(batch, batchIndex);
        batchIndex++;
        batch = [filePath]; // start new batch with candidate
      } else {
        // accept candidate
        batch.push(filePath);
        // If single file alone exceeds limit, we still accept it (it will be its own archive).
        if (batch.length === 1) {
          // Re-measure: if single file > MAX, warn and still proceed when finalizing.
          try {
            const singleSize = measureCompressedSize(batch);
            if (singleSize > MAX_COMPRESSED_BYTES) {
              console.warn("Warning: single file ${path.basename(filePath)} compresses to ${singleSize} bytes > limit. It will be written alone.");
            }
          } catch (e) {
            console.warn('Warning: failed re-measure single file:', e.message);
          }
        }
      }
    } catch (err) {
      console.error('Error during test/compression step:', err.message);
      process.exit(10);
    }
  }

  // finalize remaining batch
  if (batch.length) {
    try {
      createFinalArchives(batch, batchIndex);
    } catch (err) {
      console.error('Error creating final archives:', err.message);
      process.exit(11);
    }
  }

  console.log('\nAll done.');
})();
