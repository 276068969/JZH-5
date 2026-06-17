const state = {
  token: localStorage.getItem("mb_token"),
  user: JSON.parse(localStorage.getItem("mb_user") || "null"),
  expandedAlerts: new Set(),
  expandedStations: new Set(),
  stationDetails: {},
  alertFilters: {
    status: "all",
    level: "all",
    area: "all"
  },
  allAlerts: []
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
  if (!response.ok) {
    const error = new Error(data.message || "请求失败");
    error.errors = data.errors;
    throw error;
  }
  return data;
}

function fmtTime(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status) {
  return { open: "待处理", processing: "处理中", resolved: "已闭环" }[status] || status;
}

function stationStatusLabel(status) {
  return { online: "在线", warning: "告警", offline: "离线" }[status] || status;
}

function batteryLevel(battery) {
  if (battery === null || battery === undefined) return { level: "unknown", text: "未知" };
  if (battery < 20) return { level: "critical", text: "严重低电量" };
  if (battery < 40) return { level: "low", text: "低电量" };
  if (battery < 70) return { level: "medium", text: "中等" };
  return { level: "good", text: "充足" };
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

function renderStationDetail(station) {
  const battery = batteryLevel(station.battery);
  return `
    <div class="station-detail-panel">
      <div class="detail-highlight">
        <div class="highlight-card risk-${station.status}">
          <span class="highlight-label">运行状态</span>
          <div class="highlight-value">
            <span class="risk-badge ${station.status}">${stationStatusLabel(station.status)}</span>
          </div>
        </div>
        <div class="highlight-card battery-${battery.level}">
          <span class="highlight-label">电池状态</span>
          <div class="highlight-value">
            ${station.battery !== null ? `${station.battery}% · ${battery.text}` : "数据缺失"}
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h4>环境指标</h4>
        <div class="env-metrics">
          <div class="env-item">
            <span class="env-label">温度</span>
            <span class="env-value">${station.temperature !== null ? `${station.temperature}°C` : "—"}</span>
          </div>
          <div class="env-item">
            <span class="env-label">湿度</span>
            <span class="env-value">${station.humidity !== null ? `${station.humidity}%` : "—"}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h4>基本信息</h4>
        <div class="detail-item">
          <span class="detail-item-label">站点编号</span>
          <span class="detail-item-value route-id">${station.id}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">所在位置</span>
          <span class="detail-item-value">${station.location || "—"}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">安装时间</span>
          <span class="detail-item-value">${station.installedAt ? fmtTime(station.installedAt).split(" ")[0] : "—"}</span>
        </div>
        <div class="detail-item">
          <span class="detail-item-label">最后上报</span>
          <span class="detail-item-value">${station.lastReportedAt ? fmtTime(station.lastReportedAt) : "—"}</span>
        </div>
      </div>

      ${station.equipment && station.equipment.length > 0 ? `
        <div class="detail-section">
          <h4>搭载设备</h4>
          <div class="species-tags">
            ${station.equipment.map(e => `<span class="species-tag">${e}</span>`).join("")}
          </div>
        </div>
      ` : ""}

      ${station.abnormalReason ? `
        <div class="detail-section">
          <h4>异常原因</h4>
          <div class="abnormal-reason">
            <span class="warning-icon">⚠️</span>
            <p>${station.abnormalReason}</p>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderStation(station) {
  const isExpanded = state.expandedStations.has(station.id);
  const detail = state.stationDetails[station.id];
  const battery = batteryLevel(station.battery);

  return `
    <article class="admin-row station-row" data-station-id="${station.id}">
      <div class="station-main">
        <div class="station-header">
          <strong>${station.name}</strong>
          <span class="tag ${station.status}">${stationStatusLabel(station.status)}</span>
        </div>
        <p class="station-meta">
          ${station.location || "位置未设置"} · 最后上报 ${station.lastReportedAt ? fmtTime(station.lastReportedAt) : "—"}
        </p>
        <div class="station-summary">
          <div class="summary-item">
            <span class="summary-label">温度</span>
            <span class="summary-value">${station.temperature !== null ? `${station.temperature}°C` : "—"}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">湿度</span>
            <span class="summary-value">${station.humidity !== null ? `${station.humidity}%` : "—"}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">电量</span>
            <span class="summary-value battery-${battery.level}">${station.battery !== null ? `${station.battery}%` : "—"}</span>
          </div>
        </div>
        ${station.abnormalReason ? `
          <div class="abnormal-banner">
            <span class="warning-icon">⚠️</span>
            <span>${station.abnormalReason.length > 60 ? station.abnormalReason.slice(0, 60) + "…" : station.abnormalReason}</span>
          </div>
        ` : ""}
        <button class="toggle-history-btn" data-toggle-station="${station.id}">
          ${isExpanded ? "收起健康档案 ▲" : "查看健康档案 ▼"}
        </button>
      </div>
      <div class="station-actions">
        <span class="tag battery-tag battery-${battery.level}">${station.battery !== null ? `${station.battery}%` : "—"}</span>
      </div>
      ${isExpanded && detail ? `
        ${renderStationDetail(detail)}
      ` : isExpanded ? `
        <div class="station-detail-panel">
          <p style="color: var(--muted); text-align: center; padding: 20px;">加载中...</p>
        </div>
      ` : ""}
    </article>
  `;
}

function buildAlertQueryString() {
  const params = new URLSearchParams();
  if (state.alertFilters.status !== "all") {
    params.set("status", state.alertFilters.status);
  }
  if (state.alertFilters.level !== "all") {
    params.set("level", state.alertFilters.level);
  }
  if (state.alertFilters.area !== "all") {
    params.set("area", state.alertFilters.area);
  }
  const qs = params.toString();
  return qs ? `/api/alerts?${qs}` : "/api/alerts";
}

function populateAreaOptions() {
  const areaSelect = $("#filterArea");
  if (!areaSelect) return;
  const areas = [...new Set(state.allAlerts.map((a) => a.area))].sort();
  const currentValue = areaSelect.value;
  areaSelect.innerHTML = '<option value="all">全部区域</option>';
  areas.forEach((area) => {
    const opt = document.createElement("option");
    opt.value = area;
    opt.textContent = area;
    areaSelect.appendChild(opt);
  });
  if (currentValue) {
    areaSelect.value = currentValue;
  }
}

async function loadAdmin() {
  if (!state.token) return;
  const [alerts, stations] = await Promise.all([
    api(buildAlertQueryString()),
    api("/api/admin/stations")
  ]);
  if (state.allAlerts.length === 0) {
    const allAlertsResult = await api("/api/alerts");
    state.allAlerts = allAlertsResult.alerts;
    populateAreaOptions();
  }
  $("#alerts").innerHTML = alerts.alerts.length > 0
    ? alerts.alerts.map(renderAlert).join("")
    : '<p style="color:var(--muted);padding:20px;text-align:center;">暂无符合条件的告警事件</p>';
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

$("#stations").addEventListener("click", async (event) => {
  const toggleId = event.target.dataset.toggleStation;
  if (!toggleId) return;

  event.preventDefault();
  if (state.expandedStations.has(toggleId)) {
    state.expandedStations.delete(toggleId);
    await loadAdmin();
    return;
  }

  state.expandedStations.add(toggleId);
  if (!state.stationDetails[toggleId]) {
    try {
      const result = await api(`/api/admin/stations/${encodeURIComponent(toggleId)}`);
      state.stationDetails[toggleId] = result.station;
    } catch (error) {
      alert(error.message);
      state.expandedStations.delete(toggleId);
      return;
    }
  }
  await loadAdmin();
});

$("#broadcastForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get("title") || "").trim();
  const content = String(form.get("content") || "").trim();
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
    alert("监管通知发布失败，请检查以下问题：\n\n" + errors.join("\n"));
    return;
  }
  try {
    await api("/api/admin/broadcasts", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    event.currentTarget.reset();
    alert("监管通知已发布。");
  } catch (error) {
    let msg = error.message;
    if (error.errors && error.errors.length > 0) {
      msg += "\n\n" + error.errors.join("\n");
    }
    alert(msg);
  }
});

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("mb_token");
  localStorage.removeItem("mb_user");
  location.reload();
});

document.querySelectorAll("#alertFilters .filter-chips").forEach((chipGroup) => {
  chipGroup.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const filterType = chipGroup.dataset.filter;
    const value = chip.dataset.value;
    chipGroup.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.alertFilters[filterType] = value;
    loadAdmin();
  });
});

const filterArea = $("#filterArea");
if (filterArea) {
  filterArea.addEventListener("change", (event) => {
    state.alertFilters.area = event.target.value;
    loadAdmin();
  });
}

const resetAlertFilters = $("#resetAlertFilters");
if (resetAlertFilters) {
  resetAlertFilters.addEventListener("click", () => {
    state.alertFilters = { status: "all", level: "all", area: "all" };
    document.querySelectorAll("#alertFilters .filter-chips").forEach((chipGroup) => {
      chipGroup.querySelectorAll(".chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.value === "all");
      });
    });
    if (filterArea) {
      filterArea.value = "all";
    }
    loadAdmin();
  });
}

loadAdmin().catch(() => {
  $("#loginMsg").textContent = "请使用管理员或巡护员账号登录。";
});
