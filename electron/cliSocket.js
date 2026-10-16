// Where the `char` command reaches the running app. Shared by the app (electron/main.js) and the
// command (electron/cli.js), so both always agree on the path.

const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

/** The notes folder: CHAR_DATA_DIR if set (tests, a second copy), else char's usual one. */
function dataDir() {
  return process.env.CHAR_DATA_DIR ? path.resolve(process.env.CHAR_DATA_DIR) : path.join(os.homedir(), "Library", "Application Support", "char");
}

// Unix socket paths are capped at about 104 bytes, so a long data folder gets a short stand-in.
function socketPath(dir = dataDir()) {
  const inside = path.join(dir, "cli.sock");
  if (Buffer.byteLength(inside) < 100) return inside;
  const hash = crypto.createHash("sha1").update(dir).digest("hex").slice(0, 10);
  return path.join(os.homedir(), "Library", "Caches", "char-cli", `${hash}.sock`);
}

module.exports = { dataDir, socketPath };
