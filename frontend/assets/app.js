const state = {
  token: localStorage.getItem("mb_token"),
  user: JSON.parse(localStorage.getItem("mb_user") || "null"),
  expiresAt: Number(localStorage.getItem("mb_expires_at") || 0),
  allRoutes: [],
  allSpecies: [],
  filters: {
    risk: "all",
    season: "all",
    currentArea: "all"
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

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

function riskClass(risk) {
  return { high: "high", medium: "medium", low: "low" }[risk] || "low";
}

function renderMetric(metric) {
  const sign = metric.delta > 0 ? "+" : "";
  return `
    <article class="metric-card">
      <div class="metric-info">
        <span>${metric.label}</span>
        <strong>${metric.latest}${metric.unit}</strong>
        <em>${sign}${metric.delta}${metric.unit} 较上一周期</em>
      </div>
    </article>
  `;
}

function renderRoute(route) {
  return `
    <article class="list-item" data-route-id="${route.id}" role="button" tabindex="0">
      <strong>${route.name}</strong>
      <p>
        <span class="tag ${riskClass(route.risk)}">${route.risk.toUpperCase()}</span>
        ${route.season} · 当前 ${route.currentArea} · 重点鸟种 ${route.species.join("、")}
      </p>
      <div class="progress"><i style="width:${route.progress}%"></i></div>
    </article>
  `;
}

function riskLabel(risk) {
  return { high: "高风险", medium: "中风险", low: "低风险" }[risk] || "未知";
}

function protectionLevelClass(level) {
  return {
    "国家一级": "high",
    "国家二级": "medium",
    "三有保护": "low",
    "无": ""
  }[level] || "";
}

function protectionLevelLabel(level) {
  return level || "无";
}

function renderRouteDetail(route) {
  const riskColor = riskClass(route.risk);
  return `
    <div class="route-detail-section">
      <div class="detail-highlight">
        <div class="highlight-card risk-${riskColor}">
          <span class="highlight-label">风险等级</span>
          <div class="highlight-value">
            <span class="risk-badge ${riskColor}">${riskLabel(route.risk)}</span>
          </div>
        </div>
        <div class="highlight-card season">
          <span class="highlight-label">迁徙阶段</span>
          <div class="highlight-value">
            ${route.season}
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>迁徙进度</h3>
        <div class="progress-detail">
          <div class="progress-header">
            <span class="detail-item-label">已完成</span>
            <span class="progress-percent">${route.progress}%</span>
          </div>
          <div class="progress-bar-large"><i style="width:${route.progress}%"></i></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>基本信息</h3>
        <div class="detail-item">
          <span class="detail-item-label">当前区域</span>
          <span class="detail-item-value">${route.currentArea}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">路线编号</span>
          <span class="detail-item-value route-id">${route.id}</span>
        </div>
      </div>

      <div class="detail-section">
        <h3>重点鸟种</h3>
        <div class="species-tags">
          ${route.species.map(s => `<span class="species-tag">${s}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
}

function openRouteDrawer(routeId) {
  const route = state.allRoutes.find(r => r.id === routeId);
  if (!route) return;

  $("#drawerRouteName").textContent = route.name;
  $("#drawerContent").innerHTML = renderRouteDetail(route);

  $("#routeDrawer").classList.add("open");
  $("#routeDrawer").setAttribute("aria-hidden", "false");
  $("#routeDrawerOverlay").classList.add("visible");

  $$("#routes .list-item").forEach(item => {
    item.classList.toggle("active", item.dataset.routeId === routeId);
  });

  const path = $(`#route-path-${routeId}`);
  if (path) {
    path.style.strokeWidth = "8";
    path.style.filter = "drop-shadow(0 0 6px rgba(15, 123, 108, 0.5))";
  }
}

function closeRouteDrawer() {
  $("#routeDrawer").classList.remove("open");
  $("#routeDrawer").setAttribute("aria-hidden", "true");
  $("#routeDrawerOverlay").classList.remove("visible");

  $$("#routes .list-item").forEach(item => {
    item.classList.remove("active");
  });

  $$(".map-visual path").forEach(path => {
    path.style.strokeWidth = "";
    path.style.filter = "";
  });
}

function bindRouteClickEvents() {
  $("#routes").addEventListener("click", (e) => {
    const item = e.target.closest(".list-item");
    if (item) {
      openRouteDrawer(item.dataset.routeId);
    }
  });

  $("#routes").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const item = e.target.closest(".list-item");
      if (item) {
        e.preventDefault();
        openRouteDrawer(item.dataset.routeId);
      }
    }
  });

  $("#drawerClose").addEventListener("click", closeRouteDrawer);
  $("#routeDrawerOverlay").addEventListener("click", closeRouteDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#routeDrawer").classList.contains("open")) {
      closeRouteDrawer();
    }
  });
}

function getFilteredRoutes() {
  return state.allRoutes.filter((route) => {
    if (state.filters.risk !== "all" && route.risk !== state.filters.risk) return false;
    if (state.filters.season !== "all" && route.season !== state.filters.season) return false;
    if (state.filters.currentArea !== "all" && route.currentArea !== state.filters.currentArea) return false;
    return true;
  });
}

function updateMapVisual(filteredRoutes) {
  const filteredIds = new Set(filteredRoutes.map((r) => r.id));
  state.allRoutes.forEach((route) => {
    const path = $(`#route-path-${route.id}`);
    if (!path) return;
    path.classList.remove("dimmed", "highlight-high", "highlight-medium", "highlight-low");
    if (filteredIds.size === state.allRoutes.length) {
      path.classList.add(`highlight-${route.risk}`);
    } else if (filteredIds.has(route.id)) {
      path.classList.add(`highlight-${route.risk}`);
    } else {
      path.classList.add("dimmed");
    }
  });
}

function populateFilterOptions() {
  const seasons = [...new Set(state.allRoutes.map((r) => r.season))];
  const areas = [...new Set(state.allRoutes.map((r) => r.currentArea))];

  const seasonSelect = $("#filterSeason");
  const areaSelect = $("#filterArea");

  seasons.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    seasonSelect.appendChild(opt);
  });

  areas.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    areaSelect.appendChild(opt);
  });
}

function applyFilters() {
  const filtered = getFilteredRoutes();
  $("#routeCount").textContent = `${filtered.length} 条路线`;
  $("#routes").innerHTML = filtered.map(renderRoute).join("") || `<p style="color:var(--muted);padding:14px;">暂无符合条件的路线</p>`;
  updateMapVisual(filtered);
}

function resetFilters() {
  state.filters = { risk: "all", season: "all", currentArea: "all" };
  $$("#filterRisk .chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.value === "all");
  });
  $("#filterSeason").value = "all";
  $("#filterArea").value = "all";
  applyFilters();
}

function bindFilterEvents() {
  $$("#filterRisk .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$("#filterRisk .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.filters.risk = chip.dataset.value;
      applyFilters();
    });
  });

  $("#filterSeason").addEventListener("change", (e) => {
    state.filters.season = e.target.value;
    applyFilters();
  });

  $("#filterArea").addEventListener("change", (e) => {
    state.filters.currentArea = e.target.value;
    applyFilters();
  });

  $("#resetFilters").addEventListener("click", resetFilters);
}

function statusLabel(status) {
  return { open: "待处理", processing: "处理中", resolved: "已闭环" }[status] || status;
}

function stationStatusLabel(status) {
  return { online: "在线", warning: "告警", offline: "离线" }[status] || status;
}

function renderHealthSummary(summary) {
  const onlinePercent = summary.total > 0 ? Math.round((summary.online / summary.total) * 100) : 0;
  const warningPercent = summary.total > 0 ? Math.round((summary.warning / summary.total) * 100) : 0;
  const offlinePercent = summary.total > 0 ? Math.round((summary.offline / summary.total) * 100) : 0;

  const RADIUS = 70;
  const CIRC = 2 * Math.PI * RADIUS;
  const onlineDash = (summary.online / summary.total) * CIRC;
  const warningDash = (summary.warning / summary.total) * CIRC;
  const offlineDash = (summary.offline / summary.total) * CIRC;

  const bd = summary.batteryDistribution || { critical: 0, low: 0, medium: 0, good: 0, unknown: 0 };
  const bdTotal = bd.critical + bd.low + bd.medium + bd.good + bd.unknown || 1;

  return `
    <div class="health-visual-grid">
      <div class="status-distribution-card">
        <h3 class="section-subtitle">📊 站点状态分布</h3>
        <div class="status-distribution-body">
          <div class="donut-chart-wrap">
            <svg class="donut-chart" viewBox="0 0 180 180" aria-hidden="true">
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
            <div class="donut-center">
              <span class="donut-total">${summary.total}</span>
              <span class="donut-label">站点总数</span>
            </div>
          </div>
          <div class="status-legend">
            <div class="legend-item">
              <span class="legend-dot online"></span>
              <span class="legend-label">在线</span>
              <span class="legend-count">${summary.online}</span>
              <span class="legend-percent">${onlinePercent}%</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot warning"></span>
              <span class="legend-label">告警</span>
              <span class="legend-count">${summary.warning}</span>
              <span class="legend-percent">${warningPercent}%</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot offline"></span>
              <span class="legend-label">离线</span>
              <span class="legend-count">${summary.offline}</span>
              <span class="legend-percent">${offlinePercent}%</span>
            </div>
          </div>
        </div>
      </div>

      <div class="battery-distribution-card">
        <h3 class="section-subtitle">🔋 电量分布</h3>
        <div class="battery-stats-row">
          <div class="battery-stat-main">
            <span class="battery-main-label">平均电量</span>
            <strong class="battery-main-value ${summary.avgBattery < 40 ? 'text-danger' : summary.avgBattery < 70 ? 'text-warn' : 'text-ok'}">${summary.avgBattery}%</strong>
          </div>
          <div class="battery-alert-mini">
            ${summary.criticalBattery > 0 ? `<span class="mini-alert critical">⚠ ${summary.criticalBattery} 站严重低电</span>` : ''}
            ${summary.lowBattery > 0 ? `<span class="mini-alert low">⚡ ${summary.lowBattery} 站低电量</span>` : ''}
          </div>
        </div>
        <div class="battery-bars">
          <div class="battery-bar-row">
            <span class="battery-bar-label">严重低电 &lt;20%</span>
            <div class="battery-bar-track">
              <div class="battery-bar-fill critical" style="width: ${(bd.critical / bdTotal) * 100}%"></div>
            </div>
            <span class="battery-bar-count">${bd.critical}</span>
          </div>
          <div class="battery-bar-row">
            <span class="battery-bar-label">低电量 20-40%</span>
            <div class="battery-bar-track">
              <div class="battery-bar-fill low" style="width: ${(bd.low / bdTotal) * 100}%"></div>
            </div>
            <span class="battery-bar-count">${bd.low}</span>
          </div>
          <div class="battery-bar-row">
            <span class="battery-bar-label">中等 40-70%</span>
            <div class="battery-bar-track">
              <div class="battery-bar-fill medium" style="width: ${(bd.medium / bdTotal) * 100}%"></div>
            </div>
            <span class="battery-bar-count">${bd.medium}</span>
          </div>
          <div class="battery-bar-row">
            <span class="battery-bar-label">良好 ≥70%</span>
            <div class="battery-bar-track">
              <div class="battery-bar-fill good" style="width: ${(bd.good / bdTotal) * 100}%"></div>
            </div>
            <span class="battery-bar-count">${bd.good}</span>
          </div>
        </div>
      </div>
    </div>

    ${summary.lowBatteryStations && summary.lowBatteryStations.length > 0 ? `
      <div class="low-battery-panel">
        <div class="low-battery-header">
          <h3 class="section-subtitle danger">🚨 低电量站点预警</h3>
          <span class="low-battery-count">${summary.lowBatteryStations.length} 个站点需关注</span>
        </div>
        <div class="low-battery-grid">
          ${summary.lowBatteryStations.map(station => `
            <div class="low-battery-card ${station.battery < 20 ? 'critical' : 'low'}">
              <div class="low-battery-card-head">
                <strong>${station.name}</strong>
                <span class="battery-level-badge ${station.battery < 20 ? 'critical' : 'low'}">
                  ${station.battery < 20 ? '🔴' : '🟠'} ${station.battery}%
                </span>
              </div>
              <div class="low-battery-info">
                ${station.location ? `<span class="lb-info-item">📍 ${station.location}</span>` : ''}
                <span class="lb-info-item tag ${station.status}">${stationStatusLabel(station.status)}</span>
              </div>
              <div class="low-battery-footer">
                最后上报 ${station.lastReportedAt ? fmtTime(station.lastReportedAt) : '—'}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ''}

    <div class="health-stats">
      <div class="health-stat-card">
        <div class="health-stat-icon online">✓</div>
        <div class="health-stat-info">
          <span class="health-stat-label">在线站点</span>
          <strong class="health-stat-value">${summary.online}<span class="health-stat-unit">/${summary.total}</span></strong>
        </div>
        <div class="health-stat-bar">
          <div class="health-stat-bar-fill online" style="width: ${onlinePercent}%"></div>
        </div>
      </div>

      <div class="health-stat-card">
        <div class="health-stat-icon warning">⚠</div>
        <div class="health-stat-info">
          <span class="health-stat-label">告警站点</span>
          <strong class="health-stat-value">${summary.warning}</strong>
        </div>
      </div>

      <div class="health-stat-card">
        <div class="health-stat-icon offline">✗</div>
        <div class="health-stat-info">
          <span class="health-stat-label">离线站点</span>
          <strong class="health-stat-value">${summary.offline}</strong>
        </div>
      </div>

      <div class="health-stat-card">
        <div class="health-stat-icon battery">🔋</div>
        <div class="health-stat-info">
          <span class="health-stat-label">平均电量</span>
          <strong class="health-stat-value">${summary.avgBattery}<span class="health-stat-unit">%</span></strong>
        </div>
        <div class="health-stat-bar">
          <div class="health-stat-bar-fill ${summary.avgBattery < 40 ? 'low' : summary.avgBattery < 70 ? 'medium' : 'good'}" style="width: ${summary.avgBattery}%"></div>
        </div>
      </div>
    </div>

    ${summary.abnormalStations.length > 0 ? `
      <div class="abnormal-list">
        <h4 class="abnormal-list-title">⚠️ 需关注站点</h4>
        <div class="abnormal-cards">
          ${summary.abnormalStations.map(station => `
            <div class="abnormal-card ${station.status}">
              <div class="abnormal-card-header">
                <strong>${station.name}</strong>
                <span class="tag ${station.status}">${stationStatusLabel(station.status)}</span>
              </div>
              <p class="abnormal-card-reason">${station.abnormalReason || "暂无异常原因说明"}</p>
              <div class="abnormal-card-meta">
                ${station.battery !== null ? `<span>电量 ${station.battery}%</span>` : ""}
                <span>最后上报 ${station.lastReportedAt ? fmtTime(station.lastReportedAt) : "—"}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : `
      <div class="all-clear">
        <span class="all-clear-icon">✅</span>
        <span class="all-clear-text">所有站点运行正常，无需关注</span>
      </div>
    `}
  `;
}

function renderAlert(alert) {
  const latestRemark = alert.remark ? alert.remark.length > 60 ? alert.remark.slice(0, 60) + "…" : alert.remark : null;
  const latestHandler = alert.handler || null;
  const latestUpdate = alert.updatedAt ? fmtTime(alert.updatedAt) : null;
  const riskClass = alert.level === "高" ? "high-risk" : "";

  return `
    <article class="list-item alert-list-item ${riskClass}">
      <div class="alert-list-header">
        <strong>${alert.title}</strong>
        <span class="tag ${alert.level === "高" ? "high" : alert.level === "中" ? "medium" : "low"}">${alert.level}风险</span>
      </div>
      <p>
        <span class="tag ${alert.status}">${statusLabel(alert.status)}</span>
        ${alert.area} · 创建于 ${fmtTime(alert.createdAt)}
      </p>
      ${latestRemark || latestHandler ? `
        <div class="alert-disposal-summary">
          <div class="summary-line">
            <span class="summary-icon">📋</span>
            <span class="summary-text">${latestRemark || "暂无处置说明"}</span>
          </div>
          ${latestHandler ? `
            <div class="summary-meta">
              <span>${latestHandler}</span>
              ${latestUpdate ? `<span>· ${latestUpdate}</span>` : ""}
            </div>
          ` : ""}
        </div>
      ` : `
        <div class="alert-disposal-summary empty">
          <span class="summary-icon">⏳</span>
          <span class="summary-text">尚未处置</span>
        </div>
      `}
    </article>
  `;
}

function renderStation(station) {
  const batteryClass = station.battery !== null && station.battery < 40 ? "battery-low" : "";
  return `
    <article class="list-item station-card ${station.status} ${batteryClass}">
      <div class="station-card-header">
        <strong>${station.name}</strong>
        <span class="tag ${station.status}">${stationStatusLabel(station.status)}</span>
      </div>
      <div class="station-card-metrics">
        <div class="metric-item">
          <span class="metric-label">温度</span>
          <span class="metric-value">${station.temperature !== null ? `${station.temperature}°C` : "—"}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">湿度</span>
          <span class="metric-value">${station.humidity !== null ? `${station.humidity}%` : "—"}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">电量</span>
          <span class="metric-value ${station.battery !== null && station.battery < 40 ? 'text-danger' : ''}">${station.battery !== null ? `${station.battery}%` : "—"}</span>
        </div>
      </div>
      ${station.lastReportedAt ? `
        <p class="station-card-footer">
          最后上报 ${fmtTime(station.lastReportedAt)}
        </p>
      ` : ""}
    </article>
  `;
}

function renderObservation(item) {
  return `
    <article class="list-item">
      <strong>${item.species} ${item.count}只</strong>
      <p>${item.location} · ${item.route} · ${item.observer} · ${fmtTime(item.recordedAt)}</p>
    </article>
  `;
}

function renderBroadcast(broadcast) {
  return `
    <article class="list-item broadcast-item">
      <div class="broadcast-header">
        <strong class="broadcast-title">${broadcast.title}</strong>
      </div>
      <p class="broadcast-content">${broadcast.content}</p>
      <p class="broadcast-meta">
        <span class="broadcast-publisher">发布人：${broadcast.publisher}</span>
        <span class="broadcast-time">${fmtTime(broadcast.createdAt)}</span>
      </p>
    </article>
  `;
}

function populateRouteSelect() {
  const routeSelect = $("#routeSelect");
  if (!routeSelect || state.allRoutes.length === 0) return;

  const currentValue = routeSelect.value;
  routeSelect.innerHTML = '<option value="">请选择迁飞路线</option>';

  state.allRoutes.forEach((route) => {
    const option = document.createElement("option");
    option.value = route.name;
    option.textContent = route.name;
    if (route.risk) {
      option.dataset.risk = route.risk;
    }
    routeSelect.appendChild(option);
  });

  if (currentValue) {
    routeSelect.value = currentValue;
  }
}

function populateSpeciesSelect() {
  const speciesSelect = $("#speciesSelect");
  if (!speciesSelect) return;

  const currentValue = speciesSelect.value;
  speciesSelect.innerHTML = '<option value="">请选择鸟种（从重点物种清单）</option>';

  if (state.allSpecies.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "（暂无重点物种，请先在后台管理添加）";
    emptyOption.disabled = true;
    speciesSelect.appendChild(emptyOption);
    return;
  }

  const sortedSpecies = state.allSpecies.slice().sort((a, b) => {
    const levelOrder = { "国家一级": 0, "国家二级": 1, "三有保护": 2, "无": 3 };
    return (levelOrder[a.protectionLevel] || 4) - (levelOrder[b.protectionLevel] || 4);
  });

  sortedSpecies.forEach((species) => {
    const option = document.createElement("option");
    option.value = species.name;
    option.textContent = `${species.name}（${protectionLevelLabel(species.protectionLevel)}）`;
    option.dataset.protectionLevel = species.protectionLevel;
    option.dataset.remarks = species.remarks || "";
    option.dataset.commonRoutes = (species.commonRoutes || []).join(",");
    speciesSelect.appendChild(option);
  });

  if (currentValue) {
    speciesSelect.value = currentValue;
  }
}

function showSpeciesInfo(speciesName) {
  const infoBox = $("#speciesInfoBox");
  if (!infoBox) return;

  if (!speciesName) {
    infoBox.hidden = true;
    return;
  }

  const species = state.allSpecies.find((s) => s.name === speciesName);
  if (!species) {
    infoBox.hidden = true;
    return;
  }

  const levelClass = protectionLevelClass(species.protectionLevel);
  $("#speciesInfoName").textContent = species.name;
  const levelSpan = $("#speciesInfoLevel");
  levelSpan.textContent = protectionLevelLabel(species.protectionLevel);
  levelSpan.className = `species-info-level tag ${levelClass}`;

  const remarksEl = $("#speciesInfoRemarks");
  if (species.remarks) {
    remarksEl.textContent = species.remarks;
    remarksEl.hidden = false;
  } else {
    remarksEl.hidden = true;
  }

  infoBox.hidden = false;
}

function suggestRouteBySpecies(speciesName) {
  const routeSelect = $("#routeSelect");
  if (!routeSelect || routeSelect.value) return;

  const species = state.allSpecies.find((s) => s.name === speciesName);
  if (!species || !species.commonRoutes || species.commonRoutes.length === 0) return;

  const firstCommonRoute = species.commonRoutes[0];
  if (state.allRoutes.some((r) => r.name === firstCommonRoute)) {
    routeSelect.value = firstCommonRoute;
  }
}

let routeEventsBound = false;
let speciesEventsBound = false;

async function loadDashboard() {
  if (!state.token) return;
  const [overview, alerts, observations, health, speciesData] = await Promise.all([
    api("/api/overview"),
    api("/api/alerts"),
    api("/api/observations"),
    api("/api/stations/health"),
    api("/api/species")
  ]);

  state.allRoutes = overview.routes;
  state.allSpecies = speciesData.speciesList;
  $("#metrics").innerHTML = overview.metrics.map(renderMetric).join("");

  if (overview.announcements && overview.announcements.length > 0) {
    $("#broadcastsPanel").hidden = false;
    $("#broadcastCount").textContent = `${overview.announcements.length} 条`;
    $("#broadcasts").innerHTML = overview.announcements.map(renderBroadcast).join("");
  } else {
    $("#broadcastsPanel").hidden = true;
  }

  populateFilterOptions();
  populateRouteSelect();
  populateSpeciesSelect();
  bindFilterEvents();
  if (!routeEventsBound) {
    bindRouteClickEvents();
    routeEventsBound = true;
  }
  if (!speciesEventsBound) {
    bindSpeciesEvents();
    speciesEventsBound = true;
  }
  applyFilters();
  const levelOrder = { "高": 0, "中": 1, "低": 2 };
  const sortedAlerts = alerts.alerts.slice().sort((a, b) => {
    const levelDiff = (levelOrder[a.level] ?? 3) - (levelOrder[b.level] ?? 3);
    if (levelDiff !== 0) return levelDiff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const alertsHtml = sortedAlerts.map(renderAlert).join("");
  $("#alerts").innerHTML = alertsHtml;
  const alertsMobile = $("#alertsMobile");
  if (alertsMobile) {
    alertsMobile.innerHTML = alertsHtml;
  }
  $("#healthSummary").innerHTML = renderHealthSummary(health.summary);
  $("#stations").innerHTML = overview.stations.map(renderStation).join("");
  $("#observations").innerHTML = observations.observations.map(renderObservation).join("");
}

function bindSpeciesEvents() {
  const speciesSelect = $("#speciesSelect");
  if (!speciesSelect) return;

  speciesSelect.addEventListener("change", (event) => {
    const speciesName = event.target.value;
    showSpeciesInfo(speciesName);
    suggestRouteBySpecies(speciesName);
  });
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
    $("#loginMsg").textContent = `${result.user.name}，欢迎回来。`;
    await loadDashboard();
  } catch (error) {
    $("#loginMsg").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  clearAuth();
  location.reload();
});

let pendingFormData = null;

function showConfirmation(formData) {
  $("#confirmSpecies").textContent = formData.species || "-";
  $("#confirmCount").textContent = formData.count ? `${formData.count} 只` : "-";
  $("#confirmLocation").textContent = formData.location || "-";
  $("#confirmRoute").textContent = formData.route || "-";

  $("#observationForm").hidden = true;
  $("#confirmationSummary").hidden = false;
}

function hideConfirmation() {
  $("#confirmationSummary").hidden = true;
  $("#observationForm").hidden = false;
}

function showObsFormError(error) {
  const errorBox = $("#obsFormError");
  if (!errorBox) return;

  let html = `<div class="error-title">${error.message || "提交失败"}</div>`;
  if (error.errors && error.errors.length > 0) {
    html += '<ul class="error-list">';
    error.errors.forEach((err) => {
      html += `<li>${err}</li>`;
    });
    html += '</ul>';
  }
  errorBox.innerHTML = html;
  errorBox.hidden = false;
}

function hideObsFormError() {
  const errorBox = $("#obsFormError");
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.innerHTML = "";
  }
}

async function submitObservation(formData) {
  try {
    await api("/api/observations", {
      method: "POST",
      body: JSON.stringify(formData)
    });
    $("#observationForm").reset();
    hideConfirmation();
    hideObsFormError();
    pendingFormData = null;
    await loadDashboard();
  } catch (error) {
    showObsFormError(error);
  }
}

$("#observationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const formData = Object.fromEntries(form);

  if (!formData.species || !formData.count || !formData.location || !formData.route) {
    return;
  }

  pendingFormData = formData;
  showConfirmation(formData);
});

$("#cancelConfirm").addEventListener("click", () => {
  hideConfirmation();
  hideObsFormError();
  pendingFormData = null;
});

$("#observationForm").addEventListener("input", () => {
  hideObsFormError();
});

$("#confirmSubmit").addEventListener("click", () => {
  if (pendingFormData) {
    submitObservation(pendingFormData);
  }
});

loadDashboard().catch(() => {
  $("#loginMsg").textContent = "请先登录查看监管数据。";
});
