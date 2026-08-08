// ================================================================
// 小朋友端首页: 任务列表 + 打卡
// ================================================================
let state = {
  session: null,
  profile: null,
  tasks: [],       // { id, name, emoji, points, daily_limit, done_today }
  todayStr: new Date().toISOString().slice(0, 10),
};

const $ = (id) => document.getElementById(id);

function toast(text, isError) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast show " + (isError ? "err" : "ok");
  setTimeout(() => el.classList.remove("show"), 2000);
}

async function loadTasks() {
  // 拉今日打卡 + 所有任务 (RLS 自动过滤到本家庭)
  const [tasksResp, checkinsResp] = await Promise.all([
    sb.from("tasks").select("*").eq("active", true).order("sort_order").order("id"),
    sb.from("check_ins").select("task_id").eq("day", state.todayStr),
  ]);
  if (tasksResp.error) { toast(tasksResp.error.message, true); return; }
  if (checkinsResp.error) { toast(checkinsResp.error.message, true); return; }

  const doneCount = {};
  for (const c of checkinsResp.data) {
    doneCount[c.task_id] = (doneCount[c.task_id] || 0) + 1;
  }
  state.tasks = tasksResp.data.map((t) => ({
    ...t,
    done_today: doneCount[t.id] || 0,
  }));
  renderTasks();
  await refreshStats();
}

async function refreshStats() {
  // 今日积分: 今日打卡 * 对应任务积分
  // 累计积分: 所有打卡 * 对应任务积分
  const [todayResp, totalResp] = await Promise.all([
    sb.from("check_ins").select("task_id, tasks!inner(points)").eq("day", state.todayStr),
    sb.from("check_ins").select("task_id, tasks!inner(points)"),
  ]);
  const sumPoints = (rows) => (rows || []).reduce((s, r) => s + (r.tasks?.points || 0), 0);
  $("todayPoints").textContent = sumPoints(todayResp.data) + " ⭐";
  $("totalPoints").textContent = sumPoints(totalResp.data) + " ⭐";
}

function renderTasks() {
  const list = $("taskList");
  if (state.tasks.length === 0) {
    list.innerHTML = '<div class="empty">还没有任务, 请家长在管理台添加</div>';
    return;
  }
  list.innerHTML = state.tasks.map((t) => {
    const remaining = t.daily_limit - t.done_today;
    const done = remaining <= 0;
    const stars = "⭐".repeat(t.done_today) + "☆".repeat(Math.max(0, t.daily_limit - t.done_today));
    return `
      <div class="task-card ${done ? "done" : ""}" data-id="${t.id}">
        <div class="task-emoji">${t.emoji}</div>
        <div class="task-info">
          <div class="task-name">${escapeHtml(t.name)}</div>
          <div class="task-meta">
            <span class="points">+${t.points} ⭐</span>
            <span class="progress">${stars}</span>
            ${t.timer_minutes > 0 ? `<span class="timer">⏱ ${t.timer_minutes}min</span>` : ""}
          </div>
        </div>
        <button class="btn-checkin" ${done ? "disabled" : ""} data-id="${t.id}">
          ${done ? "✓ 已完成" : "打卡"}
        </button>
      </div>
    `;
  }).join("");

  // 绑定打卡按钮
  list.querySelectorAll(".btn-checkin").forEach((btn) => {
    btn.onclick = () => onCheckin(parseInt(btn.dataset.id, 10));
  });
}

async function onCheckin(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.done_today >= task.daily_limit) {
    toast("今天已经完成啦", true);
    return;
  }
  const { error } = await sb.from("check_ins").insert({
    task_id: taskId,
    family_id: state.profile.family_id,
    day: state.todayStr,
  });
  if (error) {
    toast(error.message, true);
    return;
  }
  task.done_today += 1;
  toast(`${task.emoji} +${task.points} ⭐`, false);
  renderTasks();
  refreshStats();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function main() {
  const auth = await Auth.requireAuth();
  if (!auth) return;
  state.session = auth.session;
  state.profile = auth.profile;
  $("userName").textContent = auth.profile.display_name || auth.session.user.email;
  $("roleTag").textContent = auth.profile.role === "parent" ? "家长" : "小朋友";
  $("roleTag").classList.add(auth.profile.role);
  $("logoutBtn").onclick = () => Auth.signOut();
  await loadTasks();
}

main();
