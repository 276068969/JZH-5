const state = {
  token: localStorage.getItem("mb_token"),
  user: JSON.parse(localStorage.getItem("mb_user") || "null")
};

const $ = (selector) => document.querySelector(selector);

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
    <article class="list-item">
      <strong>${route.name}</strong>
      <p>
        <span class="tag ${riskClass(route.risk)}">${route.risk.toUpperCase()}</span>
        ${route.season} · 当前 ${route.currentArea} · 重点鸟种 ${route.species.join("、")}
      </p>
      <div class="progress"><i style="width:${route.progress}%"></i></div>
    </article>
  `;
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

  $("#metrics").innerHTML = overview.metrics.map(renderMetric).join("");
  $("#routeCount").textContent = `${overview.routes.length} 条路线`;
  $("#routes").innerHTML = overview.routes.map(renderRoute).join("");
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
