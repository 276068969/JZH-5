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
    <article class="list-item" data-route-id="${route.id}">
      <strong>${route.name}</strong>
      <p>
        <span class="tag ${riskClass(route.risk)}">${route.risk.toUpperCase()}</span>
        ${route.season} · 当前 ${route.currentArea} · 重点鸟种 ${route.species.join("、")}
      </p>
      <div class="progress"><i style="width:${route.progress}%"></i></div>
    </article>
  `;
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

function renderAlert(alert) {
  return `
    <article class="list-item">
      <strong>${alert.title}</strong>
      <p>
        <span class="tag ${alert.status}">${alert.status}</span>
        <span class="tag ${alert.level === "高" ? "high" : alert.level === "中" ? "medium" : "low"}">${alert.level}风险</span>
        ${alert.area} · ${fmtTime(alert.createdAt)}
      </p>
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
