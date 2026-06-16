const http = require("http");
const fs = require("fs");
const path = require("path");
const { nextId, readStore, writeStore } = require("./store");

const PORT = Number(process.env.PORT || 3000);
const frontendDir = path.resolve(__dirname, "..", "..", "frontend");
const demoUsers = [
  { username: "admin", password: "Admin@2026", role: "admin", name: "监管中心管理员" },
  { username: "ranger", password: "Ranger@2026", role: "ranger", name: "保护站巡护员" },
  { username: "viewer", password: "Viewer@2026", role: "viewer", name: "联合观测访客" }
];

if (process.argv.includes("--healthcheck")) {
  readStore();
  console.log("healthcheck ok");
  process.exit(0);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function makeToken(user) {
  return Buffer.from(JSON.stringify({
    username: user.username,
    role: user.role,
    name: user.name,
    issuedAt: Date.now()
  })).toString("base64url");
}

function currentUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    return demoUsers.find((user) => user.username === parsed.username && user.role === parsed.role) || null;
  } catch {
    return null;
  }
}

function requireUser(req, res, roles = []) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { message: "请先登录后再访问。" });
    return null;
  }
  if (roles.length && !roles.includes(user.role)) {
    sendJson(res, 403, { message: "当前账号没有该操作权限。" });
    return null;
  }
  return user;
}

function routeFile(urlPath) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  return path.join(frontendDir, safePath);
}

function serveStatic(req, res) {
  const filePath = routeFile(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!filePath.startsWith(frontendDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function withTrend(values) {
  const latest = values.at(-1);
  const previous = values.at(-2) || latest;
  return { latest, delta: latest - previous, values };
}

function aggregateObservations(observations, key) {
  const groups = new Map();
  for (const obs of observations) {
    const groupKey = obs[key];
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        name: groupKey,
        totalCount: 0,
        recordCount: 0,
        lastReportedAt: null
      });
    }
    const group = groups.get(groupKey);
    group.totalCount += Number(obs.count) || 0;
    group.recordCount += 1;
    if (!group.lastReportedAt || obs.recordedAt > group.lastReportedAt) {
      group.lastReportedAt = obs.recordedAt;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.totalCount - a.totalCount);
}

function getObservationStatistics(observations) {
  return {
    bySpecies: aggregateObservations(observations, "species"),
    byRoute: aggregateObservations(observations, "route"),
    byLocation: aggregateObservations(observations, "location")
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const data = readStore();

  try {
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readBody(req);
      const user = demoUsers.find((item) => item.username === body.username && item.password === body.password);
      if (!user) return sendJson(res, 401, { message: "账号或密码错误。" });
      return sendJson(res, 200, {
        token: makeToken(user),
        user: { username: user.username, role: user.role, name: user.name }
      });
    }

    if (req.method === "GET" && url.pathname === "/api/overview") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, {
        metrics: [
          { label: "今日过境候鸟", unit: "只", ...withTrend(data.dailyCounts) },
          { label: "在线监测站", unit: "座", latest: data.stations.filter((station) => station.status === "online").length, delta: 1 },
          { label: "活跃告警", unit: "条", latest: data.alerts.filter((alert) => alert.status !== "resolved").length, delta: -1 },
          { label: "保护区覆盖", unit: "%", latest: 92, delta: 3 }
        ],
        routes: data.routes,
        stations: data.stations,
        announcements: data.broadcasts.slice(-3).reverse()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/migrations") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { routes: data.routes });
    }

    if (req.method === "GET" && url.pathname === "/api/alerts") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { alerts: data.alerts });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/alerts/")) {
      const user = requireUser(req, res, ["admin", "ranger"]);
      if (!user) return;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readBody(req);
      const alert = data.alerts.find((item) => item.id === id);
      if (!alert) return sendJson(res, 404, { message: "告警不存在。" });

      const previousStatus = alert.status;
      const newStatus = body.status || alert.status;
      const remark = body.remark ? String(body.remark).slice(0, 500) : null;
      const now = new Date().toISOString();

      alert.status = newStatus;
      alert.handler = user.name;
      alert.updatedAt = now;
      if (remark) {
        alert.remark = remark;
      }

      if (!Array.isArray(alert.history)) {
        alert.history = [];
      }

      if (newStatus !== previousStatus || remark) {
        alert.history.push({
          status: newStatus,
          handler: user.name,
          remark: remark || `状态变更为 ${newStatus}`,
          timestamp: now
        });
      }

      writeStore(data);
      return sendJson(res, 200, { alert });
    }

    if (req.method === "GET" && url.pathname === "/api/observations/statistics") {
      const user = requireUser(req, res);
      if (!user) return;
      const statistics = getObservationStatistics(data.observations);
      return sendJson(res, 200, { statistics });
    }

    if (req.method === "GET" && url.pathname === "/api/observations") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { observations: data.observations.slice().reverse() });
    }

    if (req.method === "POST" && url.pathname === "/api/observations") {
      const user = requireUser(req, res, ["admin", "ranger"]);
      if (!user) return;
      const body = await readBody(req);
      const observation = {
        id: nextId("OBS", data.observations),
        species: String(body.species || "未识别鸟种").slice(0, 32),
        count: Number(body.count || 0),
        location: String(body.location || "未知位置").slice(0, 48),
        route: String(body.route || "东亚-澳大利西亚路线").slice(0, 48),
        observer: user.name,
        recordedAt: new Date().toISOString()
      };
      data.observations.push(observation);
      writeStore(data);
      return sendJson(res, 201, { observation });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/stations") {
      const user = requireUser(req, res, ["admin", "ranger"]);
      if (!user) return;
      return sendJson(res, 200, { stations: data.stations });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/broadcasts") {
      const user = requireUser(req, res, ["admin"]);
      if (!user) return;
      const body = await readBody(req);
      const broadcast = {
        id: nextId("BRC", data.broadcasts),
        title: String(body.title || "迁徙监管通知").slice(0, 48),
        content: String(body.content || "请各保护站加强巡护。").slice(0, 180),
        publisher: user.name,
        createdAt: new Date().toISOString()
      };
      data.broadcasts.push(broadcast);
      writeStore(data);
      return sendJson(res, 201, { broadcast });
    }

    return sendJson(res, 404, { message: "接口不存在。" });
  } catch (error) {
    return sendJson(res, 400, { message: error.message || "请求处理失败。" });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Migratory bird supervision platform running at http://localhost:${PORT}`);
});
