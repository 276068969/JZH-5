const state = {
  token: localStorage.getItem("mb_token"),
  user: JSON.parse(localStorage.getItem("mb_user") || "null"),
  expiresAt: Number(localStorage.getItem("mb_expires_at") || 0),
  expandedAlerts: new Set(),
  expandedStations: new Set(),
  stationDetails: {},
  alertFilters: {
    status: "all",
    level: "all",
    area: "all"
  },
  allAlerts: [],
  allSpecies: [],
  allRoutes: [],
  broadcasts: [],
  broadcastsLoaded: false,
  lastPublishedId: null,
  editingSpeciesId: null,
  savingAlerts: new Set(),
  alertSaveStatus: {}
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

function renderBroadcast(broadcast) {
  const isNew = broadcast.id === state.lastPublishedId;
  return `
    <article class="broadcast-item ${isNew ? "new" : ""}" data-broadcast-id="${broadcast.id}">
      <div class="broadcast-header">
        <strong class="broadcast-title">${broadcast.title}</strong>
        ${isNew ? '<span class="broadcast-badge">刚发布</span>' : ''}
      </div>
      <p class="broadcast-content">${broadcast.content}</p>
      <p class="broadcast-meta">
        <span class="broadcast-publisher">发布人：${broadcast.publisher}</span>
        <span class="broadcast-time">${fmtTime(broadcast.createdAt)}</span>
      </p>
    </article>
  `;
}

function renderBroadcastList() {
  const container = $("#broadcastList");
  const panel = $("#broadcastListPanel");
  const countEl = $("#broadcastCount");
  if (!container || !panel) return;

  if (state.broadcasts.length === 0) {
    panel.hidden = false;
    countEl.textContent = "0 条";
    container.innerHTML = '<p class="empty-hint">暂无已发布通知，提交后将在此回显。</p>';
    return;
  }

  panel.hidden = false;
  countEl.textContent = `${state.broadcasts.length} 条`;
  container.innerHTML = state.broadcasts.map(renderBroadcast).join("");
}

async function loadBroadcasts() {
  if (!state.token || state.user?.role !== "admin") return;
  try {
    const result = await api("/api/admin/broadcasts");
    state.broadcasts = result.broadcasts || [];
    renderBroadcastList();
  } catch (error) {
    console.error("Failed to load broadcasts:", error);
  }
}

function showBroadcastFeedback(message, type = "success") {
  const feedback = $("#broadcastFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `form-feedback ${type}`;
  feedback.hidden = false;
  clearTimeout(showBroadcastFeedback._timer);
  showBroadcastFeedback._timer = setTimeout(() => {
    feedback.hidden = true;
    feedback.textContent = "";
  }, 3500);
}

function renderSpecies(species) {
  const isEditing = state.editingSpeciesId === species.id;
  const levelClass = protectionLevelClass(species.protectionLevel);

  return `
    <article class="admin-row species-row" data-species-id="${species.id}">
      <div class="species-main">
        <div class="species-header">
          <strong>${species.name}</strong>
          <span class="tag ${levelClass}">${protectionLevelLabel(species.protectionLevel)}</span>
        </div>
        <p class="species-meta">
          常见路线：${species.commonRoutes.join("、")}
          ${species.remarks ? ` · ${species.remarks.length > 60 ? species.remarks.slice(0, 60) + "…" : species.remarks}` : ""}
        </p>
        <p class="species-meta">
          创建于 ${fmtTime(species.createdAt)} · 最后更新 ${fmtTime(species.updatedAt)}
        </p>
      </div>
      <div class="species-actions">
        <button class="secondary-btn species-edit-btn" data-edit="${species.id}" ${state.user?.role !== "admin" ? "disabled" : ""}>
          编辑
        </button>
        <button class="secondary-btn species-delete-btn" data-delete="${species.id}" ${state.user?.role !== "admin" ? "disabled" : ""}>
          删除
        </button>
      </div>
    </article>
  `;
}

function renderSpeciesList() {
  const container = $("#speciesList");
  if (!container) return;

  if (state.allSpecies.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center;">暂无重点物种，请先添加</p>';
    return;
  }

  container.innerHTML = state.allSpecies
    .slice()
    .sort((a, b) => {
      const levelOrder = { "国家一级": 0, "国家二级": 1, "三有保护": 2, "无": 3 };
      return (levelOrder[a.protectionLevel] || 4) - (levelOrder[b.protectionLevel] || 4);
    })
    .map(renderSpecies)
    .join("");
}

function renderRouteCheckboxes() {
  const container = $("#routeCheckboxes");
  if (!container || state.allRoutes.length === 0) return;

  container.innerHTML = state.allRoutes.map(route => `
    <label class="checkbox-item">
      <input type="checkbox" name="commonRoutes" value="${route.name}">
      <span>${route.name}</span>
    </label>
  `).join("");
}

function populateSpeciesForm(species) {
  const form = $("#speciesForm");
  if (!form) return;

  form.name.value = species.name;
  form.protectionLevel.value = species.protectionLevel;
  form.remarks.value = species.remarks || "";

  form.querySelectorAll('input[name="commonRoutes"]').forEach(checkbox => {
    checkbox.checked = species.commonRoutes.includes(checkbox.value);
  });

  state.editingSpeciesId = species.id;
  $("#speciesSubmitBtn").textContent = "更新物种";
  $("#speciesCancelBtn").hidden = false;
}

function resetSpeciesForm() {
  const form = $("#speciesForm");
  if (!form) return;

  form.reset();
  form.querySelectorAll('input[name="commonRoutes"]').forEach(checkbox => {
    checkbox.checked = false;
  });

  state.editingSpeciesId = null;
  $("#speciesSubmitBtn").textContent = "新增物种";
  $("#speciesCancelBtn").hidden = true;
  hideSpeciesFormError();
}

function showSpeciesFormError(error) {
  const errorBox = $("#speciesFormError");
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

function hideSpeciesFormError() {
  const errorBox = $("#speciesFormError");
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.innerHTML = "";
  }
}

async function loadSpeciesAndRoutes() {
  if (!state.token) return;

  try {
    const [speciesData, migrationsData] = await Promise.all([
      api("/api/species"),
      api("/api/migrations")
    ]);

    state.allSpecies = speciesData.speciesList;
    state.allRoutes = migrationsData.routes;

    renderRouteCheckboxes();
    renderSpeciesList();
  } catch (error) {
    console.error("Failed to load species data:", error);
  }
}

async function handleSpeciesSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);

  const name = String(formData.get("name") || "").trim();
  const protectionLevel = String(formData.get("protectionLevel") || "").trim();
  const commonRoutes = formData.getAll("commonRoutes").map(r => String(r).trim()).filter(Boolean);
  const remarks = String(formData.get("remarks") || "").trim();

  const payload = { name, protectionLevel, commonRoutes, remarks };

  try {
    if (state.editingSpeciesId) {
      await api(`/api/admin/species/${encodeURIComponent(state.editingSpeciesId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      alert("物种信息已更新。");
    } else {
      await api("/api/admin/species", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      alert("物种已添加。");
    }

    resetSpeciesForm();
    await loadSpeciesAndRoutes();
  } catch (error) {
    showSpeciesFormError(error);
  }
}

async function handleSpeciesEdit(event) {
  const speciesId = event.target.dataset.edit;
  if (!speciesId) return;

  event.preventDefault();

  try {
    const result = await api(`/api/admin/species/${encodeURIComponent(speciesId)}`);
    populateSpeciesForm(result.species);
    document.querySelector(".species-form").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    alert(error.message);
  }
}

async function handleSpeciesDelete(event) {
  const speciesId = event.target.dataset.delete;
  if (!speciesId) return;

  event.preventDefault();

  const species = state.allSpecies.find(s => s.id === speciesId);
  if (!species) return;

  if (!confirm(`确定要删除物种「${species.name}」吗？此操作不可恢复。`)) {
    return;
  }

  try {
    await api(`/api/admin/species/${encodeURIComponent(speciesId)}`, {
      method: "DELETE"
    });

    if (state.editingSpeciesId === speciesId) {
      resetSpeciesForm();
    }

    await loadSpeciesAndRoutes();
    alert("物种已删除。");
  } catch (error) {
    alert(error.message);
  }
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
  const isSaving = state.savingAlerts.has(alert.id);
  const saveStatus = state.alertSaveStatus[alert.id];

  let statusFeedback = "";
  if (isSaving) {
    statusFeedback = '<span class="status-feedback saving"><span class="spinner"></span>保存中...</span>';
  } else if (saveStatus === "success") {
    statusFeedback = '<span class="status-feedback success">✓ 保存成功</span>';
  } else if (saveStatus === "error") {
    statusFeedback = '<span class="status-feedback error">✗ 保存失败，请重试</span>';
  }

  return `
    <article class="admin-row alert-row ${isSaving ? "saving" : ""}" data-alert-id="${alert.id}">
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
        <div class="alert-status-bar">
          <button class="toggle-history-btn" data-toggle="${alert.id}">
            ${isExpanded ? "收起处置详情 ▲" : "展开处置详情 ▼"}
          </button>
          ${statusFeedback}
        </div>
      </div>
      <div class="alert-actions">
        <select class="status-select" data-alert="${alert.id}" data-original="${alert.status}" ${isSaving ? "disabled" : ""}>
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
                ${isSaving ? "disabled" : ""}
              ></textarea>
              <div class="disposal-actions">
                <button class="submit-disposal-btn" data-submit="${alert.id}" ${isSaving ? "disabled" : ""}>
                  ${isSaving ? '<span class="spinner"></span>保存中...' : "提交处置记录"}
                </button>
              </div>
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
  currentViewAlerts = alerts.alerts;
  $("#alerts").innerHTML = alerts.alerts.length > 0
    ? alerts.alerts.map(renderAlert).join("")
    : '<p style="color:var(--muted);padding:20px;text-align:center;">暂无符合条件的告警事件</p>';
  $("#stations").innerHTML = stations.stations.map(renderStation).join("");

  await loadSpeciesAndRoutes();

  if (!state.broadcastsLoaded) {
    await loadBroadcasts();
    state.broadcastsLoaded = true;
  }
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
    $("#loginMsg").textContent = `${result.user.name}，后台已进入。`;
    await loadAdmin();
  } catch (error) {
    $("#loginMsg").textContent = error.message;
  }
});

async function saveAlertStatus(alertId, status, remark) {
  if (state.savingAlerts.has(alertId)) return;

  state.savingAlerts.add(alertId);
  state.alertSaveStatus[alertId] = "saving";

  const row = document.querySelector(`.alert-row[data-alert-id="${alertId}"]`);
  const select = row?.querySelector(".status-select");
  const textarea = row?.querySelector(".remark-input");
  const button = row?.querySelector(".submit-disposal-btn");
  const statusBar = row?.querySelector(".alert-status-bar");

  if (row) row.classList.add("saving");
  if (select) select.disabled = true;
  if (textarea) textarea.disabled = true;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>保存中...';
  }

  let feedbackEl = null;
  if (statusBar) {
    const existingFeedback = statusBar.querySelector(".status-feedback");
    if (existingFeedback) existingFeedback.remove();
    
    feedbackEl = document.createElement("span");
    feedbackEl.className = "status-feedback saving";
    feedbackEl.innerHTML = '<span class="spinner"></span>保存中...';
    statusBar.appendChild(feedbackEl);
  }

  try {
    const result = await api(`/api/admin/alerts/${encodeURIComponent(alertId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, remark })
    });

    const alertIndex = state.allAlerts.findIndex(a => a.id === alertId);
    if (alertIndex !== -1) {
      state.allAlerts[alertIndex] = result.alert;
    }

    updateAlertInView(result.alert);

    state.alertSaveStatus[alertId] = "success";

    if (feedbackEl) {
      feedbackEl.className = "status-feedback success";
      feedbackEl.innerHTML = "✓ 保存成功";
    }

    setTimeout(() => {
      delete state.alertSaveStatus[alertId];
      if (feedbackEl && feedbackEl.parentNode) {
        feedbackEl.remove();
      }
      if (row) row.classList.remove("saving");
      if (button) {
        button.disabled = false;
        button.innerHTML = "提交处置记录";
      }
      renderAlertRowWithData(result.alert, alertId);
      refreshAlertListAfterChange(alertId, status);
    }, 2000);

    return true;
  } catch (error) {
    state.alertSaveStatus[alertId] = "error";

    if (feedbackEl) {
      feedbackEl.className = "status-feedback error";
      feedbackEl.innerHTML = "✗ 保存失败，请重试";
    }

    setTimeout(() => {
      delete state.alertSaveStatus[alertId];
      if (feedbackEl && feedbackEl.parentNode) {
        feedbackEl.remove();
      }
      if (row) row.classList.remove("saving");
      if (select) select.disabled = false;
      if (textarea) textarea.disabled = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = "提交处置记录";
      }
    }, 3000);

    return false;
  } finally {
    state.savingAlerts.delete(alertId);
  }
}

let currentViewAlerts = [];

function updateAlertInView(updatedAlert) {
  const index = currentViewAlerts.findIndex(a => a.id === updatedAlert.id);
  if (index !== -1) {
    currentViewAlerts[index] = updatedAlert;
  }
}

function findAlertInView(alertId) {
  return currentViewAlerts.find(a => a.id === alertId) || 
         state.allAlerts.find(a => a.id === alertId);
}

function renderAlertRowWithData(alert, alertId) {
  const row = document.querySelector(`.alert-row[data-alert-id="${alertId}"]`);
  if (!row) return;

  const isExpanded = state.expandedAlerts.has(alertId);
  const isSaving = state.savingAlerts.has(alertId);
  const saveStatus = state.alertSaveStatus[alertId];

  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = renderAlert(alert);
  const newRow = tempDiv.firstElementChild;

  if (!isExpanded) {
    const detailPanel = newRow.querySelector(".alert-detail-panel");
    if (detailPanel) detailPanel.remove();
  }

  let statusFeedback = "";
  if (isSaving) {
    statusFeedback = '<span class="status-feedback saving"><span class="spinner"></span>保存中...</span>';
  } else if (saveStatus === "success") {
    statusFeedback = '<span class="status-feedback success">✓ 保存成功</span>';
  } else if (saveStatus === "error") {
    statusFeedback = '<span class="status-feedback error">✗ 保存失败，请重试</span>';
  }

  const statusBar = newRow.querySelector(".alert-status-bar");
  if (statusBar && statusFeedback) {
    statusBar.insertAdjacentHTML("beforeend", statusFeedback);
  }

  if (isSaving) {
    newRow.classList.add("saving");
    const select = newRow.querySelector(".status-select");
    const textarea = newRow.querySelector(".remark-input");
    const button = newRow.querySelector(".submit-disposal-btn");
    if (select) select.disabled = true;
    if (textarea) textarea.disabled = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span>保存中...';
    }
  }

  row.replaceWith(newRow);
}

function renderAlertRow(alertId) {
  const row = document.querySelector(`.alert-row[data-alert-id="${alertId}"]`);
  if (!row) return;

  const alert = state.allAlerts.find(a => a.id === alertId);
  if (!alert) return;

  const isExpanded = state.expandedAlerts.has(alertId);
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = renderAlert(alert);
  const newRow = tempDiv.firstElementChild;

  if (!isExpanded) {
    const detailPanel = newRow.querySelector(".alert-detail-panel");
    if (detailPanel) detailPanel.remove();
  }

  row.replaceWith(newRow);
}

async function refreshAlertListAfterChange(alertId, newStatus) {
  const { status: filterStatus } = state.alertFilters;
  
  if (filterStatus !== "all" && newStatus !== filterStatus) {
    setTimeout(async () => {
      if (state.alertSaveStatus[alertId] === "success") {
        const scrollPosition = window.scrollY;
        await loadAdmin();
        window.scrollTo(0, scrollPosition);
      }
    }, 2000);
  }
}

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
    const button = event.target.closest(".submit-disposal-btn");
    const select = document.querySelector(`.status-select[data-alert="${submitId}"]`);
    const textarea = document.querySelector(`.remark-input[data-remark="${submitId}"]`);
    const remark = textarea?.value.trim() || "";

    if (!remark && select?.value === select?.dataset.original) {
      alert("请选择状态变更或填写处置说明后再提交。");
      return;
    }

    await saveAlertWithFeedback(submitId, remark, button);
    return;
  }
});

async function saveAlertWithFeedback(alertId, remark, button) {
  if (state.savingAlerts.has(alertId)) return false;

  const row = document.querySelector(`.alert-row[data-alert-id="${alertId}"]`);
  const select = document.querySelector(`.status-select[data-alert="${alertId}"]`);
  const textarea = document.querySelector(`.remark-input[data-remark="${alertId}"]`);
  const statusBar = row?.querySelector(".alert-status-bar");
  const status = select?.value;

  if (!button) {
    button = row?.querySelector(".submit-disposal-btn");
  }

  state.savingAlerts.add(alertId);
  state.alertSaveStatus[alertId] = "saving";

  if (row) row.classList.add("saving");
  if (select) select.disabled = true;
  if (textarea) textarea.disabled = true;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>保存中...';
  }

  let feedbackEl = null;
  if (statusBar) {
    const existingFeedback = statusBar.querySelector(".status-feedback");
    if (existingFeedback) existingFeedback.remove();
    
    feedbackEl = document.createElement("span");
    feedbackEl.className = "status-feedback saving";
    feedbackEl.innerHTML = '<span class="spinner"></span>保存中...';
    statusBar.appendChild(feedbackEl);
  }

  try {
    const result = await api(`/api/admin/alerts/${encodeURIComponent(alertId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, remark })
    });

    const alertIndex = state.allAlerts.findIndex(a => a.id === alertId);
    if (alertIndex !== -1) {
      state.allAlerts[alertIndex] = result.alert;
    }

    updateAlertInView(result.alert);

    state.alertSaveStatus[alertId] = "success";

    if (feedbackEl) {
      feedbackEl.className = "status-feedback success";
      feedbackEl.innerHTML = "✓ 保存成功";
    }

    setTimeout(() => {
      delete state.alertSaveStatus[alertId];
      if (feedbackEl && feedbackEl.parentNode) {
        feedbackEl.remove();
      }
      if (row) row.classList.remove("saving");
      if (button) {
        button.disabled = false;
        button.innerHTML = "提交处置记录";
      }
      renderAlertRowWithData(result.alert, alertId);
      refreshAlertListAfterChange(alertId, status);
    }, 2000);

    if (select) select.dataset.original = status;
    if (textarea) textarea.value = "";

    return true;
  } catch (error) {
    state.alertSaveStatus[alertId] = "error";

    if (feedbackEl) {
      feedbackEl.className = "status-feedback error";
      feedbackEl.innerHTML = "✗ 保存失败，请重试";
    }

    setTimeout(() => {
      delete state.alertSaveStatus[alertId];
      if (feedbackEl && feedbackEl.parentNode) {
        feedbackEl.remove();
      }
      if (row) row.classList.remove("saving");
      if (select) select.disabled = false;
      if (textarea) textarea.disabled = false;
      if (button) {
        button.disabled = false;
        button.innerHTML = "提交处置记录";
      }
    }, 3000);

    return false;
  } finally {
    state.savingAlerts.delete(alertId);
  }
}

$("#alerts").addEventListener("change", async (event) => {
  const id = event.target.dataset.alert;
  if (!id || !event.target.classList.contains("status-select")) return;

  const select = event.target;
  const newStatus = select.value;
  const originalStatus = select.dataset.original;
  const textarea = document.querySelector(`.remark-input[data-remark="${id}"]`);
  const remark = textarea?.value.trim() || "";

  if (newStatus === originalStatus) {
    if (textarea && state.expandedAlerts.has(id)) {
      textarea.focus();
    }
    return;
  }

  const wasExpanded = state.expandedAlerts.has(id);
  if (!wasExpanded) {
    state.expandedAlerts.add(id);
  }

  const saveSuccess = await saveAlertWithFeedback(id, remark);
  
  if (saveSuccess && !wasExpanded) {
    setTimeout(() => {
      renderAlertRowWithData(findAlertInView(id), id);
    }, 2100);
  }
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
    const result = await api("/api/admin/broadcasts", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    event.currentTarget.reset();
    state.lastPublishedId = result.broadcast?.id || null;
    await loadBroadcasts();
    showBroadcastFeedback("监管通知已发布，已同步至通知列表与监测台。", "success");
    const newItem = document.querySelector(".broadcast-item.new");
    if (newItem) newItem.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    let msg = error.message;
    if (error.errors && error.errors.length > 0) {
      msg += "\n\n" + error.errors.join("\n");
    }
    alert(msg);
  }
});

$("#logoutBtn").addEventListener("click", () => {
  clearAuth();
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

const speciesForm = $("#speciesForm");
if (speciesForm) {
  speciesForm.addEventListener("submit", handleSpeciesSubmit);
  speciesForm.addEventListener("input", hideSpeciesFormError);
}

const speciesCancelBtn = $("#speciesCancelBtn");
if (speciesCancelBtn) {
  speciesCancelBtn.addEventListener("click", resetSpeciesForm);
}

const speciesList = $("#speciesList");
if (speciesList) {
  speciesList.addEventListener("click", (event) => {
    if (event.target.dataset.edit) {
      handleSpeciesEdit(event);
    } else if (event.target.dataset.delete) {
      handleSpeciesDelete(event);
    }
  });
}

loadAdmin().catch(() => {
  $("#loginMsg").textContent = "请使用管理员或巡护员账号登录。";
});
