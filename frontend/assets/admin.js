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

function renderAlert(alert) {
  return `
    <article class="admin-row">
      <div>
        <strong>${alert.title}</strong>
        <p>${alert.area} · ${alert.level}风险 · ${alert.status} · ${fmtTime(alert.createdAt)}</p>
      </div>
      <select data-alert="${alert.id}">
        <option value="open" ${alert.status === "open" ? "selected" : ""}>待处理</option>
        <option value="processing" ${alert.status === "processing" ? "selected" : ""}>处理中</option>
        <option value="resolved" ${alert.status === "resolved" ? "selected" : ""}>已闭环</option>
      </select>
    </article>
  `;
}

function renderStation(station) {
  return `
    <article class="admin-row">
      <div>
        <strong>${station.name}</strong>
        <p>${station.status} · 温度 ${station.temperature}°C · 湿度 ${station.humidity}%</p>
      </div>
      <span class="tag ${station.status}">电量 ${station.battery}%</span>
    </article>
  `;
}

async function loadAdmin() {
  if (!state.token) return;
  const [alerts, stations] = await Promise.all([
    api("/api/alerts"),
    api("/api/admin/stations")
  ]);
  $("#alerts").innerHTML = alerts.alerts.map(renderAlert).join("");
  $("#stations").innerHTML = stations.stations.map(renderStation).join("");
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
    $("#loginMsg").textContent = `${result.user.name}，后台已进入。`;
    await loadAdmin();
  } catch (error) {
    $("#loginMsg").textContent = error.message;
  }
});

$("#alerts").addEventListener("change", async (event) => {
  const id = event.target.dataset.alert;
  if (!id) return;
  await api(`/api/admin/alerts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: event.target.value })
  });
  await loadAdmin();
});

$("#broadcastForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/admin/broadcasts", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    event.currentTarget.reset();
    alert("监管通知已发布。");
  } catch (error) {
    alert(error.message);
  }
});

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("mb_token");
  localStorage.removeItem("mb_user");
  location.reload();
});

loadAdmin().catch(() => {
  $("#loginMsg").textContent = "请使用管理员或巡护员账号登录。";
});
