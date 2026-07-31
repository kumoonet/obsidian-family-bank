'use strict';

const obsidian = require('obsidian');

const STORAGE_KEY = 'family_bank_data';
const DEPOSIT_TYPES = [
  { id: 'month', name: '月定存', rate: 0.005, rateLabel: '月 0.5%', periodDays: 30, emoji: '🪙' },
  { id: 'year', name: '年定存', rate: 0.07, rateLabel: '年 7%', periodDays: 365, emoji: '💎' }
];

function fmt(v) { return Number(v).toFixed(v % 1 === 0 ? 0 : 1); }

function calcInterest(principal, rate, rateType, fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const days = (to - from) / (1000 * 60 * 60 * 24);
  if (days < 0) return { interest: 0, periods: 0, fullPeriods: 0, partialDays: 0, days: 0, periodDays: 0 };
  const periodDays = rateType === 'month' ? 30 : rateType === 'year' ? 365 : 7;
  const fullPeriods = Math.floor(days / periodDays);
  const partialDays = days % periodDays;
  const interest = fullPeriods > 0 ? principal * rate * fullPeriods : 0;
  return { interest: Math.round(interest * 100) / 100, fullPeriods, partialDays, days, periodDays };
}

function calcTotal(child) {
  return child.deposits.reduce((s, d) => s + d.principal, 0);
}

function createChildData() {
  return { name: '默认', emoji: '👤', records: [], deposits: [], goal: { name: '', target: 0 }, settleHistory: [], deductions: [], assetTimeline: [] };
}

function getDefaultData() {
  return {
    version: 2,
    currentChild: null,
    children: {}
  };
}

function mergeDefaults(parsed) {
  const def = createChildData();
  const merged = { ...parsed };
  if (!merged.children) merged.children = {};
  for (const key of Object.keys(merged.children)) {
    merged.children[key] = { ...def, ...merged.children[key] };
  }
  // 至少一个默认账户
  if (Object.keys(merged.children).length === 0) {
    const id = 'child_' + Date.now();
    merged.children[id] = { ...def };
  }
  if (!merged.currentChild || !merged.children[merged.currentChild]) {
    merged.currentChild = Object.keys(merged.children)[0];
  }
  return merged;
}

// ========================================
// 视图
// ========================================
class FamilyBankView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.data = { version: 2, currentChild: null, children: {} };
    this.selectedDepositType = 'month';
    this.selectedDepositSource = '📌其他';
    this.settleMode = 'cash';
    this.settleDepositType = 'month';
    this.manageChildId = null;
    this.manageModeActive = false;
    this.deductionType = 'month';
    this.deductionMode = 'proportional';
    this.selectedDepositId = null;
    this.toastTimer = null;
  }

  getViewType() { return 'family-bank'; }
  getDisplayText() { return '家庭银行'; }
  getIcon() { return 'wallet'; }

  async onOpen() {
    window.__fb = this;
    await this.loadData();
    this.renderShell();
  }

  async onClose() { return Promise.resolve(); }

  // ========================================
  // 数据层
  // ========================================
  getDataPath() { return this.plugin.settings.dataFilePath || '家庭银行数据.json'; }

  async loadData() {
    const path = this.getDataPath();
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (exists) {
        const content = await this.app.vault.adapter.read(path);
        this.data = mergeDefaults(JSON.parse(content));
      } else {
        this.data = getDefaultData();
        await this.app.vault.adapter.write(path, JSON.stringify(this.data, null, 2));
      }
    } catch (e) {
      console.error('loadData error', e);
      this.data = getDefaultData();
    }
  }

  async saveData() {
    return this.app.vault.adapter.write(this.getDataPath(), JSON.stringify(this.data, null, 2));
  }

  getChild() { return this.data.children[this.data.currentChild]; }

  recordAssetSnapshot(child, date) {
    if (!child.assetTimeline) child.assetTimeline = [];
    child.assetTimeline.push({ date, total: calcTotal(child) });
  }

  // ========================================
  // Toast & Modal
  // ========================================
  showToast(msg) {
    const el = document.getElementById('fb-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  closeModal() {
    const el = document.getElementById('fb-modalOverlay');
    if (el) el.classList.add('hidden');
  }

  openModal(html) {
    document.getElementById('fb-modalContent').innerHTML = html;
    document.getElementById('fb-modalOverlay').classList.remove('hidden');
  }

  // ========================================
  // 渲染：壳
  // ========================================
  renderShell() {
    const container = this.containerEl;
    container.empty();
    container.addClass('family-bank-view');

    container.innerHTML = `
      <div class="fb-topbar">
        <div class="fb-header">
          <div class="fb-header-top">
            <div class="fb-header-title"><span>家庭银行</span><small>KuMoo</small></div>
          </div>
          <div class="fb-child-switch" id="fb-childSwitch"></div>
        </div>
        <div class="fb-nav" id="fb-nav">
          <div class="fb-nav-item active" data-page="overview"><span class="fb-nav-icon">📊</span>看板</div>
          <div class="fb-nav-item" data-page="deposits"><span class="fb-nav-icon">💳</span>理财</div>
          <div class="fb-nav-item" data-page="manage"><span class="fb-nav-icon">⚙️</span>管理</div>
        </div>
      </div>

      <div class="fb-page active" id="fb-pageOverview">
        <div class="fb-card">
          <div class="fb-card-title">总资产（年定存 + 月定存）</div>
          <div class="fb-balance-big" id="fb-totalBalance">0 <span class="unit">元</span></div>
        </div>
        <div class="fb-card">
          <div class="fb-card-title">📈 资产走势</div>
          <div style="position:relative;">
            <canvas id="fb-assetChart" width="440" height="220" style="width:100%;height:220px;border-radius:8px;cursor:crosshair;"></canvas>
            <div id="fb-chartTooltip" style="display:none;position:absolute;background:#333;color:#fff;font-size:12px;padding:6px 10px;border-radius:6px;pointer-events:none;white-space:nowrap;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,0.2);"></div>
          </div>
        </div>
        <div class="fb-card">
          <div class="fb-card-title">🥧 定存占比</div>
          <div style="display:flex;align-items:center;gap:16px;">
            <canvas id="fb-pieChart" width="120" height="120" style="width:120px;height:120px;flex-shrink:0;"></canvas>
            <div id="fb-pieLegend" style="font-size:13px;flex:1;"></div>
          </div>
        </div>
        <div class="fb-card">
          <div class="fb-card-title">👥 两个孩子对比</div>
          <div id="fb-comparisonView"></div>
        </div>
        <div class="fb-card" id="fb-goalCard">
          <div class="fb-card-title">🎯 攒钱目标</div>
          <div id="fb-goalContent"></div>
        </div>
      </div>

      <div class="fb-page" id="fb-pageDeposits">
        <div style="margin-bottom:12px;">
          <button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.showDepositModal()">📥 新增定期存款</button>
        </div>
        <div id="fb-depositsList"></div>
      </div>

      <div class="fb-page" id="fb-pageManage">
        <div id="fb-manageGate" class="fb-card" style="text-align:center;padding:32px 20px;">
          <div style="font-size:48px;margin-bottom:12px;">🔒</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:8px;">家长管理模式</div>
          <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">设定目标、扣减定存、数据备份</div>
          <button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.enterManageMode()">进入管理模式</button>
        </div>
        <div id="fb-manageContent" style="display:none;">
          <div class="fb-card-title" style="margin:12px 0 8px;">🎯 设定目标</div>
          <div class="fb-card">
            <div class="fb-form-row">
              <div class="fb-form-group"><label class="fb-form-label">目标名称</label><input class="fb-form-input" type="text" id="fb-goalName" placeholder="例如：乐高城堡"></div>
              <div class="fb-form-group"><label class="fb-form-label">目标金额 (元)</label><input class="fb-form-input" type="number" id="fb-goalTarget" placeholder="例如：2000" step="1"></div>
            </div>
            <div style="display:flex;gap:10px;margin-top:8px;">
              <button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.setGoal()">✓ 保存目标</button>
              <button class="fb-btn fb-btn-danger fb-btn-block" onclick="window.__fb.deleteGoal()" id="fb-deleteGoalBtn">🗑️ 删除目标</button>
            </div>
          </div>

          <div class="fb-card-title" style="margin:12px 0 8px;">⚠️ 定存扣减</div>
          <div class="fb-card">
            <div class="fb-form-group"><label class="fb-form-label">定存类型</label><div style="display:flex;gap:10px;">
              <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-ddTypeMonth" onclick="window.__fb.selectDeductionType('month')">🪙 月定存</button>
              <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-ddTypeYear" onclick="window.__fb.selectDeductionType('year')">💎 年定存</button>
            </div></div>
            <div class="fb-form-group"><label class="fb-form-label">扣减方式</label><div style="display:flex;gap:10px;">
              <button class="fb-btn fb-btn-primary fb-btn-block" id="fb-ddModeProp" onclick="window.__fb.selectDeductionMode('proportional')">📊 按比例分摊</button>
              <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-ddModeSpecific" onclick="window.__fb.selectDeductionMode('specific')">📌 指定某笔</button>
            </div></div>
            <div class="fb-form-group" id="fb-ddSpecificSelect" style="display:none;"><label class="fb-form-label">选择要扣减的定存</label><div id="fb-ddSpecificList"></div></div>
            <div class="fb-form-row">
              <div class="fb-form-group"><label class="fb-form-label">扣减原因</label><input class="fb-form-input" type="text" id="fb-ddReason" placeholder="例如：未完成作业"></div>
              <div class="fb-form-group"><label class="fb-form-label">金额 (元)</label><input class="fb-form-input" type="number" id="fb-ddAmount" placeholder="" step="0.01" min="0"></div>
            </div>
            <button class="fb-btn fb-btn-danger fb-btn-block" onclick="window.__fb.confirmDeduction()" style="margin-top:4px;">⚠️ 确认扣减</button>
            <div style="margin-top:8px;border-top:1px solid var(--background-modifier-border);padding-top:8px;"><strong style="font-size:13px;">扣减记录</strong><div id="fb-ddHistory"></div></div>
          </div>

          <div class="fb-card-title" style="margin:12px 0 8px;">💳 定期存款管理</div>
          <div class="fb-card" id="fb-manageDepositsList"></div>

          <div class="fb-card-title" style="margin:12px 0 8px;">👥 账户管理</div>
          <div class="fb-card">
            <div class="fb-form-row">
              <div class="fb-form-group"><label class="fb-form-label">名称</label><input class="fb-form-input" type="text" id="fb-newChildName" placeholder="例如：哥哥"></div>
              <div class="fb-form-group"><label class="fb-form-label">Emoji</label><input class="fb-form-input" type="text" id="fb-newChildEmoji" placeholder="👦" maxlength="2" style="text-align:center;"></div>
              <div style="display:flex;align-items:flex-end;margin-bottom:10px;"><button class="fb-btn fb-btn-primary" onclick="window.__fb.addChild()" style="padding:8px 16px;">＋ 新增</button></div>
            </div>
            <div id="fb-childManageList"></div>
          </div>

          <div class="fb-card-title" style="margin:12px 0 8px;">💾 数据备份</div>
          <div class="fb-card">
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <button class="fb-btn fb-btn-primary" onclick="window.__fb.exportData()">📥 导出（同步用）</button>
              <button class="fb-btn fb-btn-outline" onclick="document.getElementById('fb-importFile').click()">📤 导入恢复</button>
              <button class="fb-btn fb-btn-danger" onclick="window.__fb.resetAllData()">🗑️ 清零</button>
            </div>
            <input type="file" id="fb-importFile" accept=".json" style="display:none" onchange="window.__fb.importData(event)">
            <div style="font-size:12px;color:var(--text-muted);margin-top:8px;">📥 导出 → 同步数据到 vault 文件「${this.getDataPath()}」。<br>📤 导入恢复 → 选择其他设备导出的 .json 文件，覆盖当前数据。<br>⚙️ 可在插件设置中修改数据文件路径。</div>
          </div>
        </div>
      </div>

      <div class="fb-modal-overlay hidden" id="fb-modalOverlay"><div class="fb-modal" id="fb-modalContent"></div></div>
      <div class="fb-toast hidden" id="fb-toast"></div>
    `;

    container.querySelectorAll('#fb-nav .fb-nav-item').forEach(el => {
      el.addEventListener('click', () => this.switchPage(el.dataset.page));
    });

    this.renderChildSwitch();
    this.renderOverview();
    this.renderDeposits();
    if (this.manageModeActive) {
      this.renderManageDeposits();
      this.renderDeductionHistory();
    }
  }

  // ========================================
  // 导航 & 切换
  // ========================================
  switchPage(pageId) {
    document.querySelectorAll('.fb-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#fb-nav .fb-nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById('fb-page' + pageId.charAt(0).toUpperCase() + pageId.slice(1));
    if (pageEl) pageEl.classList.add('active');
    const navEl = this.containerEl.querySelector(`#fb-nav .fb-nav-item[data-page="${pageId}"]`);
    if (navEl) navEl.classList.add('active');
    if (pageId === 'deposits') this.renderDeposits();
    if (pageId === 'manage' && this.manageModeActive) {
      this.renderManageDeposits();
      this.renderDeductionHistory();
    }
  }

  renderChildSwitch() {
    const el = document.getElementById('fb-childSwitch');
    if (!el) return;
    el.innerHTML = Object.entries(this.data.children).map(([id, c]) =>
      `<button class="fb-btn ${id === this.data.currentChild ? 'fb-btn-primary' : 'fb-btn-outline'}" onclick="window.__fb.switchChild('${id}')">${c.emoji} ${c.name}</button>`
    ).join('');
  }

  async switchChild(id) {
    this.data.currentChild = id;
    await this.saveData();
    this.renderChildSwitch();
    this.renderOverview();
    if (document.getElementById('fb-pageDeposits').classList.contains('active')) this.renderDeposits();
    if (this.manageModeActive) {
      this.renderManageDeposits();
      this.renderDeductionHistory();
    }
  }

  // ========================================
  // 看板
  // ========================================
  renderOverview() {
    const child = this.getChild();
    const total = calcTotal(child);
    const balanceEl = document.getElementById('fb-totalBalance');
    if (balanceEl) balanceEl.innerHTML = fmt(total) + ' <span class="unit">元</span>';

    const goalEl = document.getElementById('fb-goalContent');
    if (goalEl) {
      if (child.goal && child.goal.name && child.goal.target > 0) {
        const pct = Math.min((total / child.goal.target) * 100, 100);
        goalEl.innerHTML =
          `<div><div class="fb-goal-bar-header"><span>🎯 ${child.goal.name}</span><span>${fmt(total)} / ${fmt(child.goal.target)} 元 (${fmt(pct)}%)</span></div>` +
          `<div class="fb-goal-bar-track"><div class="fb-goal-bar-fill" style="width:${pct}%"></div></div></div>`;
      } else {
        goalEl.innerHTML = '<div class="fb-goal-empty">还没设定目标，在「管理」页设置一个吧 🎯</div>';
      }
    }

    this.drawAssetChart(child);
    this.drawPieChart(child);
    this.renderComparison();
  }

  // ========================================
  // 走势图
  // ========================================
  drawAssetChart(child) {
    const canvas = document.getElementById('fb-assetChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    let points = (child.assetTimeline || []).map(p => ({ date: p.date, total: p.total })).sort((a, b) => a.date.localeCompare(b.date));

    if (points.length === 0 && child.deposits.length > 0) {
      const events = [];
      const allDeductions = child.deductions || [];
      child.deposits.forEach(d => {
        let initial = d.principal;
        allDeductions.forEach(ded => {
          const detail = ded.details.find(x => x.depositId === d.id);
          if (detail) initial += detail.deducted;
        });
        events.push({ date: d.startDate, delta: initial });
      });
      allDeductions.forEach(ded => events.push({ date: ded.date, delta: -ded.amount }));
      events.sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      events.forEach(e => { running += e.delta; points.push({ date: e.date, total: Math.round(running * 100) / 100 }); });
    }

    const today = new Date().toISOString().slice(0, 10);
    const currentTotal = calcTotal(child);
    points.push({ date: today, total: currentTotal });

    const merged = [];
    points.forEach(p => {
      const existing = merged.find(m => m.date === p.date);
      if (existing) existing.total = p.total;
      else merged.push(p);
    });

    if (merged.length < 2) {
      ctx.fillStyle = '#999'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('存入定期后开始显示走势', W / 2, H / 2);
      return;
    }

    const pad = { t: 20, r: 20, b: 30, l: 50 };
    const chartW = W - pad.l - pad.r, chartH = H - pad.t - pad.b;
    const totals = merged.map(p => p.total);
    const maxVal = Math.max(...totals, 1);
    const minVal = Math.min(...totals, 0);
    const range = maxVal - minVal || 1;

    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = pad.t + chartH * (1 - i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
      ctx.fillStyle = '#999'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(fmt(minVal + range * i / 4), pad.l - 6, gy + 4);
    }

    const xScale = chartW / (merged.length - 1);

    // 结息标记
    const settleDates = [...new Set((child.settleHistory || []).map(h => h.settleDate))];
    settleDates.forEach(sd => {
      let nearest = -1, minDist = Infinity;
      merged.forEach((p, i) => {
        const dist = Math.abs(p.date.localeCompare(sd));
        if (dist < minDist) { minDist = dist; nearest = i; }
      });
      if (nearest >= 0 && minDist <= 1) {
        const sx = pad.l + nearest * xScale;
        const sy = pad.t + chartH * (1 - (merged[nearest].total - minVal) / range);
        ctx.beginPath(); ctx.arc(sx, sy - 14, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#27ae60'; ctx.fill();
        ctx.fillStyle = '#27ae60'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('息', sx, sy - 16);
      }
    });

    ctx.beginPath(); ctx.strokeStyle = '#E8730A'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    merged.forEach((p, i) => {
      const x = pad.l + i * xScale, y = pad.t + chartH * (1 - (p.total - minVal) / range);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    merged.forEach((p, i) => {
      const x = pad.l + i * xScale, y = pad.t + chartH * (1 - (p.total - minVal) / range);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#E8730A'; ctx.fill();
    });

    const step = Math.max(1, Math.floor(merged.length / 5));
    ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    merged.forEach((p, i) => {
      if (i % step === 0 || i === merged.length - 1) ctx.fillText(p.date.slice(0, 7), pad.l + i * xScale, H - 6);
    });

    const plottedPoints = merged.map((p, i) => ({ date: p.date, total: p.total, x: pad.l + i * xScale, y: pad.t + chartH * (1 - (p.total - minVal) / range) }));
    const settleMap = {};
    (child.settleHistory || []).forEach(h => { settleMap[h.settleDate] = (settleMap[h.settleDate] || 0) + h.totalInterest; });

    const tooltip = document.getElementById('fb-chartTooltip');
    if (!tooltip) return;
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const mx = (e.clientX - rect.left) * scaleX;
      let nearest = 0, minDist = Infinity;
      plottedPoints.forEach((pt, i) => { const dist = Math.abs(pt.x - mx); if (dist < minDist) { minDist = dist; nearest = i; } });
      if (minDist > chartW / (merged.length - 1) * 1.5) { tooltip.style.display = 'none'; return; }
      const pt = plottedPoints[nearest];
      const settleAmount = settleMap[pt.date];
      const settleLabel = settleAmount ? ' | 💰结息 +' + fmt(settleAmount) + ' 元' : '';
      tooltip.textContent = pt.date + '  总资产 ' + fmt(pt.total) + ' 元' + settleLabel;
      tooltip.style.display = 'block';
      const tw = tooltip.offsetWidth;
      let tx = e.clientX - rect.left - tw / 2;
      if (tx < 0) tx = 0; if (tx + tw > rect.width) tx = rect.width - tw;
      tooltip.style.left = tx + 'px';
      tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
    };
    canvas.onmouseleave = () => { tooltip.style.display = 'none'; };
  }

  // ========================================
  // 饼图
  // ========================================
  drawPieChart(child) {
    const canvas = document.getElementById('fb-pieChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width, cx = size / 2, cy = size / 2, r = size / 2 - 5;
    const monthTotal = child.deposits.filter(d => d.rateType === 'month').reduce((s, d) => s + d.principal, 0);
    const yearTotal = child.deposits.filter(d => d.rateType === 'year').reduce((s, d) => s + d.principal, 0);
    const total = monthTotal + yearTotal;
    ctx.clearRect(0, 0, size, size);

    if (total === 0) {
      ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#999'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无数据', cx, cy + 4);
      const legend = document.getElementById('fb-pieLegend');
      if (legend) legend.innerHTML = '<div style="color:var(--text-muted);">暂无定存数据</div>';
      return;
    }

    const pctMonth = (monthTotal / total * 100).toFixed(1);
    const pctYear = (yearTotal / total * 100).toFixed(1);
    let startAngle = -Math.PI / 2;
    [{ value: monthTotal, color: '#E8730A' }, { value: yearTotal, color: '#F5A623' }].forEach(slice => {
      if (slice.value <= 0) return;
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, startAngle, startAngle + angle); ctx.closePath();
      ctx.fillStyle = slice.color; ctx.fill();
      startAngle += angle;
    });
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(fmt(total), cx, cy + 5);

    const legend = document.getElementById('fb-pieLegend');
    if (legend) {
      legend.innerHTML =
        `<div style="display:flex;flex-direction:column;gap:6px;">
          <div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#E8730A;margin-right:6px;"></span>月定存 <strong>${fmt(monthTotal)}</strong> 元 (${pctMonth}%)</div>
          <div><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#F5A623;margin-right:6px;"></span>年定存 <strong>${fmt(yearTotal)}</strong> 元 (${pctYear}%)</div>
        </div>`;
    }
  }

  // ========================================
  // 对比
  // ========================================
  renderComparison() {
    const el = document.getElementById('fb-comparisonView');
    if (!el) return;
    const items = Object.entries(this.data.children).map(([id, c]) => ({ id, name: c.name, emoji: c.emoji, total: calcTotal(c) }));
    const maxTotal = Math.max(...items.map(x => x.total), 1);
    items.sort((a, b) => b.total - a.total);
    let html = '';
    items.forEach((item, i) => {
      const pct = (item.total / maxTotal * 100).toFixed(0);
      const medal = i === 0 ? '🥇' : (i === 1 && items[0].total !== items[1].total ? '🥈' : '');
      html += `<div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;">
          <span>${medal} ${item.emoji} ${item.name}</span>
          <span style="font-weight:600;">${fmt(item.total)} 元</span>
        </div>
        <div style="height:24px;background:var(--background-secondary);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#E8730A,#F5A623);border-radius:99px;display:flex;align-items:center;padding-left:8px;min-width:${pct > 0 ? '30px' : '0'};">
            <span style="color:white;font-size:11px;font-weight:600;">${pct}</span><span style="color:white;font-size:10px;">%</span>
          </div>
        </div>
      </div>`;
    });
    if (items.length >= 2 && items[0].total > 0) {
      html += `<div style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:2px;">${items[0].emoji} ${items[0].name} 领先 ${fmt(items[0].total - items[1].total)} 元</div>`;
    }
    el.innerHTML = html;
  }

  // ========================================
  // 渲染：理财
  // ========================================
  renderDeposits() {
    const child = this.getChild();
    const el = document.getElementById('fb-depositsList');
    if (!el) return;
    const groups = {};
    child.deposits.forEach(d => {
      if (!groups[d.rateType]) groups[d.rateType] = [];
      groups[d.rateType].push(d);
    });
    const typesWithData = DEPOSIT_TYPES.filter(t => groups[t.id] && groups[t.id].length > 0);
    if (typesWithData.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text-muted);"><div style="font-size:48px;margin-bottom:8px;">🏦</div><div>没有定期存款，去存一笔吧</div></div>';
      return;
    }
    el.innerHTML = typesWithData.map(t => {
      const items = groups[t.id];
      const totalPrincipal = items.reduce((s, x) => s + x.principal, 0);
      const totalSettled = items.reduce((s, x) => s + (x.settledTotal || 0), 0);
      const totalDeductions = (child.deductions || []).filter(d => d.typeId === t.id).reduce((s, d) => s + d.amount, 0);
      const earliestDate = items.map(x => x.startDate).sort()[0];
      const count = items.length;
      return `<div class="fb-deposit-card">
        <div class="fb-deposit-card-header">
          <div><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">${t.emoji} ${t.name}</div>
          <div class="fb-deposit-principal">${fmt(totalPrincipal)} <span style="font-size:14px;color:var(--text-muted);font-weight:400">元</span></div></div>
          <div class="fb-deposit-rate">${t.rateLabel}</div>
        </div>
        <div class="fb-deposit-meta"><span>📅 最早起息日 ${earliestDate}</span><span>💰 已结算利息 <strong style="color:#E8730A">${fmt(totalSettled)} 元</strong></span></div>
        <div class="fb-deposit-meta" style="margin-top:4px;"><span>📝 共 <strong>${count}</strong> 笔存入</span>${totalDeductions > 0 ? '<span style="color:var(--text-error);">⚠️ 累计扣减 <strong>' + fmt(totalDeductions) + ' 元</strong></span>' : ''}</div>
        <div class="fb-deposit-actions">
          <button class="fb-btn fb-btn-outline fb-btn-sm" onclick="window.__fb.showSettleModal('${t.id}')">💰 结算利息</button>
          <button class="fb-btn fb-btn-outline fb-btn-sm" onclick="window.__fb.showDepositDetail('${t.id}')">📋 明细 (${count})</button>
          <button class="fb-btn fb-btn-hint fb-btn-sm" onclick="window.__fb.showSettleHistory('${t.id}')">📜 结息记录</button>
        </div>
      </div>`;
    }).join('');
  }

  // ========================================
  // 存入定期
  // ========================================
  showDepositModal() {
    const today = new Date().toISOString().slice(0, 10);
    this.openModal(`
      <div class="fb-modal-title">📥 新增定期存款</div>
      <div class="fb-form-group"><label class="fb-form-label">存入金额 (元)</label><input class="fb-form-input" type="number" id="fb-depPrincipal" placeholder="最少 10 元" min="10" step="1"></div>
      <div class="fb-form-group"><label class="fb-form-label">存入类型</label><div style="display:flex;gap:10px;">
        <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-depTypeMonth" onclick="window.__fb.selectDepositType('month')">🪙 月定存 0.5%/月</button>
        <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-depTypeYear" onclick="window.__fb.selectDepositType('year')">💎 年定存 7%/年</button>
      </div></div>
      <div class="fb-form-group"><label class="fb-form-label">起息日</label><input class="fb-form-input" type="date" id="fb-depStartDate" value="${today}"></div>
      <div class="fb-form-group"><label class="fb-form-label">来源（选填）</label><div style="display:flex;gap:8px;flex-wrap:wrap;" id="fb-sourceSelector">
        <button class="fb-tag-option" data-source="🧧压岁钱" onclick="window.__fb.selectDepositSource('🧧压岁钱')"><span class="dot" style="background:#E74C3C"></span> 🧧 压岁钱</button>
        <button class="fb-tag-option" data-source="💵零花钱" onclick="window.__fb.selectDepositSource('💵零花钱')"><span class="dot" style="background:#5CB85C"></span> 💵 零花钱</button>
        <button class="fb-tag-option" data-source="🌟奖励" onclick="window.__fb.selectDepositSource('🌟奖励')"><span class="dot" style="background:#F5A623"></span> 🌟 奖励</button>
        <button class="fb-tag-option" data-source="📌其他" onclick="window.__fb.selectDepositSource('📌其他')"><span class="dot" style="background:#999"></span> 📌 其他</button>
      </div></div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        <button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.confirmDeposit()">确认存入</button>
      </div>
    `);
    this.selectDepositType('month');
    this.selectedDepositSource = '📌其他';
    document.querySelectorAll('#fb-sourceSelector .fb-tag-option').forEach(b => {
      b.classList.toggle('selected', b.dataset.source === this.selectedDepositSource);
    });
  }

  selectDepositType(type) {
    this.selectedDepositType = type;
    const monthBtn = document.getElementById('fb-depTypeMonth');
    const yearBtn = document.getElementById('fb-depTypeYear');
    if (monthBtn) monthBtn.className = type === 'month' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    if (yearBtn) yearBtn.className = type === 'year' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
  }

  selectDepositSource(source) {
    this.selectedDepositSource = source;
    document.querySelectorAll('#fb-sourceSelector .fb-tag-option').forEach(b => {
      b.classList.toggle('selected', b.dataset.source === source);
    });
  }

  async confirmDeposit() {
    const principal = parseFloat(document.getElementById('fb-depPrincipal').value);
    const startDate = document.getElementById('fb-depStartDate').value;
    if (!principal || principal < 10) { this.showToast('最少存入 10 元'); return; }
    if (!startDate) { this.showToast('请选择起息日'); return; }

    const typeConfig = DEPOSIT_TYPES.find(t => t.id === this.selectedDepositType);
    const child = this.getChild();
    child.deposits.push({
      id: Date.now(), principal, rate: typeConfig.rate, rateType: typeConfig.id,
      startDate, lastSettledDate: startDate, settledTotal: 0, source: this.selectedDepositSource
    });
    this.recordAssetSnapshot(child, startDate);
    await this.saveData();
    this.closeModal();
    this.renderDeposits();
    this.renderOverview();
    this.showToast('✓ 存入' + typeConfig.name + ' ' + fmt(principal) + ' 元');
  }

  // ========================================
  // 结息弹窗
  // ========================================
  showSettleModal(typeId) {
    const child = this.getChild();
    const typeConfig = DEPOSIT_TYPES.find(t => t.id === typeId);
    const depositsOfType = child.deposits.filter(d => d.rateType === typeId);
    if (depositsOfType.length === 0) { this.showToast('该类型无定期存款'); return; }

    const today = new Date().toISOString().slice(0, 10);
    const preview = this._calcSettlePreview(depositsOfType, today);
    this.settleMode = 'cash';
    this.settleDepositType = 'month';
    this.openModal(`
      <div class="fb-modal-title">💰 ${typeConfig.name} · 结算利息</div>
      <div class="fb-form-group"><label class="fb-form-label">结息日期</label><input class="fb-form-input" type="date" id="fb-settleDate" value="${today}" onchange="window.__fb.refreshSettlePreview('${typeId}')"></div>
      <div class="fb-form-group"><label class="fb-form-label">结算方式</label><div style="display:flex;gap:10px;">
        <button class="fb-btn fb-btn-primary fb-btn-block" id="fb-settleModeCash" onclick="window.__fb.selectSettleMode('cash')">💵 现金结算</button>
        <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-settleModeDeposit" onclick="window.__fb.selectSettleMode('deposit')">🏦 计入存款</button>
      </div></div>
      <div class="fb-form-group" id="fb-settleDepositTypeGroup" style="display:none;"><label class="fb-form-label">转存类型</label><div style="display:flex;gap:10px;">
        <button class="fb-btn fb-btn-primary fb-btn-block" id="fb-settleDepositTypeMonth" onclick="window.__fb.selectSettleDepositType('month')">🪙 月定存</button>
        <button class="fb-btn fb-btn-outline fb-btn-block" id="fb-settleDepositTypeYear" onclick="window.__fb.selectSettleDepositType('year')">💎 年定存</button>
      </div></div>
      <div style="background:var(--background-secondary);border-radius:10px;padding:12px;margin-bottom:8px;">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px;">📋 本次结息明细</div>
        <div id="fb-settlePreviewBody">${preview.hasAny ? preview.html : '<div style="color:var(--text-muted);font-size:13px;padding:6px 0;">暂无满周期的定存可结息</div>'}</div>
        ${preview.hasAny ? `<div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid var(--background-modifier-border);font-size:14px;font-weight:600;"><span>总计</span><span style="color:#E8730A;">+${fmt(preview.totalInterest)} 元</span></div>` : ''}
      </div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        ${preview.hasAny ? `<button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.confirmSettle('${typeId}')">✓ 确认结息</button>` : ''}
      </div>
    `);
  }

  selectSettleMode(mode) {
    this.settleMode = mode;
    document.getElementById('fb-settleModeCash').className = mode === 'cash' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    document.getElementById('fb-settleModeDeposit').className = mode === 'deposit' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    document.getElementById('fb-settleDepositTypeGroup').style.display = mode === 'deposit' ? 'block' : 'none';
  }

  selectSettleDepositType(type) {
    this.settleDepositType = type;
    document.getElementById('fb-settleDepositTypeMonth').className = type === 'month' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    document.getElementById('fb-settleDepositTypeYear').className = type === 'year' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
  }

  _calcSettlePreview(depositsOfType, settleDate) {
    let totalInterest = 0, rows = '', hasAny = false;
    depositsOfType.forEach(d => {
      const result = calcInterest(d.principal, d.rate, d.rateType, d.lastSettledDate || d.startDate, settleDate);
      if (result.fullPeriods > 0) {
        hasAny = true;
        totalInterest += result.interest;
        rows += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--background-modifier-border);font-size:13px;"><span>${fmt(d.principal)} 元 · 起息 ${d.startDate}</span><span style="color:#E8730A;font-weight:600;">+${fmt(result.interest)} 元 (${result.fullPeriods}期)</span></div>`;
      }
    });
    return { html: rows, totalInterest, hasAny };
  }

  refreshSettlePreview(typeId) {
    const settleDate = document.getElementById('fb-settleDate').value;
    if (!settleDate) return;
    const child = this.getChild();
    const depositsOfType = child.deposits.filter(d => d.rateType === typeId);
    const preview = this._calcSettlePreview(depositsOfType, settleDate);
    document.getElementById('fb-settlePreviewBody').innerHTML = preview.hasAny ? preview.html : '<div style="color:var(--text-muted);font-size:13px;padding:6px 0;">暂无满周期的定存可结息</div>';
    const actions = document.querySelector('#fb-modalContent .fb-modal-actions');
    if (actions) {
      actions.innerHTML =
        `<button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>` +
        (preview.hasAny ? `<button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.confirmSettle('${typeId}')">✓ 确认结息 (${fmt(preview.totalInterest)}元)</button>` : '');
    }
  }

  async confirmSettle(typeId) {
    const child = this.getChild();
    const typeConfig = DEPOSIT_TYPES.find(t => t.id === typeId);
    const settleDate = document.getElementById('fb-settleDate').value;
    if (!settleDate) { this.showToast('请选择结息日期'); return; }

    const depositsOfType = child.deposits.filter(d => d.rateType === typeId);
    let totalInterest = 0, hasAny = false;
    const snapshots = [];

    depositsOfType.forEach(d => {
      const result = calcInterest(d.principal, d.rate, d.rateType, d.lastSettledDate || d.startDate, settleDate);
      if (result.fullPeriods > 0) {
        hasAny = true;
        snapshots.push({ depositId: d.id, preLastSettledDate: d.lastSettledDate, preSettledTotal: d.settledTotal || 0, interest: result.interest, periods: result.fullPeriods });
        d.settledTotal = (d.settledTotal || 0) + result.interest;
        d.lastSettledDate = settleDate;
        totalInterest += result.interest;
      }
    });
    if (!hasAny) { this.showToast('没有可结算的利息'); return; }

    const recordId = Date.now();
    child.records.push({ id: recordId, date: settleDate, desc: typeConfig.name + '利息结算 (' + snapshots.length + '笔)', amount: totalInterest, tag: 'interest' });
    child.settleHistory.push({ id: Date.now(), settleDate, typeId, totalInterest, recordId, snapshots });

    // 结算方式：计入存款 → 转存为一笔新定期
    if (this.settleMode === 'deposit' && totalInterest > 0) {
      const targetConfig = DEPOSIT_TYPES.find(t => t.id === this.settleDepositType);
      child.deposits.push({
        id: Date.now(), principal: totalInterest, rate: targetConfig.rate, rateType: targetConfig.id,
        startDate: settleDate, lastSettledDate: settleDate, settledTotal: 0, source: '💰利息转存'
      });
    }

    await this.saveData();
    this.closeModal();
    this.renderDeposits();
    this.renderOverview();
    const depositMsg = this.settleMode === 'deposit' ? '，已转存为' + (DEPOSIT_TYPES.find(t => t.id === this.settleDepositType)).name : '，现金结算';
    this.showToast('💰 ' + typeConfig.name + '利息 +' + fmt(totalInterest) + ' 元' + depositMsg);
  }

  // ========================================
  // 结息记录
  // ========================================
  showSettleHistory(typeId) {
    const child = this.getChild();
    const typeConfig = DEPOSIT_TYPES.find(t => t.id === typeId);

    const depositsOfType = child.deposits.filter(d => d.rateType === typeId);
    const legacyDetails = depositsOfType.map(d => {
      const migrated = child.settleHistory.filter(h => h.typeId === typeId).flatMap(h => h.snapshots).filter(s => s.depositId === d.id).reduce((s, snap) => s + snap.interest, 0);
      const legacy = Math.max(0, (d.settledTotal || 0) - migrated);
      return legacy > 0 ? { depositId: d.id, principal: d.principal, startDate: d.startDate, legacy } : null;
    }).filter(Boolean);
    const legacyAmount = legacyDetails.reduce((s, x) => s + x.legacy, 0);
    const history = child.settleHistory.filter(h => h.typeId === typeId).sort((a, b) => b.settleDate.localeCompare(a.settleDate) || (b.id - a.id));

    if (history.length === 0 && legacyDetails.length === 0) { this.showToast('暂无结息记录'); return; }

    const rows = history.map(h => {
      const stillValid = child.records.some(r => r.id === h.recordId);
      const isLegacy = h.isLegacyMigration;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--background-modifier-border);">
        <div><div style="font-size:14px;font-weight:600;">📅 ${h.settleDate}${isLegacy ? ' <span style="font-size:10px;color:var(--text-muted);background:var(--background-secondary);padding:2px 6px;border-radius:4px;margin-left:6px;">旧版迁移</span>' : ''}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${h.snapshots.length}笔${isLegacy ? '' : ' · ' + h.snapshots.reduce((s, x) => s + x.periods, 0) + '期'}</div></div>
        <div style="text-align:right;"><div style="color:#E8730A;font-size:14px;font-weight:600;">+${fmt(h.totalInterest)} 元</div>
          ${isLegacy ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">只读·不可撤回</div>' :
            stillValid ? `<button class="fb-btn fb-btn-danger fb-btn-sm" onclick="window.__fb.revokeSettle(${h.id},'${typeId}')" style="margin-top:4px;">↩ 撤回</button>` :
            '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">已失效</div>'}</div>
      </div>`;
    }).join('');

    const legacySection = legacyDetails.length > 0
      ? `<div style="background:#fff8e1;border:1px solid #f7c948;border-radius:10px;padding:12px;margin-bottom:10px;font-size:13px;">
          <div style="font-weight:600;color:#946c00;margin-bottom:4px;">⚠️ 检测到旧版结息数据未迁移</div>
          <div style="margin-bottom:6px;">累积 <strong>${fmt(legacyAmount)}</strong> 元利息未纳入结息记录。</div>
          <button class="fb-btn fb-btn-primary fb-btn-sm" onclick="window.__fb.migrateLegacySettle('${typeId}')">🔄 一键迁移到结息历史</button>
        </div>`
      : '';

    this.openModal(`
      <div class="fb-modal-title">📜 ${typeConfig.name} · 结息历史</div>
      <div style="max-height:50vh;overflow-y:auto;">${legacySection}${history.length > 0 ? rows : ''}</div>
      <div class="fb-modal-actions"><button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">关闭</button></div>
    `);
  }

  revokeSettle(historyId, typeId) {
    const child = this.getChild();
    const idx = child.settleHistory.findIndex(h => h.id === historyId && h.typeId === typeId);
    if (idx === -1) { this.showToast('记录已不存在'); return; }
    const history = child.settleHistory[idx];
    if (history.isLegacyMigration) { this.showToast('此为迁移记录，不支持撤回'); this.closeModal(); return; }

    this.openModal(`
      <div class="fb-modal-title">⚠️ 撤回结息</div>
      <div style="margin-bottom:12px;background:var(--background-secondary);border-radius:10px;padding:12px;">
        <div>📅 结息日期：${history.settleDate}</div>
        <div style="color:#E8730A;font-weight:600;">💰 利息金额：+${fmt(history.totalInterest)} 元</div>
        <div>📝 ${history.snapshots.length}笔</div>
      </div>
      <div style="font-size:12px;color:var(--text-error);margin-bottom:8px;">⚠️ 撤回后，利息流水将被删除，定存状态将恢复。</div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        <button class="fb-btn fb-btn-danger fb-btn-block" onclick="window.__fb.execRevoke(${historyId},'${typeId}')">确认撤回</button>
      </div>
    `);
  }

  async execRevoke(historyId, typeId) {
    const child = this.getChild();
    const idx = child.settleHistory.findIndex(h => h.id === historyId && h.typeId === typeId);
    if (idx === -1) { this.showToast('记录已不存在'); this.closeModal(); return; }
    const history = child.settleHistory[idx];
    if (history.isLegacyMigration) { this.showToast('此为迁移记录'); this.closeModal(); return; }

    const recIdx = child.records.findIndex(r => r.id === history.recordId);
    if (recIdx !== -1) child.records.splice(recIdx, 1);
    history.snapshots.forEach(snap => {
      const dep = child.deposits.find(d => d.id === snap.depositId);
      if (dep) { dep.lastSettledDate = snap.preLastSettledDate; dep.settledTotal = snap.preSettledTotal; }
    });
    child.settleHistory.splice(idx, 1);
    await this.saveData();
    this.closeModal();
    this.renderDeposits();
    this.renderOverview();
    this.showToast('↩ 已撤回该笔结息');
  }

  migrateLegacySettle(typeId) {
    const child = this.getChild();
    const depositsOfType = child.deposits.filter(d => d.rateType === typeId);
    const legacyDetails = depositsOfType.map(d => {
      const migrated = child.settleHistory.filter(h => h.typeId === typeId).flatMap(h => h.snapshots).filter(s => s.depositId === d.id).reduce((s, snap) => s + snap.interest, 0);
      const legacy = Math.max(0, (d.settledTotal || 0) - migrated);
      return legacy > 0 ? { depositId: d.id, legacy, lastSettledDate: d.lastSettledDate } : null;
    }).filter(Boolean);
    if (legacyDetails.length === 0) { this.showToast('没有需要迁移的数据'); return; }

    const total = legacyDetails.reduce((s, x) => s + x.legacy, 0);
    this.openModal(`
      <div class="fb-modal-title">🔄 迁移旧版结息数据</div>
      <div style="margin-bottom:12px;"><div style="margin-bottom:8px;">将迁移 <strong>${fmt(total)}</strong> 元到结息历史（不产生新流水）：</div></div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.showSettleHistory('${typeId}')">返回</button>
        <button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.execMigrateLegacy('${typeId}')">确认迁移</button>
      </div>
    `);
  }

  async execMigrateLegacy(typeId) {
    const child = this.getChild();
    const depositsOfType = child.deposits.filter(d => d.rateType === typeId);
    const legacyDetails = depositsOfType.map(d => {
      const migrated = child.settleHistory.filter(h => h.typeId === typeId).flatMap(h => h.snapshots).filter(s => s.depositId === d.id).reduce((s, snap) => s + snap.interest, 0);
      const legacy = Math.max(0, (d.settledTotal || 0) - migrated);
      return legacy > 0 ? { depositId: d.id, legacy, lastSettledDate: d.lastSettledDate } : null;
    }).filter(Boolean);
    if (legacyDetails.length === 0) { this.showToast('没有需要迁移的数据'); return; }

    const total = legacyDetails.reduce((s, x) => s + x.legacy, 0);
    const today = new Date().toISOString().slice(0, 10);
    const fakeRecordId = -Math.abs(Date.now());
    child.settleHistory.push({
      id: Date.now(), settleDate: today, typeId, totalInterest: total, recordId: fakeRecordId, isLegacyMigration: true,
      snapshots: legacyDetails.map(d => ({ depositId: d.depositId, preLastSettledDate: d.lastSettledDate, preSettledTotal: 0, interest: d.legacy, periods: 0 }))
    });
    await this.saveData();
    this.closeModal();
    this.renderDeposits();
    this.showToast('🔄 已迁移 ' + fmt(total) + ' 元到结息历史');
  }

  // ========================================
  // 理财明细
  // ========================================
  showDepositDetail(typeId) {
    const child = this.getChild();
    const typeConfig = DEPOSIT_TYPES.find(t => t.id === typeId);
    const items = child.deposits.map((d, idx) => ({ ...d, _idx: idx })).filter(d => d.rateType === typeId).sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (items.length === 0) { this.showToast('该类型无明细'); return; }

    const today = new Date().toISOString().slice(0, 10);
    const totalPrincipal = items.reduce((s, x) => s + x.principal, 0);
    const totalSettled = items.reduce((s, x) => s + (x.settledTotal || 0), 0);

    const rows = items.map((d, i) => {
      const preview = calcInterest(d.principal, d.rate, d.rateType, d.lastSettledDate || d.startDate, today);
      const daysPassed = Math.floor(preview.days);
      const phase = preview.fullPeriods > 0 ? `已结 ${preview.fullPeriods}期 · 还差 ${preview.partialDays.toFixed(1)}天到下期` : `还差 ${(preview.periodDays - preview.partialDays).toFixed(1)}天到首期`;
      return `<div style="border-top:${i === 0 ? 'none' : '1px solid var(--background-modifier-border)'};padding:12px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><div style="font-size:16px;font-weight:600;">${fmt(d.principal)} 元</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">📅 ${d.startDate} ${d.source || ''}</div></div>
          <div style="text-align:right;"><div style="color:#E8730A;font-size:13px;font-weight:600;">已结 ${fmt(d.settledTotal || 0)} 元</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${daysPassed}天前起算</div></div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">⏳ ${phase}</div>
        <div style="margin-top:6px;text-align:right;"><button class="fb-btn fb-btn-danger fb-btn-sm" onclick="window.__fb.closeModal();window.__fb.withdrawDeposit(${d._idx})">🏧 取回这笔</button></div>
      </div>`;
    }).join('');

    this.openModal(`
      <div class="fb-modal-title">📋 ${typeConfig.name} · 明细</div>
      <div style="background:var(--background-secondary);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;justify-content:space-between;font-size:13px;">
        <span>累计本金 <strong>${fmt(totalPrincipal)} 元</strong></span>
        <span>累计已结息 <strong style="color:#E8730A;">${fmt(totalSettled)} 元</strong></span>
        <span>共 <strong>${items.length}</strong> 笔</span>
      </div>
      <div style="max-height:45vh;overflow-y:auto;">${rows}</div>
      <div class="fb-modal-actions"><button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">关闭</button></div>
    `);
  }

  // ========================================
  // 取回
  // ========================================
  withdrawDeposit(index) {
    const child = this.getChild();
    const d = child.deposits[index];
    if (!d) return;
    const today = new Date().toISOString().slice(0, 10);
    const result = calcInterest(d.principal, d.rate, d.rateType, d.lastSettledDate || d.startDate, today);
    const settledNow = result.fullPeriods > 0 ? result.interest : 0;
    const previewSettledTotal = (d.settledTotal || 0) + settledNow;
    const hasPenalty = result.partialDays > 0;
    const penaltyAmount = hasPenalty ? previewSettledTotal * 1.5 : 0;
    const withdrawAmount = d.principal - penaltyAmount;

    this.openModal(`
      <div class="fb-modal-title">🏧 取回定期</div>
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>本金</span><span style="font-weight:600">${fmt(d.principal)} 元</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>已结算利息</span><span style="color:#E8730A;font-weight:600">+${fmt(previewSettledTotal)} 元</span></div>
        ${settledNow > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;color:var(--text-muted);"><span>本期新结算利息</span><span style="color:#E8730A;">+${fmt(settledNow)} 元</span></div>` : ''}
        ${hasPenalty ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--text-error)"><span>⚠️ 不满周期，罚金 (已计利息×1.5)</span><span style="font-weight:600">-${fmt(penaltyAmount)} 元</span></div>` : ''}
        <hr style="border:none;border-top:1px solid var(--background-modifier-border);margin:8px 0;">
        <div style="display:flex;justify-content:space-between;"><span style="font-weight:600">实际到账</span><span style="font-weight:800;font-size:18px;color:${hasPenalty ? 'var(--text-error)' : '#27ae60'}">${fmt(withdrawAmount)} 元</span></div>
        ${hasPenalty ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">罚金 = 已计利息 × 1.5</div>' : '<div style="font-size:12px;color:#27ae60;margin-top:2px;">✓ 满期取回，免罚金</div>'}
      </div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        <button class="fb-btn fb-btn-primary fb-btn-block" onclick="window.__fb.confirmWithdraw(${index})">确认取回</button>
      </div>
    `);
  }

  async confirmWithdraw(index) {
    const child = this.getChild();
    const d = child.deposits[index];
    if (!d) { this.showToast('该笔定存已不存在'); return; }
    const today = new Date().toISOString().slice(0, 10);
    const result = calcInterest(d.principal, d.rate, d.rateType, d.lastSettledDate || d.startDate, today);

    if (result.fullPeriods > 0) {
      d.settledTotal = (d.settledTotal || 0) + result.interest;
      child.records.push({ id: Date.now(), date: today, desc: '定期利息 (取回结算)', amount: result.interest, tag: 'interest' });
    }
    const hasPenalty = result.partialDays > 0;
    const penaltyAmount = hasPenalty ? (d.settledTotal || 0) * 1.5 : 0;
    const withdrawAmount = d.principal - penaltyAmount;

    if (withdrawAmount > 0) {
      child.records.push({
        id: Date.now(), date: today,
        desc: hasPenalty ? '提前支取定期 (罚金' + fmt(penaltyAmount) + ')' : '到期取回定期',
        amount: withdrawAmount, tag: hasPenalty ? 'penalty' : 'bonus'
      });
    }

    child.deposits.splice(index, 1);
    this.recordAssetSnapshot(child, today);
    await this.saveData();
    this.closeModal();
    this.renderDeposits();
    this.renderOverview();
    this.showToast('🏧 已取回，到账 ' + fmt(withdrawAmount) + ' 元');
  }

  // ========================================
  // 管理模式
  // ========================================
  enterManageMode() {
    this.manageModeActive = true;
    this.manageChildId = this.data.currentChild;
    document.getElementById('fb-manageGate').style.display = 'none';
    document.getElementById('fb-manageContent').style.display = 'block';

    const currentChild = this.data.children[this.manageChildId];
    document.getElementById('fb-goalName').value = currentChild.goal?.name || '';
    document.getElementById('fb-goalTarget').value = currentChild.goal?.target || '';
    this.updateDeleteGoalBtn(currentChild);
    this.selectDeductionType('month');
    this.renderDeductionHistory();
    this.renderManageDeposits();
    this.renderChildManageList();
  }

  renderManageDeposits() {
    const child = this.getChild();
    const el = document.getElementById('fb-manageDepositsList');
    if (!el) return;
    if (child.deposits.length === 0) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:6px 0;">暂无定期存款</div>';
      return;
    }
    el.innerHTML = child.deposits.map((d, i) => {
      const settled = d.settledTotal || 0;
      const typeConfig = DEPOSIT_TYPES.find(t => t.id === d.rateType) || { name: d.rateType, rateLabel: d.rateType };
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--background-modifier-border);font-size:13px;">
        <span>📅 ${d.startDate} · <strong>${fmt(d.principal)} 元</strong> · ${typeConfig.rateLabel}</span>
        <span>已结 ${fmt(settled)} 元 <button class="fb-btn fb-btn-danger fb-btn-sm" onclick="window.__fb.withdrawDeposit(${i})" style="margin-left:6px;">取回</button></span>
      </div>`;
    }).join('');
  }

  // ========================================
  // 账户管理
  // ========================================
  renderChildManageList() {
    const el = document.getElementById('fb-childManageList');
    if (!el) return;
    const entries = Object.entries(this.data.children);
    if (entries.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:4px 0;">暂无账户</div>'; return; }
    el.innerHTML = entries.map(([id, c]) => {
      const isCurrent = id === this.data.currentChild;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--background-modifier-border);font-size:13px;">
        <span>${c.emoji} ${c.name} ${isCurrent ? '<span style="color:var(--text-muted);font-size:11px;">(当前)</span>' : ''}</span>
        <div>
          <button class="fb-btn fb-btn-outline fb-btn-sm" onclick="window.__fb.switchChildInManage('${id}')" style="margin-right:4px;">切换</button>
          ${entries.length > 1 ? `<button class="fb-btn fb-btn-danger fb-btn-sm" onclick="window.__fb.confirmDeleteChild('${id}')">删除</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  addChild() {
    const name = document.getElementById('fb-newChildName').value.trim();
    const emoji = document.getElementById('fb-newChildEmoji').value.trim() || '👤';
    if (!name) { this.showToast('请输入账户名称'); return; }
    const id = 'child_' + Date.now();
    this.data.children[id] = createChildData();
    this.data.children[id].name = name;
    this.data.children[id].emoji = emoji;
    this.data.currentChild = id;
    this.manageChildId = id;
    document.getElementById('fb-newChildName').value = '';
    document.getElementById('fb-newChildEmoji').value = '';
    this.saveData().then(() => {
      this.renderChildSwitch();
      this.renderOverview();
      if (document.getElementById('fb-pageDeposits').classList.contains('active')) this.renderDeposits();
      this.renderManageDeposits();
      this.renderChildManageList();
      this.renderDeductionHistory();
      this.showToast('✅ 已新增账户：' + name);
    });
  }

  confirmDeleteChild(id) {
    const child = this.data.children[id];
    if (!child) return;
    if (Object.keys(this.data.children).length <= 1) { this.showToast('至少保留一个账户'); return; }
    this.openModal(`
      <div class="fb-modal-title">⚠️ 删除账户</div>
      <div style="margin-bottom:12px;">
        确定要删除「${child.emoji} ${child.name}」吗？<br>
        <span style="color:var(--text-error);font-size:12px;">该账户的所有定存和记录将被永久删除，不可恢复。</span>
      </div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        <button class="fb-btn fb-btn-danger fb-btn-block" onclick="window.__fb.execDeleteChild('${id}')">确认删除</button>
      </div>
    `);
  }

  async execDeleteChild(id) {
    const child = this.data.children[id];
    if (!child || Object.keys(this.data.children).length <= 1) { this.closeModal(); return; }
    delete this.data.children[id];
    if (this.data.currentChild === id) {
      this.data.currentChild = Object.keys(this.data.children)[0];
    }
    if (this.manageChildId === id) {
      this.manageChildId = this.data.currentChild;
    }
    await this.saveData();
    this.closeModal();
    this.renderChildSwitch();
    this.renderOverview();
    if (document.getElementById('fb-pageDeposits').classList.contains('active')) this.renderDeposits();
    this.renderManageDeposits();
    this.renderChildManageList();
    this.renderDeductionHistory();
    this.showToast('🗑️ 已删除账户');
  }

  switchChildInManage(id) {
    this.data.currentChild = id;
    this.manageChildId = id;
    this.saveData().then(() => {
      this.renderChildSwitch();
      this.renderChildManageList();
      this.renderOverview();
      if (document.getElementById('fb-pageDeposits').classList.contains('active')) this.renderDeposits();
      this.renderManageDeposits();
      this.renderDeductionHistory();
      this.showToast('已切换到：' + this.data.children[id].name);
    });
  }

  // ========================================
  // 扣减
  // ========================================
  selectDeductionType(type) {
    this.deductionType = type;
    document.getElementById('fb-ddTypeMonth').className = type === 'month' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    document.getElementById('fb-ddTypeYear').className = type === 'year' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    this.renderSpecificDepositList();
  }

  selectDeductionMode(mode) {
    this.deductionMode = mode;
    document.getElementById('fb-ddModeProp').className = mode === 'proportional' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    document.getElementById('fb-ddModeSpecific').className = mode === 'specific' ? 'fb-btn fb-btn-primary fb-btn-block' : 'fb-btn fb-btn-outline fb-btn-block';
    document.getElementById('fb-ddSpecificSelect').style.display = mode === 'specific' ? 'block' : 'none';
    if (mode === 'specific') this.renderSpecificDepositList();
  }

  renderSpecificDepositList() {
    const child = this.getChild();
    const deposits = child.deposits.filter(d => d.rateType === this.deductionType);
    const el = document.getElementById('fb-ddSpecificList');
    if (!el) return;
    if (deposits.length === 0) { el.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:6px 0;">该类型无定存</div>'; return; }
    el.innerHTML = deposits.map(d => {
      return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;border-radius:8px;border:1.5px solid ${this.selectedDepositId === d.id ? '#E8730A' : 'var(--background-modifier-border)'};cursor:pointer;" onclick="window.__fb.selectDeductionDeposit(${d.id})">
        <input type="radio" name="fb-ddDeposit" ${this.selectedDepositId === d.id ? 'checked' : ''} style="accent-color:#E8730A;">
        <span>${fmt(d.principal)} 元 · ${d.startDate}</span></label>`;
    }).join('');
  }

  selectDeductionDeposit(id) {
    this.selectedDepositId = id;
    this.renderSpecificDepositList();
  }

  confirmDeduction() {
    const child = this.getChild();
    const reason = document.getElementById('fb-ddReason').value.trim();
    const amount = parseFloat(document.getElementById('fb-ddAmount').value);
    if (!reason) { this.showToast('请输入扣减原因'); return; }
    if (!amount || amount <= 0) { this.showToast('请输入有效金额'); return; }

    const depositsOfType = child.deposits.filter(d => d.rateType === this.deductionType);
    const totalPrincipal = depositsOfType.reduce((s, d) => s + d.principal, 0);
    if (totalPrincipal <= 0) { this.showToast('该类型无定期存款可扣减'); return; }
    const typeConfig = DEPOSIT_TYPES.find(t => t.id === this.deductionType);
    const modeLabel = this.deductionMode === 'proportional' ? '按比例分摊' : '指定某笔';

    if (this.deductionMode === 'specific') {
      if (!this.selectedDepositId) { this.showToast('请先选择要扣减的定存'); return; }
      const targetDeposit = depositsOfType.find(d => d.id === this.selectedDepositId);
      if (!targetDeposit) { this.showToast('选中的定存不存在'); return; }
      if (amount > targetDeposit.principal) { this.showToast('该笔定存只有 ' + fmt(targetDeposit.principal) + ' 元'); return; }
    } else {
      if (amount > totalPrincipal) { this.showToast('该类型定存总额 ' + fmt(totalPrincipal) + ' 元，不足扣减'); return; }
    }

    this.openModal(`
      <div class="fb-modal-title">⚠️ 确认扣减</div>
      <div style="background:#fef0ef;border-radius:10px;padding:14px;margin-bottom:12px;">
        <div style="margin-bottom:6px;">⚔️ 从 <strong>${typeConfig.name}</strong> 中扣减（${modeLabel}）</div>
        <div style="display:flex;justify-content:space-between;"><span>原因</span><span>${reason}</span></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;"><span>扣减金额</span><span style="color:var(--text-error);font-weight:600;">-${fmt(amount)} 元</span></div>
      </div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        <button class="fb-btn fb-btn-danger fb-btn-block" onclick="window.__fb.execDeduction('${reason}',${amount})">确认扣减</button>
      </div>
    `);
  }

  async execDeduction(reason, amount) {
    const child = this.getChild();
    const depositsOfType = child.deposits.filter(d => d.rateType === this.deductionType);
    if (depositsOfType.length === 0) { this.showToast('无定期可扣减'); this.closeModal(); return; }
    const today = new Date().toISOString().slice(0, 10);
    const typeConfig = DEPOSIT_TYPES.find(t => t.id === this.deductionType);

    // 先结算利息
    const affectedDeposits = this.deductionMode === 'proportional' ? depositsOfType : [depositsOfType.find(d => d.id === this.selectedDepositId)].filter(Boolean);
    let settleTotal = 0;
    affectedDeposits.forEach(d => {
      const result = calcInterest(d.principal, d.rate, d.rateType, d.lastSettledDate || d.startDate, today);
      if (result.fullPeriods > 0) {
        d.settledTotal = (d.settledTotal || 0) + result.interest;
        d.lastSettledDate = today;
        settleTotal += result.interest;
      }
    });
    if (settleTotal > 0) {
      child.records.push({ id: Date.now(), date: today, desc: typeConfig.name + '利息结算 (扣减前)', amount: settleTotal, tag: 'interest' });
    }

    // 执行扣减
    const details = [];
    if (this.deductionMode === 'proportional') {
      const totalPrincipal = depositsOfType.reduce((s, d) => s + d.principal, 0);
      depositsOfType.forEach(d => {
        const ratio = d.principal / totalPrincipal;
        const deductAmount = Math.round(amount * ratio * 100) / 100;
        if (deductAmount > 0) {
          d.principal = Math.max(0, Math.round((d.principal - deductAmount) * 100) / 100);
          details.push({ depositId: d.id, deducted: deductAmount });
        }
      });
      const totalDeducted = details.reduce((s, x) => s + x.deducted, 0);
      if (Math.abs(totalDeducted - amount) > 0.01 && depositsOfType.length > 0) {
        const diff = Math.round((amount - totalDeducted) * 100) / 100;
        depositsOfType[depositsOfType.length - 1].principal = Math.max(0, Math.round((depositsOfType[depositsOfType.length - 1].principal - diff) * 100) / 100);
      }
    } else {
      const targetDeposit = depositsOfType.find(d => d.id === this.selectedDepositId);
      if (!targetDeposit) { this.showToast('选中的定存已不存在'); this.closeModal(); return; }
      targetDeposit.principal = Math.max(0, Math.round((targetDeposit.principal - amount) * 100) / 100);
      details.push({ depositId: targetDeposit.id, deducted: amount });
    }

    child.deductions.push({ id: Date.now(), date: today, typeId: this.deductionType, typeName: typeConfig.name, reason, amount, mode: this.deductionMode, details });
    this.recordAssetSnapshot(child, today);

    await this.saveData();
    this.closeModal();
    this.renderDeposits();
    this.renderOverview();
    document.getElementById('fb-ddReason').value = '';
    document.getElementById('fb-ddAmount').value = '';
    this.renderDeductionHistory();
    const settleMsg = settleTotal > 0 ? '（含扣减前利息 ' + fmt(settleTotal) + ' 元）' : '';
    this.showToast('⚠️ 已从' + typeConfig.name + '扣减 ' + fmt(amount) + ' 元' + settleMsg);
  }

  renderDeductionHistory() {
    const child = this.data.children[this.manageChildId];
    const el = document.getElementById('fb-ddHistory');
    if (!el) return;
    const deductions = child.deductions ? [...child.deductions].reverse() : [];
    el.innerHTML = deductions.length === 0
      ? '<div style="font-size:13px;color:var(--text-muted);padding:4px 0;">暂无扣减记录</div>'
      : deductions.map(d => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--background-modifier-border);font-size:13px;">
        <div><span style="font-weight:500;">${d.reason}</span><div style="font-size:11px;color:var(--text-muted);">${d.date} · ${d.typeName} · ${d.mode === 'specific' ? '指定' : '分摊'}</div></div>
        <div style="color:var(--text-error);font-weight:600;">-${fmt(d.amount)} 元</div></div>`).join('');
  }

  // ========================================
  // 目标
  // ========================================
  async setGoal() {
    const child = this.data.children[this.manageChildId];
    const name = document.getElementById('fb-goalName').value.trim();
    const target = parseFloat(document.getElementById('fb-goalTarget').value);
    if (!name) { this.showToast('请输入目标名称'); return; }
    if (!target || target <= 0) { this.showToast('请输入有效的目标金额'); return; }

    child.goal = { name, target };
    await this.saveData();
    this.renderOverview();
    this.updateDeleteGoalBtn(child);
    this.showToast('🎯 目标已设定：' + name + ' ' + fmt(target) + ' 元');
  }

  async deleteGoal() {
    const child = this.data.children[this.data.currentChild];
    if (!child.goal?.name) { this.showToast('暂无目标可删除'); return; }
    const goalName = child.goal.name;
    child.goal = { name: '', target: 0 };
    document.getElementById('fb-goalName').value = '';
    document.getElementById('fb-goalTarget').value = '';
    this.updateDeleteGoalBtn(child);
    await this.saveData();
    this.renderOverview();
    this.showToast('🗑️ 已删除目标「' + goalName + '」');
  }

  updateDeleteGoalBtn(child) {
    const btn = document.getElementById('fb-deleteGoalBtn');
    if (!btn) return;
    const hasGoal = child.goal?.name && child.goal?.target > 0;
    btn.style.display = hasGoal ? 'block' : 'none';
  }

  // ========================================
  // 数据备份
  // ========================================
  async exportData() {
    await this.saveData();
    this.showToast('📥 已同步到 vauit：' + this.getDataPath());
  }

  importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        this.data = mergeDefaults(JSON.parse(e.target.result));
        await this.saveData();
        this.renderChildSwitch();
        this.renderOverview();
        if (document.getElementById('fb-pageDeposits').classList.contains('active')) this.renderDeposits();
        if (this.manageModeActive) {
          this.renderManageDeposits();
          this.renderDeductionHistory();
        }
        this.showToast('📤 数据已导入');
      } catch (err) { this.showToast('导入失败：文件格式错误'); }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  resetAllData() {
    this.openModal(`
      <div class="fb-modal-title">⚠️ 确认清零</div>
      <div style="margin-bottom:12px;font-size:14px;">确定要清除 <strong>所有数据</strong> 吗？此操作不可逆！</div>
      <div class="fb-modal-actions">
        <button class="fb-btn fb-btn-hint fb-btn-block" onclick="window.__fb.closeModal()">取消</button>
        <button class="fb-btn fb-btn-danger fb-btn-block" onclick="window.__fb.execResetAll()">确认清零</button>
      </div>
    `);
  }

  async execResetAll() {
    const defaultId = 'child_' + Date.now();
    this.data = { version: 2, currentChild: defaultId, children: {} };
    this.data.children[defaultId] = createChildData();
    this.data.children[defaultId].name = '默认';
    this.data.children[defaultId].emoji = '👤';
    this.manageModeActive = false;
    this.manageChildId = defaultId;
    await this.saveData();
    this.closeModal();
    document.getElementById('fb-manageGate').style.display = 'block';
    document.getElementById('fb-manageContent').style.display = 'none';
    this.renderChildSwitch();
    this.renderOverview();
    this.renderDeposits();
    this.showToast('🗑️ 所有数据已清零');
  }
}

// ========================================
// Plugin 入口
// ========================================
class FamilyBankPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView('family-bank', (leaf) => new FamilyBankView(leaf, this));
    this.addRibbonIcon('wallet', '家庭银行', () => this.activateView());
    this.addCommand({
      id: 'open-family-bank',
      name: '打开家庭银行',
      callback: () => this.activateView()
    });
    this.addSettingTab(new FamilyBankSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({ dataFilePath: '家庭银行数据.json' }, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType('family-bank');
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: 'family-bank', active: true });
    }
  }

  onunload() {}
}

class FamilyBankSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '家庭银行设置' });

    new obsidian.Setting(containerEl)
      .setName('数据文件路径')
      .setDesc('家庭银行数据保存的 vault 路径（相对于 vault 根目录）')
      .addText(text => text
        .setPlaceholder('家庭银行数据.json')
        .setValue(this.plugin.settings.dataFilePath)
        .onChange(async (value) => {
          this.plugin.settings.dataFilePath = value || '家庭银行数据.json';
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = FamilyBankPlugin;