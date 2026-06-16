const state = {
  token: localStorage.getItem("mb_token"),
  user: JSON.parse(localStorage.getItem("mb_user") || "null"),
  expandedAlerts: new Set()
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

function statusLabel(status) {
  return { open: "待处理", processing: "处理中", resolved: "已闭环" }[status] || status;
}

function renderHistory(history = []) {
  if (!history.length) return "";
  const items = [...history].reverse().map((entry, idx) => `
    <div class="history-item">
      <div class="history-dot"></div>
      <div class="history-content">
        <div class="history-meta">
          <span class="tag ${entry.status}">${statusLabel(entry.status)}</span>
          <span class="history-handler">${entry.handler}</span>
          <span class="history-time">${fmtTime(entry.timestamp)}</span>
        </div>
        <p class="history-remark">${entry.remark || "无备注"}</p>
      </div>
    </div>
  `).join("");
  return `<div class="history-timeline">${items}</div>`;
}

function renderAlert(alert) {
  const isExpanded = state.expandedAlerts.has(alert.id);
  const latestRemark = alert.remark || "暂无处置说明";
  const latestHandler = alert.handler || "未分配";
  const latestUpdate = alert.updatedAt ? fmtTime(alert.updatedAt) : "-";

  return `
    <article class="admin-row alert-row" data-alert-id="${alert.id}">
      <div class="alert-main">
        <div class="alert-header">
          <strong>${alert.title}</strong>
          <span class="tag ${alert.level === "高" ? "high" : alert.level === "中" ? "medium" : "low"}">${alert.level}风险</span>
        </div>
        <p class="alert-meta">${alert.area} · 创建于 ${fmtTime(alert.createdAt)}</p>
        <div class="alert-summary">
          <div class="summary-item">
            <span class="summary-label">当前状态</span>
            <span class="tag ${alert.status}">${statusLabel(alert.status)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">处理人</span>
            <span class="summary-value">${latestHandler}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">更新时间</span>
            <span class="summary-value">${latestUpdate}</span>
          </div>
        </div>
        <div class="alert-latest-remark">
          <span class="remark-label">最新处置：</span>
          <span class="remark-text">${latestRemark}</span>
        </div>
        <button class="toggle-history-btn" data-toggle="${alert.id}">
          ${isExpanded ? "收起处置详情 ▲" : "展开处置详情 ▼"}
        </button>
      </div>
      <div class="alert-actions">
        <select class="status-select" data-alert="${alert.id}" data-original="${alert.status}">
          <option value="open" ${alert.status === "open" ? "selected" : ""}>待处理</option>
          <option value="processing" ${alert.status === "processing" ? "selected" : ""}>处理中</option>
          <option value="resolved" ${alert.status === "resolved" ? "selected" : ""}>已闭环</option>
        </select>
      </div>
      ${isExpanded ? `
        <div class="alert-detail-panel">
          <div class="detail-section">
            <h4>处置更新</h4>
            <div class="disposal-form">
              <textarea 
                class="remark-input" 
                data-remark="${alert.id}" 
                rows="3" 
                placeholder="请输入处置说明（可选，如现场情况、已采取措施、后续计划等）"
              ></textarea>
              <button class="submit-disposal-btn" data-submit="${alert.id}">提交处置记录</button>
            </div>
          </div>
          <div class="detail-section">
            <h4>处置历史追踪</h4>
            ${renderHistory(alert.history)}
          </div>
        </div>
      ` : ""}
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

$("#alerts").addEventListener("click", async (event) => {
  const toggleId = event.target.dataset.toggle;
  const submitId = event.target.dataset.submit;

  if (toggleId) {
    event.preventDefault();
    if (state.expandedAlerts.has(toggleId)) {
      state.expandedAlerts.delete(toggleId);
    } else {
      state.expandedAlerts.add(toggleId);
    }
    await loadAdmin();
    return;
  }

  if (submitId) {
    event.preventDefault();
    const select = document.querySelector(`.status-select[data-alert="${submitId}"]`);
    const textarea = document.querySelector(`.remark-input[data-remark="${submitId}"]`);
    const status = select.value;
    const remark = textarea.value.trim();

    if (!remark && select.value === select.dataset.original) {
      alert("请选择状态变更或填写处置说明后再提交。");
      return;
    }

    try {
      await api(`/api/admin/alerts/${encodeURIComponent(submitId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status, remark })
      });
      select.dataset.original = status;
      textarea.value = "";
      await loadAdmin();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
});

$("#alerts").addEventListener("change", async (event) => {
  const id = event.target.dataset.alert;
  if (!id || !event.target.classList.contains("status-select")) return;

  const textarea = document.querySelector(`.remark-input[data-remark="${id}"]`);
  if (textarea && state.expandedAlerts.has(id)) {
    textarea.focus();
    return;
  }

  state.expandedAlerts.add(id);
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
