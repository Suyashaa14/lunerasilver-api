#!/usr/bin/env node
/**
 * Takes a compressed dump of the database and checks it is readable.
 *
 * A backup nobody has verified is not a backup, so this reads the file back
 * and refuses to report success unless the dump actually contains the tables
 * and rows it should.
 *
 * Run it: npm run backup
 * Restore it: see docs/BACKUP.md
 */
const { spawn } = require("node:child_process");
const { createGunzip } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

require("dotenv").config();

const DIR = process.env.BACKUP_DIR || path.join(__dirname, "..", "backups");
const KEEP = Number(process.env.BACKUP_KEEP || 30);

// Tables that must be present, or the dump is not a usable backup of this system.
const REQUIRED = ["invoices", "invoice_items", "journal_entries", "journal_entry_lines", "payments", "jewelries", "users"];

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const BASE_ARGS = () => [
  `--host=${process.env.MYSQL_HOST || "127.0.0.1"}`,
  `--port=${process.env.MYSQL_PORT || 3306}`,
  `--user=${process.env.MYSQL_USER}`,
  `--password=${process.env.MYSQL_PASSWORD}`,
  "--skip-lock-tables",
  "--no-tablespaces",
  "--set-gtid-purged=OFF",
  // This MySQL build dumps masking policies by default, which reads a system
  // table the application user cannot see. Nothing here uses them.
  "--skip-masking-policies",
  "--routines",
  "--triggers",
  "--default-character-set=utf8mb4",
];

const NOISE = ["Using a password", "A partial dump from a server that has GTIDs", "GTIDs enabled will by default"];

const dumpTo = (file, consistent) =>
  new Promise((resolve, reject) => {
    const args = BASE_ARGS();
    // A consistent snapshot: everything as it stood at one instant, so an
    // invoice can never be captured without the journal entry that went with it.
    if (consistent) args.splice(4, 0, "--single-transaction");
    args.push(process.env.MYSQL_DATABASE);

    const dump = spawn("mysqldump", args);
    const out = fs.createWriteStream(file);
    let stderr = "";

    dump.stderr.on("data", (d) => (stderr += d.toString()));
    dump.stdout.pipe(require("node:zlib").createGzip()).pipe(out);

    dump.on("error", reject);
    out.on("error", reject);
    out.on("close", () => {
      const real = stderr.split("\n").filter((l) => l.trim() && !NOISE.some((n) => l.includes(n))).join("\n");
      if (real) return reject(new Error(real));
      resolve();
    });
  });

const run = async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `lunerasilver-${stamp()}.sql.gz`);

  try {
    await dumpTo(file, true);
    return { file, consistent: true };
  } catch (err) {
    // A half-written file must never be left lying next to real backups, where
    // it would look like one until the day somebody needed it.
    fs.rmSync(file, { force: true });

    // --single-transaction needs RELOAD or FLUSH_TABLES, which the application's
    // low-privilege user does not have. Falling back rather than failing, but
    // never silently: an inconsistent dump is a worse backup and you must know.
    if (!/RELOAD|FLUSH_TABLES/.test(err.message)) throw err;

    try {
      await dumpTo(file, false);
    } catch (fallbackError) {
      fs.rmSync(file, { force: true });
      throw fallbackError;
    }
    return { file, consistent: false };
  }
};

const verify = async (file) => {
  const found = new Set();
  let inserts = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(createGunzip()) });
  for await (const line of rl) {
    const create = line.match(/^CREATE TABLE `([^`]+)`/);
    if (create) found.add(create[1]);
    if (line.startsWith("INSERT INTO")) inserts += 1;
  }

  const missing = REQUIRED.filter((t) => !found.has(t));
  if (missing.length > 0) throw new Error(`Dump is missing tables: ${missing.join(", ")}`);
  if (inserts === 0) throw new Error("Dump contains no rows at all — refusing to call this a backup");

  return { tables: found.size, inserts };
};

const prune = () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql.gz")).sort().reverse();
  const old = files.slice(KEEP);
  for (const f of old) fs.unlinkSync(path.join(DIR, f));
  return old.length;
};

(async () => {
  try {
    const { file, consistent } = await run();

    let tables, inserts;
    try {
      ({ tables, inserts } = await verify(file));
    } catch (err) {
      fs.rmSync(file, { force: true });
      throw err;
    }
    const size = (fs.statSync(file).size / 1024).toFixed(1);
    const pruned = prune();

    console.log(`Backup written: ${path.basename(file)} (${size} KB)`);
    console.log(`Verified: ${tables} tables, ${inserts} insert statements`);
    if (pruned > 0) console.log(`Removed ${pruned} backup(s) older than the last ${KEEP}`);

    if (!consistent) {
      console.warn("");
      console.warn("  WARNING: this is not a point-in-time snapshot.");
      console.warn(`  The database user "${process.env.MYSQL_USER}" lacks the privilege for one,`);
      console.warn("  so a sale recorded while the dump ran could be captured half-written.");
      console.warn("  Fix it once, as root:");
      console.warn(`    GRANT RELOAD ON *.* TO '${process.env.MYSQL_USER}'@'localhost'; FLUSH PRIVILEGES;`);
      console.warn("");
    }
  } catch (err) {
    console.error("BACKUP FAILED:", err.message);
    process.exit(1);
  }
})();
