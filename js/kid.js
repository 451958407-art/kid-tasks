// ================================================================
// 小朋友端首页: 任务 / 奖励 / 记录
// ================================================================
let state = {
  session: null,
  profile: null,
  tasks: [],
  rewards: [],
  todayCheckins: [],
  todayStr: localDateStr(new Date()),
  viewDate: null,  // 当前查看/操作的日期 (可能是今天以外)
  totalEarned: 0,
  totalUsed: 0,
};
state.viewDate = state.todayStr;

const $ = (id) => document.getElementById(id);

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDate(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateStr(dt);
}

function humanDate(dateStr) {
  const diff = dayDiff(state.todayStr, dateStr);
  if (diff === 0) return "今天";
  if (diff === -1) return "昨天";
  if (diff === 1) return "明天";
  if (diff === -2) return "前天";
  return diff < 0 ? `${-diff} 天前` : `${diff} 天后`;
}

function dayDiff(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, am - 1, ad);
  const db = new Date(by, bm - 1, bd);
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

function weekdayCn(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return "日一二三四五六"[new Date(y, m - 1, d).getDay()];
}

function toast(text, isError) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast show " + (isError ? "err" : "ok");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ==================== 数据加载 ====================
async function loadAll() {
  await loadTasks();
  await Promise.all([loadRewardsData(), refreshStats()]);
  await renderRewards();
}

async function loadTasks() {
  const [tasksResp, checkinsResp] = await Promise.all([
    sb.from("tasks").select("*").eq("active", true).order("sort_order").order("id"),
    sb.from("check_ins").select("id, task_id").eq("day", state.viewDate).order("id"),
  ]);
  if (tasksResp.error) { toast(tasksResp.error.message, true); return; }
  if (checkinsResp.error) { toast(checkinsResp.error.message, true); return; }

  state.todayCheckins = checkinsResp.data || [];
  const doneCount = {};
  const doneIds = {};
  for (const c of state.todayCheckins) {
    doneCount[c.task_id] = (doneCount[c.task_id] || 0) + 1;
    (doneIds[c.task_id] = doneIds[c.task_id] || []).push(c.id);
  }
  // 一次性任务: 只在有打卡记录的当天显示 (避免历史任务堆积)
  const viewCheckinTaskIds = new Set(state.todayCheckins.map((c) => c.task_id));
  const isToday = state.viewDate === state.todayStr;
  state.tasks = (tasksResp.data || [])
    .filter((t) => {
      if (!t.one_time) return true;
      // 一次性任务: 今天永远显示 (让家长可以补打); 过去只有当天打过卡的才显示
      if (isToday) return true;
      return viewCheckinTaskIds.has(t.id);
    })
    .map((t) => ({
      ...t,
      done_today: doneCount[t.id] || 0,
      checkin_ids: doneIds[t.id] || [],
    }));
  renderDateNav();
  renderTasks();
}

async function loadRewardsData() {
  const { data, error } = await sb.from("rewards").select("*").eq("active", true).order("sort_order").order("id");
  if (error) { toast(error.message, true); return; }
  state.rewards = data || [];
}

async function loadRewards() {
  await loadRewardsData();
  await renderRewards();
}

async function refreshStats() {
  const monthStart = state.todayStr.slice(0, 7) + "-01";
  const [earnedAllResp, earnedTodayResp, earnedMonthResp, usedResp] = await Promise.all([
    sb.from("check_ins").select("task_id, tasks!inner(points)"),
    sb.from("check_ins").select("task_id, tasks!inner(points)").eq("day", state.todayStr),
    sb.from("check_ins").select("task_id, tasks!inner(points)").gte("day", monthStart),
    sb.from("redemptions").select("points"),
  ]);
  const sumPoints = (rows) => (rows || []).reduce((s, r) => s + (r.tasks?.points || 0), 0);
  const sumRedeem = (rows) => (rows || []).reduce((s, r) => s + (r.points || 0), 0);
  const totalEarned = sumPoints(earnedAllResp.data);
  const todayEarned = sumPoints(earnedTodayResp.data);
  const monthEarned = sumPoints(earnedMonthResp.data);
  const used = sumRedeem(usedResp.data);
  state.totalEarned = totalEarned;
  state.totalUsed = used;
  $("todayPoints").textContent = todayEarned + " ⭐";
  $("totalPoints").textContent = totalEarned;
  $("monthPoints").textContent = monthEarned;
  $("usedPoints").textContent = used;
  $("availablePoints").textContent = (totalEarned - used) + " ⭐";
}

function available() { return state.totalEarned - state.totalUsed; }

// ==================== 日期切换 ====================
function initDateNav() {
  $("prevDay").onclick = () => switchViewDate(shiftDate(state.viewDate, -1));
  $("nextDay").onclick = () => {
    if (state.viewDate >= state.todayStr) { toast("已经到今天啦, 不能看未来", true); return; }
    switchViewDate(shiftDate(state.viewDate, 1));
  };
  $("backToday").onclick = () => switchViewDate(state.todayStr);
}

async function switchViewDate(dateStr) {
  state.viewDate = dateStr;
  await loadTasks();
}

function renderDateNav() {
  const d = state.viewDate;
  const label = humanDate(d);
  $("currentDateLabel").textContent = label + (label === "今天" ? " 🌞" : "");
  $("currentDateSub").textContent = `${d} 周${weekdayCn(d)}`;
  $("backToday").style.display = d === state.todayStr ? "none" : "inline-block";
  $("nextDay").disabled = d >= state.todayStr;
  $("nextDay").style.opacity = d >= state.todayStr ? "0.35" : "1";
}

// ==================== 任务渲染 ====================
// 互斥任务组: 同组内只能打卡其中一个 (家长引导 + 前端强制)
const EXCLUSIVE_GROUPS = [
  { name: "早睡", match: (t) => /前睡觉|点前睡/.test(t.name) },
];

function getExclusiveBlocker(task) {
  for (const g of EXCLUSIVE_GROUPS) {
    if (!g.match(task)) continue;
    const other = state.tasks.find((x) => x.id !== task.id && g.match(x) && x.done_today > 0);
    if (other) return other;
  }
  return null;
}

function renderTasks() {
  const list = $("taskList");
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty">还没有任务, 请家长在管理台添加</div>';
    return;
  }
  const isFuture = state.viewDate > state.todayStr;
  const isPast = state.viewDate < state.todayStr;
  list.innerHTML = state.tasks.map((t) => {
    const done = t.done_today > 0;
    const full = t.done_today >= t.daily_limit;
    const blocker = getExclusiveBlocker(t);
    const blocked = !done && !!blocker;
    const stars = "⭐".repeat(t.done_today) + "☆".repeat(Math.max(0, t.daily_limit - t.done_today));
    const btnLabel = blocked ? `已选${blocker.emoji}`
                    : (isPast ? "补打卡" : "打卡");
    const canCheckin = !full && !isFuture && !blocked;

    // 右侧动作区:
    //   打满 -> 绿色徽章"✓ 已完成" + 取消链接
    //   打过但未满 -> 打卡按钮 + 取消链接 (多次任务)
    //   未打卡 -> 打卡按钮
    let actions = "";
    if (full) {
      actions = `
        <div class="task-done-area">
          <span class="done-badge">✓ 已完成</span>
          <button class="undo-link" data-id="${t.id}">取消 1 次</button>
        </div>
      `;
    } else {
      const undoBtn = done ? `<button class="undo-link" data-id="${t.id}">取消 1 次</button>` : "";
      actions = `
        <div class="task-action-col">
          <button class="btn-checkin ${canCheckin ? "" : "disabled"} ${isPast ? "past" : ""}" ${canCheckin ? "" : "disabled"} data-id="${t.id}">
            ${btnLabel}
          </button>
          ${undoBtn}
        </div>
      `;
    }

    return `
      <div class="task-card ${full ? "done" : ""} ${blocked ? "blocked" : ""}" data-id="${t.id}">
        <div class="task-emoji">
          ${t.emoji}
          ${full ? '<span class="task-check">✓</span>' : ""}
        </div>
        <div class="task-info">
          <div class="task-name">${escapeHtml(t.name)}</div>
          <div class="task-meta">
            <span class="points">+${t.points} ⭐</span>
            <span class="progress">${stars}</span>
            ${t.timer_minutes > 0 ? `<span class="timer">⏱ ${t.timer_minutes}min</span>` : ""}
          </div>
          ${blocked ? `<div class="blocked-hint">今天已选 ${blocker.emoji}${escapeHtml(blocker.name)}</div>` : ""}
        </div>
        ${actions}
      </div>
    `;
  }).join("");
  list.querySelectorAll(".btn-checkin").forEach((b) => {
    if (!b.disabled) b.onclick = () => onCheckin(parseInt(b.dataset.id, 10));
  });
  list.querySelectorAll(".undo-link").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); onUndoCheckin(parseInt(b.dataset.id, 10)); };
  });

  // 家长在今日视图追加"+ 自定义任务"入口
  const isParent = state.profile?.role === "parent";
  const isTodayView = state.viewDate === state.todayStr;
  if (isParent && isTodayView) {
    const addCard = document.createElement("div");
    addCard.className = "task-card add-custom-card";
    addCard.innerHTML = `
      <div class="task-emoji">➕</div>
      <div class="task-info">
        <div class="task-name">添加临时任务</div>
        <div class="task-meta"><span class="progress" style="color:#94a3b8">如: 做家务、帮妈妈拿快递</span></div>
      </div>
      <button class="btn-checkin" id="addCustomBtn">添加</button>
    `;
    list.appendChild(addCard);
    $("addCustomBtn").onclick = openCustomTaskModal;
  }
}

async function onCheckin(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (state.viewDate > state.todayStr) { toast("不能给未来的日期打卡哦", true); return; }
  if (task.done_today >= task.daily_limit) { toast("这一天已经完成啦", true); return; }
  const blocker = getExclusiveBlocker(task);
  if (blocker) { toast(`今天已选 ${blocker.emoji}${blocker.name}, 二者选一`, true); return; }
  const { data, error } = await sb.from("check_ins").insert({
    task_id: taskId,
    family_id: state.profile.family_id,
    day: state.viewDate,
  }).select().single();
  if (error) { toast(error.message, true); return; }
  task.done_today += 1;
  if (data && data.id) task.checkin_ids.push(data.id);
  const dayLabel = state.viewDate === state.todayStr ? "" : `(${humanDate(state.viewDate)}) `;
  toast(`${dayLabel}${task.emoji} +${task.points} ⭐`, false);
  renderTasks();
  refreshStats();
}

async function onUndoCheckin(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.done_today <= 0) return;
  if (!confirm(`确认取消一次「${task.name}」的打卡吗?`)) return;
  const cid = task.checkin_ids[task.checkin_ids.length - 1];
  const { error } = await sb.from("check_ins").delete().eq("id", cid);
  if (error) { toast(error.message, true); return; }
  task.done_today -= 1;
  task.checkin_ids.pop();
  toast(`已取消 ${task.emoji} (-${task.points} ⭐)`, false);
  renderTasks();
  refreshStats();
}

// ==================== 奖励渲染 ====================
async function renderRewards() {
  const list = $("rewardList");
  const isParent = state.profile.role === "parent";

  // 家长/小孩视图区分: 小孩只看不能兑换
  const notice = $("rewardsNotice");
  if (notice) {
    notice.style.display = isParent ? "none" : "block";
  }

  if (!state.rewards.length) {
    list.innerHTML = '<div class="empty">还没有奖励</div>';
    return;
  }

  const bal = available();

  // 拉今日各奖励兑换次数, 显示"今日已兑 X 次"
  const { data: todayRedeems } = await sb
    .from("redemptions")
    .select("reward_id, amount")
    .eq("day", state.todayStr);
  const todayByReward = {};
  (todayRedeems || []).forEach((r) => {
    if (!todayByReward[r.reward_id]) todayByReward[r.reward_id] = { count: 0, amount: 0 };
    todayByReward[r.reward_id].count += 1;
    todayByReward[r.reward_id].amount += r.amount || 1;
  });

  list.innerHTML = state.rewards.map((r) => {
    const isDirectStar = r.variable && r.cost === 1 && (r.unit === "⭐" || r.unit === "积分");
    const costLabel = isDirectStar
      ? `点击输入积分`
      : r.variable
        ? `${r.cost} ⭐ / ${escapeHtml(r.unit || "次")}`
        : `${r.cost} ⭐`;

    // 可变奖励(如零花钱)只要有 1 积分就能兑换; 固定奖励要够单价
    const minCost = r.variable ? 1 : r.cost;
    const notEnough = bal < minCost;
    const disabled = !isParent || notEnough;
    const btnLabel = !isParent ? "🔒 家长兑换"
                    : notEnough ? "积分不足"
                    : "兑换";
    const todayInfo = todayByReward[r.id];
    const todayLine = todayInfo
      ? `<div class="reward-today">今日已兑 ${todayInfo.count} 次 · 共 ${todayInfo.amount} ${r.unit || "次"}</div>`
      : "";

    return `
      <div class="reward-card ${isParent ? "" : "kid-view"} ${notEnough ? "not-enough" : ""}" data-id="${r.id}">
        <div class="reward-emoji">${r.emoji}</div>
        <div class="reward-info">
          <div class="reward-name">${escapeHtml(r.name)}${r.variable ? ' <small class="tag">可选数量</small>' : ''}</div>
          <div class="reward-cost">${costLabel}</div>
          ${todayLine}
        </div>
        <button class="btn-redeem ${notEnough ? "disabled" : ""}" data-id="${r.id}" ${disabled ? "disabled" : ""}>${btnLabel}</button>
      </div>
    `;
  }).join("");
  list.querySelectorAll(".btn-redeem").forEach((b) => {
    if (b.disabled) return;
    b.onclick = () => openRedeemModal(parseInt(b.dataset.id, 10));
  });

  loadRecentRedemptions();
}

async function loadRecentRedemptions() {
  const box = $("recentRedemptions");
  if (!box) return;
  const isParent = state.profile.role === "parent";
  const { data, error } = await sb
    .from("redemptions")
    .select("id, day, reward_name, points, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) { box.innerHTML = ""; return; }
  if (!data.length) {
    box.innerHTML = '<div class="empty" style="padding:16px;font-size:13px">还没有兑换记录</div>';
    return;
  }
  box.innerHTML = data.map((r) => `
    <div class="hist-item">
      <span>🎁 ${escapeHtml(r.reward_name)} <small style="color:#aaa;margin-left:4px">${r.day}</small></span>
      <span>
        <span class="hist-pts danger">-${r.points} ⭐</span>
        ${isParent ? `<button class="mini-btn danger recent-del" data-id="${r.id}" style="margin-left:6px">取消兑换</button>` : ""}
      </span>
    </div>
  `).join("");
  box.querySelectorAll(".recent-del").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("取消这条兑换会退回积分, 确认吗?")) return;
      const { error } = await sb.from("redemptions").delete().eq("id", b.dataset.id);
      if (error) { toast(error.message, true); return; }
      toast("已取消, 积分已退回", false);
      await refreshStats();
      await renderRewards();
    };
  });
}

// ==================== 兑换弹窗 ====================
let rmContext = null;
function openRedeemModal(rewardId) {
  if (state.profile.role !== "parent") {
    toast("兑换奖励需要家长操作哦", true);
    return;
  }
  const r = state.rewards.find((x) => x.id === rewardId);
  if (!r) return;
  const bal = available();
  const unit = r.unit || "次";
  rmContext = { reward: r };

  $("rmEmoji").textContent = r.emoji || "🎁";
  $("rmName").textContent = r.name;
  $("rmQuickPicks").innerHTML = "";

  if (r.variable) {
    $("rmAmountRow").style.display = "block";
    const maxAmount = Math.max(0, Math.floor(bal / r.cost));
    const isMoney = unit === "元";
    const isDirectStar = r.cost === 1 && (unit === "⭐" || unit === "积分");

    // 标签 + 单位随奖励定制
    if (isDirectStar) {
      $("rmAmountLabel").textContent = "🌟 兑换多少积分?";
      $("rmAmountUnit").textContent = "⭐";
    } else if (isMoney) {
      $("rmAmountLabel").textContent = "💰 我要换多少钱?";
      $("rmAmountUnit").textContent = unit;
    } else {
      $("rmAmountLabel").textContent = `🎯 我要换多少 ${unit}?`;
      $("rmAmountUnit").textContent = unit;
    }

    $("rmAmount").min = 1;
    $("rmAmount").max = Math.max(1, maxAmount);
    $("rmAmount").value = maxAmount >= 1 ? 1 : 0;

    // 快捷金额按钮
    if (isDirectStar) {
      const picks = [5, 10, 20, 50].filter((v) => v <= maxAmount);
      if (maxAmount > 0 && !picks.includes(maxAmount)) picks.push(maxAmount);
      $("rmQuickPicks").innerHTML = picks.map((v) =>
        `<button type="button" class="qp-btn" data-v="${v}">${v} ⭐</button>`
      ).join("") + (maxAmount > 0 ? `<button type="button" class="qp-btn max" data-v="${maxAmount}">全部 (${maxAmount}⭐)</button>` : "");
      $("rmQuickPicks").querySelectorAll(".qp-btn").forEach((b) => {
        b.onclick = () => {
          $("rmAmount").value = b.dataset.v;
          updateRmTotal();
          highlightPick(b.dataset.v);
        };
      });
    } else if (isMoney) {
      const picks = [1, 2, 5, 10].filter((v) => v <= maxAmount);
      if (maxAmount > 0 && !picks.includes(maxAmount)) picks.push(maxAmount);
      $("rmQuickPicks").innerHTML = picks.map((v) =>
        `<button type="button" class="qp-btn" data-v="${v}">${v} 元</button>`
      ).join("") + (maxAmount > 0 ? `<button type="button" class="qp-btn max" data-v="${maxAmount}">全部 (${maxAmount}元)</button>` : "");
      $("rmQuickPicks").querySelectorAll(".qp-btn").forEach((b) => {
        b.onclick = () => {
          $("rmAmount").value = b.dataset.v;
          updateRmTotal();
          highlightPick(b.dataset.v);
        };
      });
    }

    $("rmAmountHint").textContent = isDirectStar
      ? `你有 ${bal} ⭐ (最多可换 ${maxAmount} ⭐ 零花钱)`
      : isMoney
        ? `每 1 元 = ${r.cost} ⭐   你有 ${bal} ⭐ (最多可换 ${maxAmount} 元)`
        : `每 1 ${unit} 消耗 ${r.cost} ⭐, 最多 ${maxAmount} ${unit}`;
    $("rmDesc").textContent = "";
  } else {
    $("rmAmountRow").style.display = "none";
    $("rmDesc").textContent = `一次消耗 ${r.cost} ⭐  (你有 ${bal} ⭐)`;
    $("rmAmount").value = 1;
  }
  updateRmTotal();
  $("rmAmount").oninput = () => { updateRmTotal(); highlightPick($("rmAmount").value); };
  $("redeemModal").style.display = "flex";
}

function highlightPick(v) {
  document.querySelectorAll("#rmQuickPicks .qp-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.v === String(v));
  });
}

function updateRmTotal() {
  const r = rmContext?.reward;
  if (!r) return;
  const amount = r.variable ? Math.max(1, parseInt($("rmAmount").value, 10) || 0) : 1;
  const total = r.cost * amount;
  $("rmTotal").textContent = total;
  const bal = available();
  const btn = $("rmConfirm");
  if (total > bal) {
    btn.disabled = true;
    btn.textContent = "积分不足";
  } else {
    btn.disabled = false;
    const isMoney = r.variable && r.unit === "元";
    const isDirectStar = r.variable && r.cost === 1 && (r.unit === "⭐" || r.unit === "积分");
    btn.textContent = isDirectStar ? `兑换 ${amount} ⭐ 零花钱`
                    : isMoney ? `兑换 ${amount} 元`
                    : "兑换";
  }
}

function closeRedeemModal() {
  $("redeemModal").style.display = "none";
  rmContext = null;
}

async function confirmRedeem() {
  if (!rmContext) return;
  if (state.profile.role !== "parent") { toast("兑换奖励需要家长操作哦", true); return; }
  const r = rmContext.reward;
  const bal = available();
  const amount = r.variable ? Math.max(1, parseInt($("rmAmount").value, 10) || 0) : 1;
  const totalCost = r.cost * amount;
  if (totalCost > bal) {
    toast("积分不够, 再加油攒一攒~", true);
    return;
  }
  const isDirectStarRedeem = r.variable && r.cost === 1 && (r.unit === "⭐" || r.unit === "积分");
  const displayName = isDirectStarRedeem
    ? `${r.name} ${amount} ⭐`
    : r.variable
      ? (r.unit === "元" ? `${r.name} ${amount} 元` : `${r.name} ×${amount}${r.unit || "次"}`)
      : r.name;
  const { error } = await sb.from("redemptions").insert({
    family_id: state.profile.family_id,
    reward_id: r.id,
    reward_name: displayName,
    amount, points: totalCost,
    day: state.todayStr,
    created_by: state.session.user.id,
  });
  if (error) { toast(error.message, true); return; }
  closeRedeemModal();
  toast(`兑换成功: ${displayName} (-${totalCost} ⭐)`, false);
  await refreshStats();
  await renderRewards();
  // 如果当前在记录页, 刷新
  if ($("tab-history").classList.contains("active")) loadRedemptionsHistory();
}

// ==================== 记录 ====================
async function loadRedemptionsHistory() {
  const el = $("redemptionsHistory");
  el.innerHTML = '<div class="loading">加载中...</div>';
  const isParent = state.profile.role === "parent";
  const { data, error } = await sb
    .from("redemptions")
    .select("id, day, reward_name, amount, points, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) { el.innerHTML = `<div class="empty">加载失败: ${escapeHtml(error.message)}</div>`; return; }
  if (!data.length) { el.innerHTML = '<div class="empty">还没有兑换记录, 快去攒积分吧</div>'; return; }
  el.innerHTML = data.map((r) => `
    <div class="hist-item">
      <span>${escapeHtml(r.reward_name)}</span>
      <span>
        <span class="hist-pts danger">-${r.points} ⭐</span>
        <small style="color:#aaa;margin-left:6px">${r.day}</small>
        ${isParent ? `<button class="mini-btn danger del-red" data-id="${r.id}" style="margin-left:6px">删</button>` : ""}
      </span>
    </div>`).join("");
  el.querySelectorAll(".del-red").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("删除这条兑换记录会退回积分, 确认吗?")) return;
      const { error } = await sb.from("redemptions").delete().eq("id", b.dataset.id);
      if (error) { toast(error.message, true); return; }
      toast("已删除, 积分已退回", false);
      await refreshStats();
      loadRedemptionsHistory();
    };
  });
}

// ==================== Tab 切换 ====================
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + key));
      if (key === "history") loadCalendar();
    };
  });
  document.querySelectorAll(".mini-tab-btn").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.htab;
      document.querySelectorAll(".mini-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $("calendarView").style.display = key === "calendar" ? "block" : "none";
      $("redemptionsHistory").style.display = key === "redemptions" ? "block" : "none";
      if (key === "calendar") loadCalendar();
      else loadRedemptionsHistory();
    };
  });
}

// ==================== 日历 ====================
let calState = { year: 0, month: 0, selectedDay: null };

function initCalendarNav() {
  const [y, m] = state.todayStr.split("-").map(Number);
  calState.year = y;
  calState.month = m;
  $("prevMonth").onclick = () => shiftMonth(-1);
  $("nextMonth").onclick = () => shiftMonth(1);
  $("calCloseDay").onclick = () => { $("calDayDetail").style.display = "none"; calState.selectedDay = null; };
}

function shiftMonth(delta) {
  let y = calState.year;
  let m = calState.month + delta;
  if (m < 1) { m = 12; y -= 1; }
  else if (m > 12) { m = 1; y += 1; }
  calState.year = y; calState.month = m;
  calState.selectedDay = null;
  $("calDayDetail").style.display = "none";
  loadCalendar();
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

async function loadCalendar() {
  const { year, month } = calState;
  $("calTitle").textContent = `${year} 年 ${month} 月`;
  $("calGrid").innerHTML = '<div class="loading" style="grid-column:1 / -1">加载中...</div>';

  const first = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${pad2(month)}-${pad2(lastDay)}`;

  const { data, error } = await sb
    .from("check_ins")
    .select("day, task_id, tasks!inner(points)")
    .gte("day", first)
    .lte("day", last);
  if (error) { $("calGrid").innerHTML = `<div class="empty" style="grid-column:1 / -1">加载失败: ${escapeHtml(error.message)}</div>`; return; }

  const byDay = {};
  for (const r of data) {
    const d = r.day;
    if (!byDay[d]) byDay[d] = { points: 0, count: 0 };
    byDay[d].points += r.tasks?.points || 0;
    byDay[d].count += 1;
  }
  const monthSum = Object.values(byDay).reduce((s, x) => s + x.points, 0);
  const activeDays = Object.keys(byDay).length;
  $("calMonthSum").textContent = monthSum;
  $("calMonthDays").textContent = activeDays;

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let d = 1; d <= lastDay; d++) {
    const dstr = `${year}-${pad2(month)}-${pad2(d)}`;
    const info = byDay[dstr];
    const isToday = dstr === state.todayStr;
    const isFuture = dstr > state.todayStr;
    const isSelected = dstr === calState.selectedDay;
    const cls = ["cal-cell"];
    if (isToday) cls.push("today");
    if (isFuture) cls.push("future");
    if (info) cls.push("has-data");
    if (isSelected) cls.push("selected");
    const dot = info ? `<span class="cal-pts">+${info.points}</span>` : "";
    cells.push(`<div class="${cls.join(" ")}" data-day="${dstr}">
      <span class="cal-num">${d}</span>${dot}
    </div>`);
  }
  $("calGrid").innerHTML = cells.join("");
  $("calGrid").querySelectorAll(".cal-cell[data-day]").forEach((c) => {
    if (c.classList.contains("future")) return;
    c.onclick = () => showDayDetail(c.dataset.day);
  });
  if (calState.selectedDay && calState.selectedDay >= first && calState.selectedDay <= last) {
    showDayDetail(calState.selectedDay);
  }
}

async function showDayDetail(day) {
  calState.selectedDay = day;
  $("calDayDetail").style.display = "block";
  const isFuture = day > state.todayStr;
  const jumpBtn = isFuture ? "" : `<button id="calJumpBtn" class="mini-btn primary" data-day="${day}">${day === state.todayStr ? "去打卡" : "去补打卡"}</button>`;
  $("calDayTitle").innerHTML = `<span>${day} ${day === state.todayStr ? "(今天)" : ""}</span>${jumpBtn}`;
  $("calDayList").innerHTML = '<div class="loading">加载中...</div>';
  document.querySelectorAll(".cal-cell").forEach((c) => c.classList.toggle("selected", c.dataset.day === day));

  const jb = $("calJumpBtn");
  if (jb) jb.onclick = () => {
    state.viewDate = day;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "tasks"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-tasks"));
    loadTasks();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const [ciResp, rdResp] = await Promise.all([
    sb.from("check_ins").select("id, task_id, created_at, tasks(name, emoji, points)").eq("day", day).order("created_at"),
    sb.from("redemptions").select("id, reward_name, points, created_at").eq("day", day).order("created_at"),
  ]);
  const cis = ciResp.data || [];
  const rds = rdResp.data || [];
  if (!cis.length && !rds.length) {
    $("calDayList").innerHTML = '<div class="empty" style="padding:20px">这一天没有任何记录</div>';
    return;
  }
  const daySum = cis.reduce((s, r) => s + (r.tasks?.points || 0), 0);
  const dayUsed = rds.reduce((s, r) => s + (r.points || 0), 0);
  const html = [`<div class="cal-day-sum">获得 +${daySum} ⭐ · 消耗 -${dayUsed} ⭐</div>`];
  if (cis.length) {
    html.push('<div class="mini-label" style="margin-top:8px">打卡</div>');
    cis.forEach((r) => {
      html.push(`<div class="hist-item">
        <span>${r.tasks?.emoji || "⭐"} ${escapeHtml(r.tasks?.name || "已删除任务")}</span>
        <span class="hist-pts">+${r.tasks?.points || 0} ⭐</span>
      </div>`);
    });
  }
  if (rds.length) {
    html.push('<div class="mini-label" style="margin-top:8px">兑换</div>');
    rds.forEach((r) => {
      html.push(`<div class="hist-item">
        <span>🎁 ${escapeHtml(r.reward_name)}</span>
        <span class="hist-pts danger">-${r.points} ⭐</span>
      </div>`);
    });
  }
  $("calDayList").innerHTML = html.join("");
}

// ==================== 账号面板 ====================
function initAccountPanel() {
  $("toggleAccount").onclick = () => {
    const body = $("accountBody");
    const showing = body.style.display !== "none";
    body.style.display = showing ? "none" : "block";
    $("toggleAccount").textContent = showing ? "展开" : "收起";
  };
  $("myPwdBtn").onclick = async () => {
    const p = $("myNewPassword").value;
    if (!p || p.length < 6) { toast("密码至少 6 位", true); return; }
    try {
      await Auth.changePassword(p);
      $("myNewPassword").value = "";
      toast("密码已更新, 下次登录用新密码", false);
    } catch (err) { toast(err.message || "修改失败", true); }
  };
}

// ==================== 家庭面板 ====================
async function initFamilyPanel() {
  $("familyPanel").style.display = "block";
  const info = await Auth.getFamilyInfo();
  if (info) {
    $("familyName").textContent = info.name || "我的家庭";
    $("joinCode").textContent = info.join_code || "------";
  }
  if (state.profile.role === "parent") $("rotateCode").style.display = "inline-block";

  $("toggleFamily").onclick = async () => {
    const body = $("familyBody");
    const showing = body.style.display !== "none";
    body.style.display = showing ? "none" : "block";
    $("toggleFamily").textContent = showing ? "展开" : "收起";
    if (!showing) await renderMembers();
  };
  $("copyCode").onclick = async () => {
    const code = $("joinCode").textContent.trim();
    try { await navigator.clipboard.writeText(code); toast("邀请码已复制", false); }
    catch { toast(`请手动复制: ${code}`, true); }
  };
  $("rotateCode").onclick = async () => {
    if (!confirm("刷新后旧邀请码立即失效, 已加入的成员不受影响。确认继续?")) return;
    try {
      const newCode = await Auth.rotateJoinCode();
      $("joinCode").textContent = newCode;
      toast("邀请码已刷新", false);
    } catch (err) { toast(err.message || "刷新失败", true); }
  };
}

async function renderMembers() {
  const list = $("memberList");
  list.innerHTML = "<li class='loading'>加载中...</li>";
  const members = await Auth.getFamilyMembers();
  if (!members.length) { list.innerHTML = "<li class='empty'>暂无成员</li>"; return; }
  const isParent = state.profile.role === "parent";
  list.innerHTML = members.map((m) => {
    const roleTxt = m.role === "parent" ? "家长" : "小朋友";
    const roleCls = m.role === "parent" ? "parent" : "kid";
    const isMe = m.user_id === state.session.user.id;
    const resetBtn = (isParent && !isMe)
      ? `<button class="mini-btn danger reset-pwd-btn" data-uid="${m.user_id}" data-name="${escapeHtml(m.display_name || "")}">重置密码</button>` : "";
    return `<li>
      <span class="member-name">${escapeHtml(m.display_name || "无昵称")}${isMe ? " (我)" : ""}</span>
      <span style="display:flex;gap:6px;align-items:center">
        ${resetBtn}
        <span class="member-role ${roleCls}">${roleTxt}</span>
      </span></li>`;
  }).join("");
  list.querySelectorAll(".reset-pwd-btn").forEach((btn) => {
    btn.onclick = async () => {
      const newPwd = prompt(`为「${btn.dataset.name || "该成员"}」设置新密码 (至少 6 位):`);
      if (!newPwd) return;
      if (newPwd.length < 6) { toast("密码至少 6 位", true); return; }
      try {
        await Auth.adminResetMemberPassword(btn.dataset.uid, newPwd);
        toast(`${btn.dataset.name} 的密码已重置`, false);
      } catch (err) { toast(err.message || "重置失败", true); }
    };
  });
}

// ==================== 兑换弹窗事件 ====================
function initRedeemModal() {
  $("rmCancel").onclick = closeRedeemModal;
  $("rmConfirm").onclick = confirmRedeem;
  $("redeemModal").addEventListener("click", (e) => {
    if (e.target.id === "redeemModal") closeRedeemModal();
  });
}

// ==================== 自定义任务弹窗 ====================
const CUSTOM_EMOJIS = ["⭐", "🎯", "🧹", "📦", "🎨", "🎵", "🏃", "🍚", "🧺", "🛒"];
let customEmojiIdx = 0;
function openCustomTaskModal() {
  customEmojiIdx = 0;
  $("ctEmoji").textContent = CUSTOM_EMOJIS[0];
  $("ctName").value = "";
  $("ctPoints").value = "1";
  const picks = $("ctQuickPoints");
  picks.innerHTML = [1, 2, 3, 5].map((v) => `<button type="button" data-v="${v}">${v} ⭐</button>`).join("");
  picks.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { $("ctPoints").value = b.dataset.v; };
  });
  $("customTaskModal").style.display = "flex";
  setTimeout(() => $("ctName").focus(), 50);
}
function closeCustomTaskModal() { $("customTaskModal").style.display = "none"; }
function initCustomTaskModal() {
  $("ctCancel").onclick = closeCustomTaskModal;
  $("customTaskModal").addEventListener("click", (e) => {
    if (e.target.id === "customTaskModal") closeCustomTaskModal();
  });
  $("ctEmoji").onclick = () => {
    customEmojiIdx = (customEmojiIdx + 1) % CUSTOM_EMOJIS.length;
    $("ctEmoji").textContent = CUSTOM_EMOJIS[customEmojiIdx];
  };
  $("ctConfirm").onclick = confirmCustomTask;
}
async function confirmCustomTask() {
  const name = $("ctName").value.trim();
  const points = parseInt($("ctPoints").value, 10);
  if (!name) { toast("请输入任务名称", true); return; }
  if (!Number.isFinite(points) || points < 1) { toast("积分必须是正整数", true); return; }
  const emoji = $("ctEmoji").textContent;
  const btn = $("ctConfirm");
  btn.disabled = true;
  // 1. 创建 one_time 任务
  const { data: task, error: taskErr } = await sb.from("tasks").insert({
    family_id: state.profile.family_id,
    name, emoji, points,
    daily_limit: 1,
    active: true,
    one_time: true,
  }).select().single();
  if (taskErr) { toast(taskErr.message, true); btn.disabled = false; return; }
  // 2. 立即打卡到当前 viewDate
  const { error: chkErr } = await sb.from("check_ins").insert({
    family_id: state.profile.family_id,
    task_id: task.id,
    day: state.viewDate,
  });
  btn.disabled = false;
  if (chkErr) { toast("任务已创建但打卡失败: " + chkErr.message, true); }
  else { toast(`已添加 ${emoji}${name}, +${points} ⭐`, false); }
  closeCustomTaskModal();
  await loadTasks();
  await refreshStats();
}

// ==================== 家长管理面板 ====================
function initManagePanel() {
  if (state.profile?.role !== "parent") return;
  $("manageePanel").style.display = "block";

  $("toggleManage").onclick = async () => {
    const showing = $("manageBody").style.display === "block";
    $("manageBody").style.display = showing ? "none" : "block";
    $("toggleManage").textContent = showing ? "展开" : "收起";
    if (!showing) {
      await renderManageTasks();
      await renderManageRewards();
    }
  };

  document.querySelectorAll(".manage-tab-btn").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".manage-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".manage-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("manage-" + btn.dataset.mtab).classList.add("active");
    };
  });

  $("addTaskBtn").onclick = () => openTaskEditModal(null);
  $("addRewardBtn").onclick = () => openRewardEditModal(null);
}

async function renderManageTasks() {
  const box = $("manageTaskList");
  // 拉取所有非一次性任务 (one_time=false 或字段不存在)
  const { data, error } = await sb.from("tasks")
    .select("*").eq("active", true).order("sort_order").order("id");
  if (error) { box.innerHTML = `<div class="empty">${error.message}</div>`; return; }
  const list = (data || []).filter((t) => !t.one_time);
  if (!list.length) { box.innerHTML = '<div class="empty">还没有任务</div>'; return; }
  box.innerHTML = list.map((t) => `
    <div class="manage-item">
      <span class="manage-emoji">${t.emoji}</span>
      <div class="manage-main">
        <div class="manage-name">${escapeHtml(t.name)}</div>
        <div class="manage-sub">+${t.points}⭐ × ${t.daily_limit}次/天</div>
      </div>
      <button class="mini-btn edit-task" data-id="${t.id}">编辑</button>
      <button class="mini-btn danger del-task" data-id="${t.id}">删除</button>
    </div>
  `).join("");
  box.querySelectorAll(".edit-task").forEach((b) => {
    b.onclick = () => {
      const t = list.find((x) => x.id === parseInt(b.dataset.id, 10));
      openTaskEditModal(t);
    };
  });
  box.querySelectorAll(".del-task").forEach((b) => {
    b.onclick = () => onDeleteTask(parseInt(b.dataset.id, 10), list.find((x) => x.id === parseInt(b.dataset.id, 10))?.name);
  });
}

async function renderManageRewards() {
  const box = $("manageRewardList");
  const { data, error } = await sb.from("rewards")
    .select("*").eq("active", true).order("sort_order").order("id");
  if (error) { box.innerHTML = `<div class="empty">${error.message}</div>`; return; }
  const list = data || [];
  if (!list.length) { box.innerHTML = '<div class="empty">还没有奖励</div>'; return; }
  box.innerHTML = list.map((r) => `
    <div class="manage-item">
      <span class="manage-emoji">${r.emoji}</span>
      <div class="manage-main">
        <div class="manage-name">${escapeHtml(r.name)}</div>
        <div class="manage-sub">${r.cost}⭐${r.variable ? ` / ${escapeHtml(r.unit || "次")}` : ""}${r.variable ? ' (可选数量)' : ''}</div>
      </div>
      <button class="mini-btn edit-reward" data-id="${r.id}">编辑</button>
      <button class="mini-btn danger del-reward" data-id="${r.id}">删除</button>
    </div>
  `).join("");
  box.querySelectorAll(".edit-reward").forEach((b) => {
    b.onclick = () => {
      const r = list.find((x) => x.id === parseInt(b.dataset.id, 10));
      openRewardEditModal(r);
    };
  });
  box.querySelectorAll(".del-reward").forEach((b) => {
    b.onclick = () => onDeleteReward(parseInt(b.dataset.id, 10), list.find((x) => x.id === parseInt(b.dataset.id, 10))?.name);
  });
}

async function onDeleteTask(id, name) {
  if (!confirm(`确定删除任务"${name || ""}"吗?\n\n注意: 已有的打卡记录不会消失, 但任务不再显示在今日列表.`)) return;
  // 软删除: 置 active=false, 保留历史记录
  const { error } = await sb.from("tasks").update({ active: false }).eq("id", id);
  if (error) { toast(error.message, true); return; }
  toast("已删除", false);
  await renderManageTasks();
  await loadTasks();
  await refreshStats();
}

async function onDeleteReward(id, name) {
  if (!confirm(`确定删除奖励"${name || ""}"吗?\n\n注意: 已有的兑换记录不会消失.`)) return;
  const { error } = await sb.from("rewards").update({ active: false }).eq("id", id);
  if (error) { toast(error.message, true); return; }
  toast("已删除", false);
  await renderManageRewards();
  await loadRewardsData();
  await renderRewards();
}

// ==================== 任务编辑弹窗 ====================
let taskEditContext = null;
function openTaskEditModal(task) {
  taskEditContext = task;
  $("teTitle").textContent = task ? "编辑任务" : "新增任务";
  $("teEmoji").textContent = task?.emoji || "⭐";
  $("teEmojiInput").value = task?.emoji || "⭐";
  $("teName").value = task?.name || "";
  $("tePoints").value = task?.points ?? 1;
  $("teLimit").value = task?.daily_limit ?? 1;
  $("taskEditModal").style.display = "flex";
}
function closeTaskEditModal() { $("taskEditModal").style.display = "none"; }
function initTaskEditModal() {
  $("teCancel").onclick = closeTaskEditModal;
  $("taskEditModal").addEventListener("click", (e) => {
    if (e.target.id === "taskEditModal") closeTaskEditModal();
  });
  $("teEmojiInput").addEventListener("input", () => {
    $("teEmoji").textContent = $("teEmojiInput").value || "⭐";
  });
  $("teConfirm").onclick = confirmTaskEdit;
}
async function confirmTaskEdit() {
  const name = $("teName").value.trim();
  const emoji = $("teEmojiInput").value.trim() || "⭐";
  const points = parseInt($("tePoints").value, 10);
  const daily_limit = parseInt($("teLimit").value, 10);
  if (!name) { toast("请输入任务名称", true); return; }
  if (!Number.isFinite(points) || points < 1) { toast("积分必须 ≥ 1", true); return; }
  if (!Number.isFinite(daily_limit) || daily_limit < 1) { toast("每日次数必须 ≥ 1", true); return; }
  const payload = { name, emoji, points, daily_limit };
  const btn = $("teConfirm");
  btn.disabled = true;
  let err;
  if (taskEditContext) {
    ({ error: err } = await sb.from("tasks").update(payload).eq("id", taskEditContext.id));
  } else {
    ({ error: err } = await sb.from("tasks").insert({
      ...payload, active: true, one_time: false,
      family_id: state.profile.family_id,
    }));
  }
  btn.disabled = false;
  if (err) { toast(err.message, true); return; }
  toast(taskEditContext ? "已保存" : "已添加", false);
  closeTaskEditModal();
  await renderManageTasks();
  await loadTasks();
  await refreshStats();
}

// ==================== 奖励编辑弹窗 ====================
let rewardEditContext = null;
function openRewardEditModal(reward) {
  rewardEditContext = reward;
  $("reTitle").textContent = reward ? "编辑奖励" : "新增奖励";
  $("reEmoji").textContent = reward?.emoji || "🎁";
  $("reEmojiInput").value = reward?.emoji || "🎁";
  $("reName").value = reward?.name || "";
  $("reCost").value = reward?.cost ?? 10;
  $("reVariable").checked = !!reward?.variable;
  $("reUnit").value = reward?.unit || "次";
  $("rewardEditModal").style.display = "flex";
}
function closeRewardEditModal() { $("rewardEditModal").style.display = "none"; }
function initRewardEditModal() {
  $("reCancel").onclick = closeRewardEditModal;
  $("rewardEditModal").addEventListener("click", (e) => {
    if (e.target.id === "rewardEditModal") closeRewardEditModal();
  });
  $("reEmojiInput").addEventListener("input", () => {
    $("reEmoji").textContent = $("reEmojiInput").value || "🎁";
  });
  $("reConfirm").onclick = confirmRewardEdit;
}
async function confirmRewardEdit() {
  const name = $("reName").value.trim();
  const emoji = $("reEmojiInput").value.trim() || "🎁";
  const cost = parseInt($("reCost").value, 10);
  const variable = $("reVariable").checked;
  const unit = $("reUnit").value.trim() || "次";
  if (!name) { toast("请输入奖励名称", true); return; }
  if (!Number.isFinite(cost) || cost < 1) { toast("价格必须 ≥ 1", true); return; }
  const payload = { name, emoji, cost, variable, unit };
  const btn = $("reConfirm");
  btn.disabled = true;
  let err;
  if (rewardEditContext) {
    ({ error: err } = await sb.from("rewards").update(payload).eq("id", rewardEditContext.id));
  } else {
    ({ error: err } = await sb.from("rewards").insert({
      ...payload, active: true,
      family_id: state.profile.family_id,
    }));
  }
  btn.disabled = false;
  if (err) { toast(err.message, true); return; }
  toast(rewardEditContext ? "已保存" : "已添加", false);
  closeRewardEditModal();
  await renderManageRewards();
  await loadRewardsData();
  await renderRewards();
}

// ==================== 入口 ====================
async function main() {
  const auth = await Auth.requireAuth();
  if (!auth) return;
  state.session = auth.session;
  state.profile = auth.profile;
  $("userName").textContent = auth.profile.display_name || auth.session.user.email;
  $("roleTag").textContent = auth.profile.role === "parent" ? "家长" : "小朋友";
  $("roleTag").classList.add(auth.profile.role);
  $("logoutBtn").onclick = () => Auth.signOut();
  initTabs();
  initAccountPanel();
  initRedeemModal();
  initCustomTaskModal();
  initTaskEditModal();
  initRewardEditModal();
  initManagePanel();
  initCalendarNav();
  initDateNav();
  await loadAll();
  initFamilyPanel();
}

main();
