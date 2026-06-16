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
  return `
    <article class="list-item">
      <strong>${station.name}</strong>
      <p>
        <span class="tag ${station.status}">${station.status}</span>
        ${station.temperature}°C · 湿度 ${station.humidity}% · 电量 ${station.battery}%
      </p>
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

let routeEventsBound = false;

async function loadDashboard() {
  if (!state.token) return;
  const [overview, alerts, observations] = await Promise.all([
    api("/api/overview"),
    api("/api/alerts"),
    api("/api/observations")
  ]);

  state.allRoutes = overview.routes;
  $("#metrics").innerHTML = overview.metrics.map(renderMetric).join("");
  populateFilterOptions();
  bindFilterEvents();
  if (!routeEventsBound) {
    bindRouteClickEvents();
    routeEventsBound = true;
  }
  applyFilters();
  $("#alerts").innerHTML = alerts.alerts.map(renderAlert).join("");
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

$("#observationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/observations", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    event.currentTarget.reset();
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  }
});

loadDashboard().catch(() => {
  $("#loginMsg").textContent = "请先登录查看监管数据。";
});
