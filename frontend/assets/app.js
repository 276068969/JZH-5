const state = {
  token: localStorage.getItem("mb_token"),
  user: JSON.parse(localStorage.getItem("mb_user") || "null"),
  allRoutes: [],
  filters: {
    risk: "all",
    season: "all",
    currentArea: "all"
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "请求失败");
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
      <span>${metric.label}</span>
      <strong>${metric.latest}${metric.unit}</strong>
      <em>${sign}${metric.delta}${metric.unit} 较上一周期</em>
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
  return `
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

  return `
    <article class="list-item alert-list-item">
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

let routeEventsBound = false;

async function loadDashboard() {
  if (!state.token) return;
  const [overview, alerts, observations, health] = await Promise.all([
    api("/api/overview"),
    api("/api/alerts"),
    api("/api/observations"),
    api("/api/stations/health")
  ]);

  state.allRoutes = overview.routes;
  $("#metrics").innerHTML = overview.metrics.map(renderMetric).join("");
  populateFilterOptions();
  populateRouteSelect();
  bindFilterEvents();
  if (!routeEventsBound) {
    bindRouteClickEvents();
    routeEventsBound = true;
  }
  applyFilters();
  $("#alerts").innerHTML = alerts.alerts.map(renderAlert).join("");
  $("#healthSummary").innerHTML = renderHealthSummary(health.summary);
  $("#stations").innerHTML = overview.stations.map(renderStation).join("");
  $("#observations").innerHTML = observations.observations.map(renderObservation).join("");
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
    localStorage.setItem("mb_token", result.token);
    localStorage.setItem("mb_user", JSON.stringify(result.user));
    $("#loginMsg").textContent = `${result.user.name}，欢迎回来。`;
    await loadDashboard();
  } catch (error) {
    $("#loginMsg").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("mb_token");
  localStorage.removeItem("mb_user");
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

async function submitObservation(formData) {
  try {
    await api("/api/observations", {
      method: "POST",
      body: JSON.stringify(formData)
    });
    $("#observationForm").reset();
    hideConfirmation();
    pendingFormData = null;
    await loadDashboard();
  } catch (error) {
    alert(error.message);
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
  pendingFormData = null;
});

$("#confirmSubmit").addEventListener("click", () => {
  if (pendingFormData) {
    submitObservation(pendingFormData);
  }
});

loadDashboard().catch(() => {
  $("#loginMsg").textContent = "请先登录查看监管数据。";
});
