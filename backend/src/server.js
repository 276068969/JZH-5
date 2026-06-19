const http = require("http");
const fs = require("fs");
const path = require("path");
const { nextId, readStore, writeStore } = require("./store");

const PORT = Number(process.env.PORT || 3000);
const frontendDir = path.resolve(__dirname, "..", "..", "frontend");
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
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
  const issuedAt = Date.now();
  const expiresAt = issuedAt + TOKEN_TTL_MS;
  return Buffer.from(JSON.stringify({
    username: user.username,
    role: user.role,
    name: user.name,
    issuedAt,
    expiresAt
  })).toString("base64url");
}

function parseToken(token) {
  if (!token) return { valid: false, expired: false, user: null };
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const user = demoUsers.find((u) => u.username === parsed.username && u.role === parsed.role) || null;
    if (!user) return { valid: false, expired: false, user: null };
    if (!parsed.expiresAt) {
      return { valid: false, expired: true, user: null };
    }
    const now = Date.now();
    if (now > parsed.expiresAt) {
      return { valid: false, expired: true, user: null };
    }
    return { valid: true, expired: false, user };
  } catch {
    return { valid: false, expired: false, user: null };
  }
}

function currentUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const result = parseToken(token);
  return result.user;
}

function currentUserWithStatus(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return parseToken(token);
}

function requireUser(req, res, roles = []) {
  const status = currentUserWithStatus(req);
  if (status.expired) {
    sendJson(res, 401, { message: "登录凭证已过期，请重新登录。", code: "TOKEN_EXPIRED" });
    return null;
  }
  if (!status.user) {
    sendJson(res, 401, { message: "请先登录后再访问。", code: "TOKEN_INVALID" });
    return null;
  }
  if (roles.length && !roles.includes(status.user.role)) {
    sendJson(res, 403, { message: "当前账号没有该操作权限。" });
    return null;
  }
  return status.user;
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

function getMigrationStage(progress, season) {
  if (progress < 20) {
    return {
      code: "preparing",
      label: "集结待命",
      description: `${season}前期，候鸟正在越冬地/繁殖地集结，能量储备阶段。`
    };
  } else if (progress < 40) {
    return {
      code: "departing",
      label: "出发初期",
      description: `${season}已启动，候鸟群体开始分批启航，稳步推进中。`
    };
  } else if (progress < 60) {
    return {
      code: "midway",
      label: "中途补给",
      description: `${season}关键阶段，候鸟正处于中途补给期，依赖停歇地湿地资源。`
    };
  } else if (progress < 80) {
    return {
      code: "accelerating",
      label: "加速推进",
      description: `${season}进入后半程，候鸟体力充沛，加速向目的地推进。`
    };
  } else {
    return {
      code: "finishing",
      label: "即将抵达",
      description: `${season}接近尾声，先锋群体已抵达目的地，后续梯队跟进中。`
    };
  }
}

function getRiskWarning(risk, season, currentArea) {
  const warnings = {
    low: {
      level: "低",
      levelText: "整体平稳",
      summary: "路线状况良好，栖息地环境稳定，按常规巡护计划执行即可。",
      suggestions: [
        "保持每日常规监测频次",
        "重点关注停歇地水位变化",
        "做好观测记录和数据上报"
      ]
    },
    medium: {
      level: "中",
      levelText: "需加强关注",
      summary: `当前${season}存在中度风险，${currentArea}周边需警惕人为干扰和栖息地变化。`,
      suggestions: [
        "增加巡护频次至每日两次",
        "重点监测湿地生态指标",
        "排查周边潜在人为活动干扰",
        "准备应急处置预案"
      ]
    },
    high: {
      level: "高",
      levelText: "高风险预警",
      summary: `当前${season}面临高风险，${currentArea}区域需立即启动应急监测响应。`,
      suggestions: [
        "启动全天候应急监测机制",
        "增派现场巡护人员值守",
        "协调相关部门开展联合执法",
        "每日上报风险评估情况",
        "做好候鸟种群异常情况预案"
      ]
    }
  };
  return warnings[risk] || warnings.low;
}

function analyzeRouteProgress(route) {
  const progress = Number(route.progress) || 0;
  const risk = route.risk || "low";
  const season = route.season || "迁徙期";
  const currentArea = route.currentArea || "未知区域";

  const stage = getMigrationStage(progress, season);
  const warning = getRiskWarning(risk, season, currentArea);

  const estimatedDays = Math.round((100 - progress) / 5);

  const summaryText = `${route.name}当前处于${season}「${stage.label}」阶段，整体进度 ${progress}%，${warning.levelText}。预计还需约 ${estimatedDays} 天完成本阶段迁飞。`;

  return {
    routeId: route.id,
    routeName: route.name,
    season: season,
    currentArea: currentArea,
    species: route.species,
    progress: {
      value: progress,
      stage: stage.code,
      stageLabel: stage.label,
      stageDescription: stage.description,
      estimatedRemainingDays: estimatedDays,
      completionText: progress >= 100 ? "本阶段迁徙已完成" : `已完成 ${progress}%`
    },
    risk: {
      level: warning.level,
      levelText: warning.levelText,
      summary: warning.summary,
      suggestions: warning.suggestions
    },
    summary: summaryText,
    generatedAt: new Date().toISOString()
  };
}

function getStationHealthSummary(stations) {
  const total = stations.length;
  const online = stations.filter((s) => s.status === "online").length;
  const warning = stations.filter((s) => s.status === "warning").length;
  const offline = stations.filter((s) => s.status === "offline").length;
  const lowBattery = stations.filter((s) => s.battery !== null && s.battery < 40).length;
  const criticalBattery = stations.filter((s) => s.battery !== null && s.battery < 20).length;
  const stationsWithBattery = stations.filter((s) => s.battery !== null);
  const avgBattery = stationsWithBattery.length > 0
    ? stationsWithBattery.reduce((sum, s) => sum + s.battery, 0) / stationsWithBattery.length
    : 0;
  const abnormalStations = stations.filter((s) => s.status !== "online").map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    battery: s.battery,
    abnormalReason: s.abnormalReason,
    lastReportedAt: s.lastReportedAt
  }));
  const lowBatteryStations = stations
    .filter((s) => s.battery !== null && s.battery < 40)
    .sort((a, b) => a.battery - b.battery)
    .map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      battery: s.battery,
      lastReportedAt: s.lastReportedAt,
      location: s.location
    }));
  const batteryDistribution = {
    critical: stations.filter((s) => s.battery !== null && s.battery < 20).length,
    low: stations.filter((s) => s.battery !== null && s.battery >= 20 && s.battery < 40).length,
    medium: stations.filter((s) => s.battery !== null && s.battery >= 40 && s.battery < 70).length,
    good: stations.filter((s) => s.battery !== null && s.battery >= 70).length,
    unknown: stations.filter((s) => s.battery === null).length
  };

  return {
    total,
    online,
    warning,
    offline,
    lowBattery,
    criticalBattery,
    avgBattery: Math.round(avgBattery),
    abnormalStations,
    lowBatteryStations,
    batteryDistribution
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
      const token = makeToken(user);
      const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
      return sendJson(res, 200, {
        token,
        expiresAt: parsed.expiresAt,
        expiresIn: TOKEN_TTL_MS,
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

    if (req.method === "GET" && url.pathname === "/api/routes/progress") {
      const user = requireUser(req, res);
      if (!user) return;
      const analyses = data.routes.map(analyzeRouteProgress);
      const overall = {
        totalRoutes: data.routes.length,
        highRiskCount: analyses.filter((a) => a.risk.level === "高").length,
        mediumRiskCount: analyses.filter((a) => a.risk.level === "中").length,
        lowRiskCount: analyses.filter((a) => a.risk.level === "低").length,
        avgProgress: Math.round(analyses.reduce((sum, a) => sum + a.progress.value, 0) / analyses.length),
        generatedAt: new Date().toISOString()
      };
      return sendJson(res, 200, { overall, analyses });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/progress")) {
      const user = requireUser(req, res);
      if (!user) return;
      const id = decodeURIComponent(url.pathname.slice("/api/routes/".length, -"/progress".length));
      const route = data.routes.find((r) => r.id === id || r.name === id);
      if (!route) return sendJson(res, 404, { message: "路线不存在。" });
      return sendJson(res, 200, { analysis: analyzeRouteProgress(route) });
    }

    if (req.method === "GET" && url.pathname === "/api/alerts") {
      const user = requireUser(req, res);
      if (!user) return;
      const statusFilter = url.searchParams.get("status");
      const levelFilter = url.searchParams.get("level");
      const areaFilter = url.searchParams.get("area");
      let filteredAlerts = data.alerts.slice();
      if (statusFilter) {
        const statuses = statusFilter.split(",").map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          filteredAlerts = filteredAlerts.filter((alert) => statuses.includes(alert.status));
        }
      }
      if (levelFilter) {
        const levels = levelFilter.split(",").map((l) => l.trim()).filter(Boolean);
        if (levels.length > 0) {
          filteredAlerts = filteredAlerts.filter((alert) => levels.includes(alert.level));
        }
      }
      if (areaFilter) {
        const areas = areaFilter.split(",").map((a) => a.trim()).filter(Boolean);
        if (areas.length > 0) {
          filteredAlerts = filteredAlerts.filter((alert) => areas.includes(alert.area));
        }
      }
      filteredAlerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, { alerts: filteredAlerts });
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

      const errors = [];
      const species = String(body.species || "").trim();
      const countRaw = body.count;
      const count = Number(countRaw);
      const location = String(body.location || "").trim();
      const route = String(body.route || "").trim();
      const validRouteNames = data.routes.map((r) => r.name);
      const now = new Date();

      if (!species) {
        errors.push("鸟种名称不能为空，请输入观测到的鸟种名称。");
      } else if (species.length < 2) {
        errors.push("鸟种名称过短，至少需要 2 个字符，请补充完整。");
      } else if (species.length > 32) {
        errors.push(`鸟种名称过长，当前 ${species.length} 字符，最多允许 32 字符，请精简。`);
      }

      if (countRaw === undefined || countRaw === null || countRaw === "") {
        errors.push("观测数量不能为空，请输入观测到的鸟只数量。");
      } else if (!Number.isInteger(count) || count <= 0) {
        errors.push("观测数量必须为正整数，请输入有效的鸟只数量。");
      } else if (count > 10000) {
        errors.push(`观测数量过大，当前 ${count} 只，单次上报最多允许 10000 只，请核实数据后重新提交。`);
      }

      if (!location) {
        errors.push("观测地点不能为空，请输入观测位置。");
      } else if (location.length < 2) {
        errors.push("观测地点过短，至少需要 2 个字符，请补充完整。");
      } else if (location.length > 48) {
        errors.push(`观测地点过长，当前 ${location.length} 字符，最多允许 48 字符，请精简。`);
      }

      if (!route) {
        errors.push("迁飞路线不能为空，请选择或输入迁飞路线。");
      } else if (!validRouteNames.includes(route)) {
        errors.push(`迁飞路线「${route}」不存在，请从以下有效路线中选择：${validRouteNames.join("、")}。`);
      }

      if (errors.length === 0) {
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        const recentDuplicate = data.observations.find((obs) => {
          const recordedAt = new Date(obs.recordedAt);
          return obs.location === location && recordedAt >= fiveMinutesAgo;
        });
        if (recentDuplicate) {
          const timeDiff = Math.round((now - new Date(recentDuplicate.recordedAt)) / 1000 / 60);
          errors.push(`同一地点「${location}」在 ${timeDiff} 分钟内已有观测记录上报，短时间内请勿重复提交。如需补充，请在 5 分钟后再次提交。`);
        }
      }

      if (errors.length > 0) {
        return sendJson(res, 400, {
          message: "观测记录提交失败，请检查以下问题：",
          errors: errors
        });
      }

      const observation = {
        id: nextId("OBS", data.observations),
        species: species,
        count: count,
        location: location,
        route: route,
        observer: user.name,
        recordedAt: now.toISOString()
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

    if (req.method === "GET" && url.pathname.startsWith("/api/admin/stations/")) {
      const user = requireUser(req, res, ["admin", "ranger"]);
      if (!user) return;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const station = data.stations.find((s) => s.id === id);
      if (!station) return sendJson(res, 404, { message: "监测站不存在。" });
      return sendJson(res, 200, { station });
    }

    if (req.method === "GET" && url.pathname === "/api/stations/health") {
      const user = requireUser(req, res);
      if (!user) return;
      const summary = getStationHealthSummary(data.stations);
      return sendJson(res, 200, { summary });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/broadcasts") {
      const user = requireUser(req, res, ["admin"]);
      if (!user) return;
      const broadcasts = data.broadcasts
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, { broadcasts });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/broadcasts") {
      const user = requireUser(req, res, ["admin"]);
      if (!user) return;
      const body = await readBody(req);
      const title = String(body.title || "").trim();
      const content = String(body.content || "").trim();
      const errors = [];
      if (!title) {
        errors.push("通知标题不能为空，请输入有效的标题内容。");
      } else if (title.length < 2) {
        errors.push("通知标题过短，至少需要 2 个字符，请补充完整。");
      } else if (title.length > 48) {
        errors.push(`通知标题过长，当前 ${title.length} 字符，最多允许 48 字符，请精简。`);
      }
      if (!content) {
        errors.push("通知内容不能为空，请输入具体的监管要求。");
      } else if (content.length < 5) {
        errors.push("通知内容过短，至少需要 5 个字符，请详细描述监管事项。");
      } else if (content.length > 180) {
        errors.push(`通知内容过长，当前 ${content.length} 字符，最多允许 180 字符，请精简。`);
      }
      if (errors.length > 0) {
        return sendJson(res, 400, {
          message: "监管通知发布失败，请检查以下问题：",
          errors: errors
        });
      }
      const broadcast = {
        id: nextId("BRC", data.broadcasts),
        title: title,
        content: content,
        publisher: user.name,
        createdAt: new Date().toISOString()
      };
      data.broadcasts.push(broadcast);
      writeStore(data);
      return sendJson(res, 201, { broadcast });
    }

    if (req.method === "GET" && url.pathname === "/api/species") {
      const user = requireUser(req, res);
      if (!user) return;
      return sendJson(res, 200, { speciesList: data.speciesList });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/admin/species/")) {
      const user = requireUser(req, res, ["admin", "ranger"]);
      if (!user) return;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const species = data.speciesList.find((s) => s.id === id);
      if (!species) return sendJson(res, 404, { message: "物种不存在。" });
      return sendJson(res, 200, { species });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/species") {
      const user = requireUser(req, res, ["admin"]);
      if (!user) return;
      const body = await readBody(req);
      const errors = [];
      const name = String(body.name || "").trim();
      const protectionLevel = String(body.protectionLevel || "").trim();
      const commonRoutes = Array.isArray(body.commonRoutes) ? body.commonRoutes.map((r) => String(r).trim()).filter(Boolean) : [];
      const remarks = String(body.remarks || "").trim();
      const validRouteNames = data.routes.map((r) => r.name);

      if (!name) {
        errors.push("候鸟名称不能为空，请输入鸟种名称。");
      } else if (name.length < 2) {
        errors.push("候鸟名称过短，至少需要 2 个字符，请补充完整。");
      } else if (name.length > 32) {
        errors.push(`候鸟名称过长，当前 ${name.length} 字符，最多允许 32 字符，请精简。`);
      } else if (data.speciesList.some((s) => s.name === name)) {
        errors.push(`候鸟名称「${name}」已存在，请使用其他名称。`);
      }

      if (!protectionLevel) {
        errors.push("保护等级不能为空，请选择保护等级。");
      } else if (!["国家一级", "国家二级", "三有保护", "无"].includes(protectionLevel)) {
        errors.push(`保护等级「${protectionLevel}」无效，请选择有效等级。`);
      }

      if (commonRoutes.length === 0) {
        errors.push("常见路线不能为空，请至少选择一条迁飞路线。");
      } else {
        for (const route of commonRoutes) {
          if (!validRouteNames.includes(route)) {
            errors.push(`迁飞路线「${route}」不存在，请从有效路线中选择。`);
            break;
          }
        }
      }

      if (remarks.length > 500) {
        errors.push(`监测备注过长，当前 ${remarks.length} 字符，最多允许 500 字符，请精简。`);
      }

      if (errors.length > 0) {
        return sendJson(res, 400, {
          message: "重点物种创建失败，请检查以下问题：",
          errors: errors
        });
      }

      const now = new Date().toISOString();
      const species = {
        id: nextId("SPC", data.speciesList),
        name: name,
        protectionLevel: protectionLevel,
        commonRoutes: commonRoutes,
        remarks: remarks,
        createdAt: now,
        updatedAt: now
      };
      data.speciesList.push(species);
      writeStore(data);
      return sendJson(res, 201, { species });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/species/")) {
      const user = requireUser(req, res, ["admin"]);
      if (!user) return;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const species = data.speciesList.find((s) => s.id === id);
      if (!species) return sendJson(res, 404, { message: "物种不存在。" });

      const body = await readBody(req);
      const errors = [];
      const validRouteNames = data.routes.map((r) => r.name);

      let name = species.name;
      if (body.name !== undefined) {
        name = String(body.name).trim();
        if (!name) {
          errors.push("候鸟名称不能为空，请输入鸟种名称。");
        } else if (name.length < 2) {
          errors.push("候鸟名称过短，至少需要 2 个字符，请补充完整。");
        } else if (name.length > 32) {
          errors.push(`候鸟名称过长，当前 ${name.length} 字符，最多允许 32 字符，请精简。`);
        } else if (name !== species.name && data.speciesList.some((s) => s.name === name)) {
          errors.push(`候鸟名称「${name}」已存在，请使用其他名称。`);
        }
      }

      let protectionLevel = species.protectionLevel;
      if (body.protectionLevel !== undefined) {
        protectionLevel = String(body.protectionLevel).trim();
        if (!protectionLevel) {
          errors.push("保护等级不能为空，请选择保护等级。");
        } else if (!["国家一级", "国家二级", "三有保护", "无"].includes(protectionLevel)) {
          errors.push(`保护等级「${protectionLevel}」无效，请选择有效等级。`);
        }
      }

      let commonRoutes = species.commonRoutes;
      if (body.commonRoutes !== undefined) {
        commonRoutes = Array.isArray(body.commonRoutes) ? body.commonRoutes.map((r) => String(r).trim()).filter(Boolean) : [];
        if (commonRoutes.length === 0) {
          errors.push("常见路线不能为空，请至少选择一条迁飞路线。");
        } else {
          for (const route of commonRoutes) {
            if (!validRouteNames.includes(route)) {
              errors.push(`迁飞路线「${route}」不存在，请从有效路线中选择。`);
              break;
            }
          }
        }
      }

      let remarks = species.remarks;
      if (body.remarks !== undefined) {
        remarks = String(body.remarks).trim();
        if (remarks.length > 500) {
          errors.push(`监测备注过长，当前 ${remarks.length} 字符，最多允许 500 字符，请精简。`);
        }
      }

      if (errors.length > 0) {
        return sendJson(res, 400, {
          message: "重点物种更新失败，请检查以下问题：",
          errors: errors
        });
      }

      species.name = name;
      species.protectionLevel = protectionLevel;
      species.commonRoutes = commonRoutes;
      species.remarks = remarks;
      species.updatedAt = new Date().toISOString();
      writeStore(data);
      return sendJson(res, 200, { species });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/species/")) {
      const user = requireUser(req, res, ["admin"]);
      if (!user) return;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const index = data.speciesList.findIndex((s) => s.id === id);
      if (index === -1) return sendJson(res, 404, { message: "物种不存在。" });

      data.speciesList.splice(index, 1);
      writeStore(data);
      return sendJson(res, 200, { message: "物种已删除。" });
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
