/* 資產儀表板 — 取數與畫面 */
const App = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NT = (v) => (v == null || isNaN(v)) ? '—' : 'NT$' + Math.round(v).toLocaleString();
  const PCT = (v, d = 1) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(d) + '%';
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const GOLD = '#c9a227', CREAM = '#faf7f0', RED = '#e05b5b', GREEN = '#3ba272', BLUE = '#6ea8dc', GRAY = '#8fa3bd';

  function cfg() {
    try { return JSON.parse(localStorage.getItem('dash_cfg')) || null; } catch (e) { return null; }
  }
  function saveConfig() {
    const url = $('cfgUrl').value.trim(), token = $('cfgToken').value.trim();
    if (!url.includes('script.google.com') || !token) { alert('網址或金鑰格式不對'); return; }
    localStorage.setItem('dash_cfg', JSON.stringify({ url, token }));
    location.reload();
  }
  function reconfig() {
    const c = cfg() || { url: '', token: '' };
    $('cfgUrl').value = c.url; $('cfgToken').value = c.token;
    $('main').style.display = 'none'; $('gate').style.display = 'block';
  }

  async function load() {
    const c = cfg();
    if (!c) { $('gate').style.display = 'block'; return; }
    $('loading').style.display = 'block';
    try {
      const res = await fetch(`${c.url}?run=data&token=${encodeURIComponent(c.token)}`);
      const text = await res.text();
      let b;
      try { b = JSON.parse(text); } catch (e) { throw new Error('回應不是 JSON——通常是金鑰錯誤或還沒授權。原文開頭：' + text.slice(0, 120)); }
      if (!b.ok) throw new Error('API 錯誤：' + (b.error || '?'));
      render(b);
    } catch (e) {
      $('err').style.display = 'block';
      $('err').textContent = '❌ ' + e.message;
    } finally {
      $('loading').style.display = 'none';
    }
  }

  function render(b) {
    $('main').style.display = 'block';
    $('gen').textContent = '資料時間 ' + new Date(b.generated).toLocaleString('zh-TW', { hour12: false });

    const trades = Engine.parseTrades(b.trades);
    const lc = Engine.loanCost(b.settings, b.overview, trades);
    const perf = Engine.monthlyPerf(b.history, b.benchmarks, lc);
    const stocks = Engine.stockStats(trades, b.overview.positions);
    const expM = Engine.expenseMonthly(b.daily);
    const sav = Engine.savingsRate(b.monthly_flow);
    const f = b.futures || {};
    const risk = f.orig_margin ? f.equity / f.orig_margin : null;
    const toLiq = f.orig_margin ? f.equity - 0.25 * f.orig_margin : null;

    // ---- 總覽卡 ----
    const cards = [
      ['含信貸總資產', NT(b.overview.net_inc_loan), '不含信貸 ' + NT(b.overview.net_ex_loan)],
      ['已實現損益', NT(b.overview.realized), '未實現 ' + NT(b.overview.unrealized)],
      ['投資市值', NT(b.overview.mv), '成本 ' + NT(b.overview.cost)],
      ['期貨權益數', NT(f.equity), '合約 ' + NT(f.contract_value)],
      ['期貨風險指標', PCT(risk, 0), risk != null ? ('距代沖銷可虧 ' + NT(toLiq)) : ''],
      ['槓桿利息/月', NT(lc.monthly), `信貸 ${NT(lc.balA + lc.balB)}｜融資 ${NT(lc.marginBal)}`],
    ];
    $('cards').innerHTML = cards.map(([k, v, s]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

    // ---- 資產曲線 ----
    const snaps = b.history.filter(r => r[0]).map(r => ({ d: new Date(r[0]), total: +r[1], mv: +r[4] }));
    mkChart('chAsset', {
      type: 'line',
      data: { labels: snaps.map(s => s.d.toLocaleDateString('zh-TW')), datasets: [
        { label: '含信貸總資產', data: snaps.map(s => s.total), borderColor: GOLD, backgroundColor: 'rgba(201,162,39,.12)', fill: true, pointRadius: 0, tension: .25 },
        { label: '投資總市值', data: snaps.map(s => s.mv), borderColor: BLUE, pointRadius: 0, tension: .25 },
      ]},
    });

    // ---- 月度績效 ----
    mkChart('chMonthly', {
      type: 'bar',
      data: { labels: perf.map(m => m.month), datasets: [
        { label: '投資月報酬', data: perf.map(m => m.ret == null ? null : m.ret * 100), backgroundColor: perf.map(m => (m.ret || 0) >= 0 ? RED : GREEN) },
        { label: '0050', type: 'line', data: perf.map(m => m.tw == null ? null : m.tw * 100), borderColor: CREAM, pointRadius: 2 },
        { label: 'SPY', type: 'line', data: perf.map(m => m.us == null ? null : m.us * 100), borderColor: BLUE, pointRadius: 2 },
      ]},
      options: { scales: { y: { title: { display: true, text: '%' } } } },
    });
    mkChart('chCum', {
      type: 'line',
      data: { labels: perf.map(m => m.month), datasets: [
        { label: '我的累積報酬(TWR)', data: perf.map(m => m.cum * 100), borderColor: GOLD, pointRadius: 0, tension: .2 },
        { label: '0050 累積', data: perf.map(m => m.cumTw * 100), borderColor: CREAM, pointRadius: 0, tension: .2 },
        { label: 'SPY 累積', data: perf.map(m => m.cumUs * 100), borderColor: BLUE, pointRadius: 0, tension: .2 },
      ]},
      options: { scales: { y: { title: { display: true, text: '%' } } } },
    });
    $('tblMonthly').innerHTML = table(
      ['月份', '損益', '報酬率', '0050', 'SPY', 'α(0050)', '利息', '扣息後', '總資產'],
      perf.slice().reverse().map(m => [
        m.month, num(m.pnl), pct(m.ret), pct(m.tw), pct(m.us),
        pct(m.ret != null && m.tw != null ? m.ret - m.tw : null),
        NT(m.interest), pct(m.netRet), NT(m.total),
      ]));

    // ---- 個股表現 ----
    $('tblStocks').innerHTML = table(
      ['標的', '類型', '狀態', '已實現', '未實現', '合計', '年化XIRR', '勝-敗', '持有天數'],
      stocks.map(s => [
        s.item, `<span class="tag">${s.type}</span>`, s.open ? '持倉中' : '已出清',
        num(s.realized), s.open ? num(s.unrealized) : '—', num(s.total),
        s.type === '期貨' ? '—' : xirrTxt(s.xirr),
        `${s.wins}-${s.losses}`, s.days,
      ]));

    // ---- 支出 ----
    const months = Object.keys(expM).sort();
    const cats = [...new Set(months.flatMap(m => Object.keys(expM[m])))];
    const palette = [RED, BLUE, GOLD, GREEN, '#b07aa1', '#f28e2b', GRAY];
    mkChart('chExpense', {
      type: 'bar',
      data: { labels: months, datasets: cats.map((c, i) => ({ label: c, data: months.map(m => expM[m][c] || 0), backgroundColor: palette[i % palette.length], stack: 's' })) },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } },
    });
    $('tblSavings').innerHTML = table(
      ['結算月', '薪資', '當月總支出', '結餘'],
      sav.slice().reverse().map(r => [r.month, NT(r.salary), NT(r.spend), num(r.salary - r.spend)]));
  }

  // ---- 小工具 ----
  const charts = {};
  function mkChart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const user = (cfg.options || {}).scales || {};
    const axis = (extra) => Object.assign({ ticks: { color: GRAY }, grid: { color: '#22405f' } }, extra || {});
    cfg.options = Object.assign({}, cfg.options, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: CREAM } } },
      scales: { x: axis(user.x), y: axis(user.y) },
    });
    charts[id] = new Chart($(id), cfg);
  }
  function table(head, rows) {
    return `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  }
  const num = (v) => v == null ? '—' : `<span class="${cls(v)}">${Math.round(v).toLocaleString()}</span>`;
  const pct = (v) => v == null ? '—' : `<span class="${cls(v)}">${(v * 100).toFixed(1)}%</span>`;
  const xirrTxt = (r) => r == null ? '—' : Math.abs(r) > 9.99 ? `<span class="${cls(r)}">${r > 0 ? '>' : '<-'}999%</span>` : `<span class="${cls(r)}">${(r * 100).toFixed(0)}%</span>`;

  load();
  return { saveConfig, reconfig };
})();
