const fs = require("fs");
const path = require("path");

const seedPath = path.join(__dirname, "..", "data", "seed.json");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const runtimePath = path.join(dataDir, "runtime.json");

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(runtimePath)) {
    fs.copyFileSync(seedPath, runtimePath);
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(runtimePath, "utf8"));
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(runtimePath, JSON.stringify(data, null, 2));
}

function nextId(prefix, items) {
  return `${prefix}-${String(items.length + 1).padStart(3, "0")}`;
}

module.exports = {
  nextId,
  readStore,
  writeStore
};
