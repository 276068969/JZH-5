const fs = require("fs");
const path = require("path");

const seedPath = path.join(__dirname, "..", "data", "seed.json");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const runtimePath = path.join(dataDir, "runtime.json");
const CURRENT_SCHEMA_VERSION = 3;

const STATION_DEFAULTS = {
  lastReportedAt: null,
  abnormalReason: null,
  location: "—",
  installedAt: null,
  equipment: []
};

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(runtimePath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    seed._schemaVersion = CURRENT_SCHEMA_VERSION;
    fs.writeFileSync(runtimePath, JSON.stringify(seed, null, 2));
    return;
  }

  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  const migrated = migrate(runtime);
  if (migrated) {
    fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2));
  }
}

function migrate(data) {
  let changed = false;
  const version = data._schemaVersion || 1;

  if (version < 2) {
    changed = migrateToV2(data) || changed;
    data._schemaVersion = 2;
    changed = true;
  }

  if (version < 3) {
    changed = migrateToV3(data) || changed;
    data._schemaVersion = 3;
    changed = true;
  }

  return changed;
}

function migrateToV3(data) {
  let changed = false;
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  if (!Array.isArray(data.speciesList)) {
    data.speciesList = seed.speciesList || [];
    changed = true;
  }

  return changed;
}

function migrateToV2(data) {
  let changed = false;
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const seedStationMap = new Map((seed.stations || []).map((s) => [s.id, s]));

  if (!Array.isArray(data.stations)) {
    data.stations = seed.stations || [];
    return true;
  }

  for (const station of data.stations) {
    const seedStation = seedStationMap.get(station.id);

    for (const [key, defaultValue] of Object.entries(STATION_DEFAULTS)) {
      if (!(key in station)) {
        if (seedStation && seedStation[key] !== undefined) {
          station[key] = seedStation[key];
        } else {
          station[key] = defaultValue;
        }
        changed = true;
      }
    }

    if (station.status === undefined) {
      station.status = "online";
      changed = true;
    }

    if (station.temperature === undefined) {
      station.temperature = seedStation ? seedStation.temperature : null;
      changed = true;
    }

    if (station.humidity === undefined) {
      station.humidity = seedStation ? seedStation.humidity : null;
      changed = true;
    }

    if (station.battery === undefined) {
      station.battery = seedStation ? seedStation.battery : null;
      changed = true;
    }
  }

  const seedIds = new Set((seed.stations || []).map((s) => s.id));
  const existingIds = new Set(data.stations.map((s) => s.id));
  for (const seedStation of seed.stations || []) {
    if (!existingIds.has(seedStation.id)) {
      data.stations.push({ ...STATION_DEFAULTS, ...seedStation });
      changed = true;
    }
  }

  return changed;
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(runtimePath, "utf8"));
}

function writeStore(data) {
  ensureStore();
  if (!data._schemaVersion) {
    data._schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  fs.writeFileSync(runtimePath, JSON.stringify(data, null, 2));
}

function nextId(prefix, items) {
  return `${prefix}-${String(items.length + 1).padStart(3, "0")}`;
}

module.exports = {
  nextId,
  readStore,
  writeStore,
  CURRENT_SCHEMA_VERSION
};
