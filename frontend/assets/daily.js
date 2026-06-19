const rawToken = localStorage.getItem("mb_token");
const rawExpiresAt = localStorage.getItem("mb_expires_at");
const hasLegacyAuth = rawToken && !rawExpiresAt;
if (hasLegacyAuth) {
  localStorage.removeItem("mb_token");
  localStorage.removeItem("mb_user");
}

const state = {
  token: hasLegacyAuth ? null : rawToken,
  user: hasLegacyAuth ? null : JSON.parse(localStorage.getItem("mb_user") || "null"),
  expiresAt: hasLegacyAuth ? 0 : Number(rawExpiresAt || 0),
  currentDate: new Date().toISOString().split("T")[0],
  report: null
};

const $ = (selector) => document.querySelector(selector);

function clearAuth() {
  state.token = null;
  state.user = null;
  state.expiresAt = 0;
  localStorage.removeItem("mb_token");
  localStorage.removeItem("mb_user");
  localStorage.removeItem("mb_expires_at");
}

function isTokenExpired() {
  if (!state.expiresAt) return false;
  return Date.now() > state.expiresAt;
}

function showTokenExpiredAndReload(message) {
  clearAuth();
  const msg = message || "登录凭证已过期，请重新登录。";
  alert(msg);
  location.reload();
}

async function api(path, options = {}) {
  if (state.token && isTokenExpired()) {
    showTokenExpiredAndReload();
    return;
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && data.code === "TOKEN_EXPIRED") {
      showTokenExpiredAndReload(data.message);
      return;
    }
    const error = new Error(data.message || "请求失败");
    error.errors = data.errors || null;
    throw error;
  }
  return data;
}

function fmtTime(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function fmtDate(value) {
  return new Date(value).toLocaleDateString("zh-CN");
}

function statusLabel(status) {
  return { open: "待处理", processing: "处理中", resolved: "已闭环" }[status] || status;
}

function stationStatusLabel(status) {
  return { online: "在线", warning: "告警", offline: "离线" }[status] || status;
}

function renderKeyHighlights(highlights) {
  const container = $("#keyHighlights");
  if (!container) return;

  const trendIcons = {
    up: "↑",
    down: "↓",
    stable: "→",
    warning: "⚠"
  };

  const trendClasses = {
    up: "trend-up",
    down: "trend-down",
    stable: "trend-stable",
    warning: "trend-warning"
  };

  container.innerHTML = highlights.map((h) => `
    <article class="highlight-card">
      <div class="highlight-icon">${h.icon}</div>
      <div class="highlight-content">
        <div class="highlight-title">${h.title}</div>
        <div class="highlight-value-row">
          <strong class="highlight-value">${h.value}</strong>
          <span class="highlight-trend ${trendClasses[h.trend] || ''}">
            ${trendIcons[h.trend] || ''} ${h.trendValue}
          </span>
        </div>
        <div class="highlight-desc">${h.description}</div>
      </div>
    </article>
  `).join("");
}

function renderCountsChart(dailyCounts) {
  const container = $("#countsChart");
  if (!container) return;

  const max = Math.max(...dailyCounts, 1);
  const bars = dailyCounts.map((count, idx) => {
    const height = (count / max) * 100;
    const isLatest = idx === dailyCounts.length - 1;
    const dayNum = idx + 1;
    return `
      <div class="chart-bar-col">
        <div class="chart-bar ${isLatest ? 'latest' : ''}" style="height: ${height}%">
          <span class="chart-bar-value">${count.toLocaleString()}</span>
        </div>
        <span class="chart-bar-label">D${dayNum}</span>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="chart-container">
      <div class="chart-y-axis">
        <span>${max.toLocaleString()}</span>
        <span>${Math.round(max / 2).toLocaleString()}</span>
        <span>0</span>
      </div>
      <div class="chart-bars">
        ${bars}
      </div>
    </div>
  `;
}

function renderCountsStats(migrationCounts) {
  const container = $("#countsStats");
  if (!container) return;

  const trendText = migrationCounts.countTrend === "up" ? "上升"
    : migrationCounts.countTrend === "down" ? "下降" : "持平";
  const trendClass = migrationCounts.countTrend === "up" ? "text-ok"
    : migrationCounts.countTrend === "down" ? "text-danger" : "";
  const deltaSign = migrationCounts.countDelta > 0 ? "+" : "";

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <span class="stat-label">今日过境</span>
        <strong class="stat-value">${migrationCounts.latestCount.toLocaleString()} 只</strong>
      </div>
      <div class="stat-item">
        <span class="stat-label">较昨日</span>
        <strong class="stat-value ${trendClass}">${trendText} ${deltaSign}${migrationCounts.countDelta.toLocaleString()} 只</strong>
      </div>
      <div class="stat-item">
        <span class="stat-label">累计过境</span>
        <strong class="stat-value">${migrationCounts.totalBirdsCumulative.toLocaleString()} 只</strong>
      </div>
      <div class="stat-item">
        <span class="stat-label">观测周期</span>
        <strong class="stat-value">${migrationCounts.dailyCounts.length} 天</strong>
      </div>
    </div>
  `;

  $("#countsMeta").textContent = `${migrationCounts.dailyCounts.length} 天数据`;
}

function renderRoutesStats(routeOverview) {
  const summaryContainer = $("#routesStatsSummary");
  const listContainer = $("#routesList");
  if (!summaryContainer || !listContainer) return;

  summaryContainer.innerHTML = `
    <div class="route-stats-grid">
      <div class="route-stat-card">
        <span class="route-stat-label">平均进度</span>
        <div class="route-stat-progress">
          <div class="progress-bar-large"><i style="width:${routeOverview.avgProgress}%"></i></div>
          <span class="route-stat-percent">${routeOverview.avgProgress}%</span>
        </div>
      </div>
      <div class="route-stat-card risk-highlight">
        <span class="route-stat-label">风险分布</span>
        <div class="risk-counts-row">
          <span class="risk-count high"><span class="dot high"></span>${routeOverview.highRiskCount}</span>
          <span class="risk-count medium"><span class="dot medium"></span>${routeOverview.mediumRiskCount}</span>
          <span class="risk-count low"><span class="dot low"></span>${routeOverview.lowRiskCount}</span>
        </div>
      </div>
    </div>
  `;

  const levelClassMap = { "高": "high", "中": "medium", "低": "low" };

  listContainer.innerHTML = routeOverview.routes.map((r) => `
    <article class="daily-route-item">
      <div class="daily-route-head">
        <strong>${r.routeName}</strong>
        <span class="tag ${levelClassMap[r.risk.level] || ''}">${r.risk.levelText}</span>
      </div>
      <div class="daily-route-meta">
        <span>${r.season}</span>
        <span>·</span>
        <span>📍 ${r.currentArea}</span>
      </div>
      <div class="daily-route-progress-row">
        <div class="progress"><i style="width:${r.progress.value}%"></i></div>
        <span class="progress-text">${r.progress.stageLabel} · ${r.progress.value}%</span>
      </div>
      <p class="daily-route-species">🎯 重点鸟种：${r.species.join("、")}</p>
    </article>
  `).join("");

  $("#routesMeta").textContent = `${routeOverview.totalRoutes} 条路线`;
}

function renderAlertsStats(alertOverview) {
  const statsContainer = $("#alertsStats");
  const pendingContainer = $("#pendingAlerts");
  if (!statsContainer || !pendingContainer) return;

  statsContainer.innerHTML = `
    <div class="alert-stats-grid">
      <div class="alert-stat-item total">
        <div class="alert-stat-value">${alertOverview.total}</div>
        <div class="alert-stat-label">告警总数</div>
      </div>
      <div class="alert-stat-item new">
        <div class="alert-stat-value">${alertOverview.todayNew}</div>
        <div class="alert-stat-label">今日新增</div>
      </div>
      <div class="alert-stat-item active">
        <div class="alert-stat-value">${alertOverview.active}</div>
        <div class="alert-stat-label">待处置</div>
      </div>
      <div class="alert-stat-item resolved">
        <div class="alert-stat-value">${alertOverview.resolved}</div>
        <div class="alert-stat-label">已闭环</div>
      </div>
    </div>
    <div class="alert-level-row">
      <div class="alert-level-item high">
        <span class="dot high"></span>
        <span>高风险 ${alertOverview.high}</span>
      </div>
      <div class="alert-level-item medium">
        <span class="dot medium"></span>
        <span>中风险 ${alertOverview.medium}</span>
      </div>
      <div class="alert-level-item low">
        <span class="dot low"></span>
        <span>低风险 ${alertOverview.low}</span>
      </div>
    </div>
  `;

  const levelClassMap = { "高": "high", "中": "medium", "低": "low" };

  if (alertOverview.pendingAlerts.length === 0) {
    pendingContainer.innerHTML = `
      <div class="empty-hint-panel">
        <span class="empty-icon">✅</span>
        <span>暂无待处置告警，当日工作已闭环。</span>
      </div>
    `;
  } else {
    pendingContainer.innerHTML = alertOverview.pendingAlerts.map((a) => `
      <article class="list-item alert-list-item ${a.level === "高" ? "high-risk" : ""}">
        <div class="alert-list-header">
          <strong>${a.title}</strong>
          <span class="tag ${levelClassMap[a.level] || ''}">${a.level}风险</span>
        </div>
        <p>
          <span class="tag ${a.status}">${statusLabel(a.status)}</span>
          ${a.area} · 创建于 ${fmtTime(a.createdAt)}
        </p>
        ${a.remark ? `<p class="alert-remark">📋 ${a.remark.length > 80 ? a.remark.slice(0, 80) + "…" : a.remark}</p>` : ""}
      </article>
    `).join("");
  }
}

function renderObsStats(observationOverview) {
  const statsRow = $("#obsStatsRow");
  const topLists = $("#obsTopLists");
  const recent = $("#recentObservations");
  if (!statsRow || !topLists || !recent) return;

  statsRow.innerHTML = `
    <div class="obs-stat-card">
      <div class="obs-stat-icon">📝</div>
      <div class="obs-stat-info">
        <span class="obs-stat-label">观测记录</span>
        <strong class="obs-stat-value">${observationOverview.todayTotal} 条</strong>
      </div>
    </div>
    <div class="obs-stat-card">
      <div class="obs-stat-icon">🐦</div>
      <div class="obs-stat-info">
        <span class="obs-stat-label">观测鸟只</span>
        <strong class="obs-stat-value">${observationOverview.todayBirdCount.toLocaleString()} 只</strong>
      </div>
    </div>
    <div class="obs-stat-card">
      <div class="obs-stat-icon">🦤</div>
      <div class="obs-stat-info">
        <span class="obs-stat-label">涉及鸟种</span>
        <strong class="obs-stat-value">${observationOverview.topSpecies.length} 种</strong>
      </div>
    </div>
  `;

  $("#obsMeta").textContent = `${observationOverview.todayTotal} 条记录`;

  const emptyList = `<div class="empty-sublist"><span>暂无数据</span></div>`;

  const renderTopList = (title, icon, items, suffix) => {
    if (!items || items.length === 0) {
      return `
        <div class="obs-top-col">
          <h4>${icon} ${title}</h4>
          ${emptyList}
        </div>
      `;
    }
    return `
      <div class="obs-top-col">
        <h4>${icon} ${title}</h4>
        <div class="obs-top-list">
          ${items.map((item, idx) => `
            <div class="obs-top-item">
              <span class="obs-top-rank">${idx + 1}</span>
              <span class="obs-top-name">${item.name}</span>
              <span class="obs-top-count">${item.totalCount.toLocaleString()}${suffix || ""}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  };

  topLists.innerHTML = `
    <div class="obs-top-grid">
      ${renderTopList("TOP 鸟种", "🦆", observationOverview.topSpecies, "只")}
      ${renderTopList("TOP 路线", "🛤️", observationOverview.topRoutes, "只")}
      ${renderTopList("TOP 地点", "📍", observationOverview.topLocations, "只")}
    </div>
  `;

  if (observationOverview.recentObservations.length === 0) {
    recent.innerHTML = `
      <div class="empty-hint-panel">
        <span class="empty-icon">📋</span>
        <span>今日暂无观测记录，等待巡护员上报。</span>
      </div>
    `;
  } else {
    recent.innerHTML = observationOverview.recentObservations.map((obs) => `
      <article class="list-item">
        <strong>${obs.species} · ${obs.count}只</strong>
        <p>
          📍 ${obs.location} · 🛤️ ${obs.route}
        </p>
        <p class="obs-meta">
          👤 ${obs.observer} · 🕐 ${fmtTime(obs.recordedAt)}
        </p>
      </article>
    `).join("");
  }
}

function renderStationStats(stationOverview) {
  const overviewRow = $("#stationOverviewRow");
  const batteryDaily = $("#batteryStatsDaily");
  const abnormalWrap = $("#stationAbnormalWrap");
  const abnormalCards = $("#abnormalCards");
  if (!overviewRow || !batteryDaily) return;

  const RADIUS = 60;
  const CIRC = 2 * Math.PI * RADIUS;
  const total = stationOverview.total || 1;
  const onlineDash = (stationOverview.online / total) * CIRC;
  const warningDash = (stationOverview.warning / total) * CIRC;
  const offlineDash = (stationOverview.offline / total) * CIRC;

  overviewRow.innerHTML = `
    <div class="station-donut-wrap">
      <svg class="donut-chart station-donut" viewBox="0 0 180 180" aria-hidden="true">
        <circle class="donut-track" cx="90" cy="90" r="${RADIUS}" />
        <circle class="donut-segment donut-online" cx="90" cy="90" r="${RADIUS}"
          stroke-dasharray="${onlineDash} ${CIRC}"
          stroke-dashoffset="0"
          transform="rotate(-90 90 90)" />
        <circle class="donut-segment donut-warning" cx="90" cy="90" r="${RADIUS}"
          stroke-dasharray="${warningDash} ${CIRC}"
          stroke-dashoffset="-${onlineDash}"
          transform="rotate(-90 90 90)" />
        <circle class="donut-segment donut-offline" cx="90" cy="90" r="${RADIUS}"
          stroke-dasharray="${offlineDash} ${CIRC}"
          stroke-dashoffset="-${onlineDash + warningDash}"
          transform="rotate(-90 90 90)" />
      </svg>
      <div class="donut-center station-donut-center">
        <span class="donut-total">${stationOverview.onlineRate}%</span>
        <span class="donut-label">在线率</span>
      </div>
    </div>
    <div class="station-summary-cards">
      <div class="station-summary-card online">
        <span class="ss-icon">✓</span>
        <div class="ss-info">
          <span class="ss-label">在线站点</span>
          <strong class="ss-value">${stationOverview.online}<span class="ss-unit">/${stationOverview.total}</span></strong>
        </div>
      </div>
      <div class="station-summary-card warning">
        <span class="ss-icon">⚠</span>
        <div class="ss-info">
          <span class="ss-label">告警站点</span>
          <strong class="ss-value">${stationOverview.warning}</strong>
        </div>
      </div>
      <div class="station-summary-card offline">
        <span class="ss-icon">✗</span>
        <div class="ss-info">
          <span class="ss-label">离线站点</span>
          <strong class="ss-value">${stationOverview.offline}</strong>
        </div>
      </div>
      <div class="station-summary-card battery">
        <span class="ss-icon">🔋</span>
        <div class="ss-info">
          <span class="ss-label">平均电量</span>
          <strong class="ss-value">${stationOverview.avgBattery}<span class="ss-unit">%</span></strong>
        </div>
      </div>
    </div>
  `;

  const bd = stationOverview.batteryDistribution || { critical: 0, low: 0, medium: 0, good: 0, unknown: 0 };
  const bdTotal = bd.critical + bd.low + bd.medium + bd.good + bd.unknown || 1;

  batteryDaily.innerHTML = `
    <div class="battery-overview-row">
      <div class="battery-overall">
        <span class="bo-label">平均电量</span>
        <strong class="bo-value ${stationOverview.avgBattery < 40 ? 'text-danger' : stationOverview.avgBattery < 70 ? 'text-warn' : 'text-ok'}">${stationOverview.avgBattery}%</strong>
      </div>
      <div class="battery-alerts">
        ${stationOverview.criticalBattery > 0 ? `<span class="battery-alert-tag critical">🔴 严重低电 ${stationOverview.criticalBattery}站</span>` : ""}
        ${stationOverview.lowBattery > 0 ? `<span class="battery-alert-tag low">🟠 低电量 ${stationOverview.lowBattery}站</span>` : ""}
      </div>
    </div>
    <div class="battery-bar-grid">
      <div class="battery-bar-item">
        <span class="bbl-label">严重低电 &lt;20%</span>
        <div class="bbl-track"><div class="bbl-fill critical" style="width: ${(bd.critical / bdTotal) * 100}%"></div></div>
        <span class="bbl-count">${bd.critical}</span>
      </div>
      <div class="battery-bar-item">
        <span class="bbl-label">低电量 20-40%</span>
        <div class="bbl-track"><div class="bbl-fill low" style="width: ${(bd.low / bdTotal) * 100}%"></div></div>
        <span class="bbl-count">${bd.low}</span>
      </div>
      <div class="battery-bar-item">
        <span class="bbl-label">中等 40-70%</span>
        <div class="bbl-track"><div class="bbl-fill medium" style="width: ${(bd.medium / bdTotal) * 100}%"></div></div>
        <span class="bbl-count">${bd.medium}</span>
      </div>
      <div class="battery-bar-item">
        <span class="bbl-label">良好 ≥70%</span>
        <div class="bbl-track"><div class="bbl-fill good" style="width: ${(bd.good / bdTotal) * 100}%"></div></div>
        <span class="bbl-count">${bd.good}</span>
      </div>
    </div>
  `;

  $("#stationMeta").textContent = `${stationOverview.total} 个站点 · 在线率 ${stationOverview.onlineRate}%`;

  if (stationOverview.abnormalStations && stationOverview.abnormalStations.length > 0) {
    abnormalWrap.hidden = false;
    abnormalCards.innerHTML = stationOverview.abnormalStations.map((s) => `
      <div class="abnormal-card-daily ${s.status}">
        <div class="acd-head">
          <strong>${s.name}</strong>
          <span class="tag ${s.status}">${stationStatusLabel(s.status)}</span>
        </div>
        <p class="acd-reason">${s.abnormalReason || "暂无异常说明"}</p>
        <div class="acd-meta">
          ${s.battery !== null ? `<span>🔋 ${s.battery}%</span>` : ""}
          <span>🕐 ${s.lastReportedAt ? fmtTime(s.lastReportedAt) : "—"}</span>
        </div>
      </div>
    `).join("");
  } else {
    abnormalWrap.hidden = true;
  }
}

function renderOverallStatus(summary) {
  const card = $("#overallStatusCard");
  const statusText = $("#overallStatusText");
  const summaryText = $("#overallSummary");
  if (!card || !statusText || !summaryText) return;

  card.className = `overall-status-card status-${summary.overallStatus}`;
  statusText.textContent = summary.overallStatusText;
  summaryText.textContent = summary.overallSummary;
}

function renderReportMeta(report) {
  $("#reportId").textContent = report.reportId;
  $("#generatedAt").textContent = fmtTime(report.generatedAt);
}

async function loadDailyReport() {
  if (!state.token) return;

  try {
    const params = new URLSearchParams();
    if (state.currentDate) {
      params.set("date", state.currentDate);
    }
    const url = params.toString() ? `/api/daily-report?${params}` : "/api/daily-report";
    const result = await api(url);
    state.report = result.report;

    renderOverallStatus(result.report.summary);
    renderReportMeta(result.report);
    renderKeyHighlights(result.report.summary.keyHighlights);
    renderCountsChart(result.report.migrationCounts.dailyCounts);
    renderCountsStats(result.report.migrationCounts);
    renderRoutesStats(result.report.routeOverview);
    renderAlertsStats(result.report.alertOverview);
    renderObsStats(result.report.observationOverview);
    renderStationStats(result.report.stationOverview);

    $("#reportContent").hidden = false;
    $("#loginPanel").hidden = true;
  } catch (error) {
    console.error("Failed to load daily report:", error);
    alert(error.message || "日报加载失败");
  }
}

function showLoginPanel() {
  $("#loginPanel").hidden = false;
  $("#reportContent").hidden = true;
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    state.token = result.token;
    state.user = result.user;
    state.expiresAt = result.expiresAt || 0;
    localStorage.setItem("mb_token", result.token);
    localStorage.setItem("mb_user", JSON.stringify(result.user));
    if (result.expiresAt) {
      localStorage.setItem("mb_expires_at", String(result.expiresAt));
    }
    $("#loginMsg").textContent = `${result.user.name}，欢迎查看日报。`;
    await loadDailyReport();
  } catch (error) {
    $("#loginMsg").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  clearAuth();
  location.reload();
});

$("#refreshBtn").addEventListener("click", () => {
  loadDailyReport();
});

$("#reportDate").addEventListener("change", (event) => {
  state.currentDate = event.target.value;
  loadDailyReport();
});

function init() {
  const dateInput = $("#reportDate");
  if (dateInput) {
    dateInput.value = state.currentDate;
    dateInput.max = new Date().toISOString().split("T")[0];
  }

  if (state.token) {
    loadDailyReport().catch(() => {
      showLoginPanel();
      $("#loginMsg").textContent = "请重新登录查看日报。";
    });
  } else {
    showLoginPanel();
  }
}

init();
