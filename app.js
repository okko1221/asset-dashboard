/* 資產儀表板 — 取數與畫面 */
const App = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NT = (v) => (v == null || isNaN(v)) ? '—' : 'NT$' + Math.round(v).toLocaleString();
  const PCT = (v, d = 1) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(d) + '%';
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const sign = (v) => (v == null || isNaN(v)) ? '—' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString();
  const px = (v) => v == null || isNaN(v) ? '—' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(4);
  const GOLD = '#c9a227', CREAM = '#faf7f0', GRAY = '#8fa3bd';
  // 分類色（深藍底通過色彩驗證；顏色跟著資產類別走，不輪替）
  const C = { '台股': '#dd5555', '美股': '#3d8fd6', '期貨': '#b3880f', '期貨曝險': '#b3880f', '現金': '#28a065', '虛擬貨幣': '#b55cc2' };
  const kc = (k) => C[k] || GRAY;

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
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!c && !local) { $('gate').style.display = 'block'; return; }
    $('err').style.display = 'none';
    $('loading').style.display = 'block';
    try {
      const url = c ? `${c.url}?run=data&token=${encodeURIComponent(c.token)}` : 'test_bundle.json'; // 本機開發用真實快照
      const res = await fetch(url);
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
    const lc = Engine.loanCost(b.settings, b.overview);
    const perf = Engine.monthlyPerf(b.history, b.benchmarks, lc);
    const stocks = Engine.stockStats(trades, b.overview.positions);
    const expM = Engine.expenseMonthly(b.daily);
    const sav = Engine.savingsRate(b.monthly_flow);
    const days = Engine.dailySeries(b.history);
    const ty = Engine.todayYesterday(b.overview, days);
    const dd = Engine.drawdownSeries(days, b.overview);
    const alloc = Engine.allocation(b.overview, b.futures);
    const conc = Engine.concentration(b.overview, b.futures);
    const ci = Engine.cashInfo(b.overview, b.monthly_flow, b.bank_accounts);
    const fr = Engine.futuresRisk(b.futures);
    const hold = Engine.holdings(b.overview, b.yesterday);
    const frows = Engine.futuresRows(b.futures, b.yesterday);
    const f = b.futures || {};
    const tfmt = (d) => new Date(d).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

    // ---- 總覽卡 ----
    const riskColor = fr && (fr.risk < 1.25 ? 'var(--up)' : fr.risk < 1.5 ? 'var(--gold)' : '');
    const cards = [
      ['含信貸總資產', NT(b.overview.net_inc_loan), '不含信貸 ' + NT(b.overview.net_ex_loan), '', 'hero'],
      ['今日投資損益', ty ? `<span class="${cls(ty.today)}">${sign(ty.today)}</span>` : '—',
        ty ? `昨日 <span class="${cls(ty.yesterday)}">${sign(ty.yesterday)}</span>｜基準 ${tfmt(ty.todayBaseAt)}` : ''],
      ['未實現損益', `<span class="${cls(b.overview.unrealized)}">${sign(b.overview.unrealized)}</span>`, '已實現 ' + NT(b.overview.realized)],
      ['現金水位', NT(ci.cash), ci.months ? `可撐 ${ci.months.toFixed(1)} 個月（月支出約 ${NT(ci.monthlySpend)}）` : ''],
      ['投資市值', NT(b.overview.mv), '成本 ' + NT(b.overview.cost)],
      ['期貨風險指標', fr ? `<span style="color:${riskColor}">${PCT(fr.risk, 0)}</span>` : '—',
        fr ? `距警戒線125% 可虧 ${NT(fr.toWarn)}` : ''],
      ['保證金使用率', fr ? PCT(fr.marginUtil, 0) : '—', fr ? `原始保證金 ${NT(f.orig_margin)}` : ''],
      ['槓桿利息/月', NT(lc.monthly), `信貸 ${NT(lc.balA + lc.balB)}｜融資 ${NT(lc.marginBal)}`],
      ['最大回撤', `<span class="${cls(dd.maxDD)}">${PCT(dd.maxDD)}</span>`, `目前距峰值 <span class="${cls(dd.current)}">${PCT(dd.current)}</span>`],
    ];
    $('cards').innerHTML = cards.map(([k, v, s, _, extra]) =>
      `<div class="card ${extra || ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

    // ---- 持股明細 ----
    $('holdNote').textContent = b.yesterday ? `當日漲跌基準：${tfmt(b.yesterday.at)}` : '當日漲跌明天起提供（今晚起每日 6:00 存收盤基準）';
    $('tblHold').innerHTML = table(
      ['標的', '股數', '成本價', '現價', '當日漲跌', '市值', '占比', '未實現', '報酬率'],
      hold.map(h => [
        `${h.item}<span class="tag">${h.type}</span>`,
        h.qty.toLocaleString(), px(h.avg), px(h.price),
        h.dayPct == null ? '—' : `<span class="${cls(h.dayPct)}">${(h.dayPct > 0 ? '+' : '') + PCT(h.dayPct)}<br><small>${sign(h.dayNt)}</small></span>`,
        NT(h.mv),
        `<span style="background:linear-gradient(90deg,rgba(61,143,214,.28) ${Math.round(h.weight * 100)}%,transparent ${Math.round(h.weight * 100)}%);border-radius:4px;padding:1px 5px">${PCT(h.weight, 0)}</span>`,
        num(h.pl), pct(h.plPct),
      ]));

    // ---- 損益貢獻（近30天，資料自部位歷史累積）----
    const cutoff = new Date(Date.now() - 30 * 86400000);
    const cutoffDay = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    const contrib = Engine.contribution(b.pos_history, b.overview, cutoffDay);
    const histDays = [...new Set((b.pos_history || []).map(r => String(r[0])))];
    if (histDays.length < 2) {
      $('pnlContrib').innerHTML = `<div class="note">資料累積中——每天早上 6:00 存一次部位快照，明天起這裡會顯示每檔的損益貢獻排行（目前 ${histDays.length} 天）。</div>`;
    } else {
      $('contribNote').textContent = `近30天，資料自 ${histDays[0]} 起`;
      mkChart('chContrib', {
        type: 'bar',
        data: { labels: contrib.map(c => c.item), datasets: [{
          label: '損益貢獻',
          data: contrib.map(c => c.pnl),
          backgroundColor: contrib.map(c => c.pnl >= 0 ? '#e05b5b' : '#3ba272'),
          borderRadius: 4,
        }]},
        options: { indexAxis: 'y', plugins: { legend: { display: false } } },
      });
    }

    // ---- 期貨 ----
    if (fr) {
      const scaleMax = Math.max(250, Math.ceil(fr.risk * 100 + 30));
      const stops = [25, Math.round(fr.maintPct * 100), 125, scaleMax];
      const zoneCol = ['#7d2f2f', '#a84f3f', '#b3880f', '#28a065'];
      let prev = 0;
      const zones = stops.map((s, i) => { const w = (s - prev) / scaleMax * 100; prev = s; return `<i style="width:${w}%;background:${zoneCol[i]}"></i>`; }).join('');
      const lab = (v, t) => `<span style="left:${v / scaleMax * 100}%">${t}</span>`;
      $('futRisk').innerHTML = `
        <div class="k" style="color:var(--mut);font-size:12px">風險指標＝權益數 ÷ 原始保證金</div>
        <div class="bignum" style="color:${riskColor || 'var(--cream)'}">${PCT(fr.risk, 0)}</div>
        <div class="meter">${zones}<div class="needle" style="left:${Math.min(99, fr.risk * 100 / scaleMax * 100)}%"></div></div>
        <div class="scalelab">${lab(25, '代沖銷25%')}${lab(fr.maintPct * 100, '追繳' + Math.round(fr.maintPct * 100) + '%')}${lab(125, '警戒125%')}</div>
        <div class="risk-lines">
          <div>距警戒線 125% 可虧 <b class="${cls(fr.toWarn)}">${NT(fr.toWarn)}</b></div>
          <div>距追繳（權益＜維持保證金）可虧 <b>${NT(fr.toCall)}</b></div>
          <div>距代沖銷 25% 可虧 <b>${NT(fr.toLiq)}</b></div>
          <div>保證金使用率（原始/權益） <b>${PCT(fr.marginUtil, 0)}</b></div>
          <div class="bars"><div class="row"><div class="bar"><i style="width:${Math.min(100, fr.marginUtil * 100)}%;background:${fr.marginUtil > .7 ? 'var(--up)' : 'var(--gold)'}"></i></div></div></div>
          <div>權益數 <b>${NT(f.equity)}</b></div>
          <div>可出金 <b>${NT(f.withdrawable)}</b></div>
          <div>合約價值（曝險） <b>${NT(f.contract_value)}</b></div>
        </div>`;
    } else {
      $('futRisk').innerHTML = '<div class="note">沒有期貨資料</div>';
    }
    $('tblFut').innerHTML = table(
      ['商品', '均價', '數量', '現值', '當日', '未平倉損益'],
      frows.map(r => [r.name, px(r.avg), r.qty.toLocaleString(), NT(r.value),
        r.dayNt == null ? '—' : `<span class="${cls(r.dayNt)}">${sign(r.dayNt)}</span>`, num(r.pl)]))
      + `<div class="note">未平倉合計 ${sign(frows.reduce((s, r) => s + r.pl, 0))}</div>`;

    // ---- 資產配置（圓餅）＋現金明細＋集中度 ----
    const aKeys = Object.keys(alloc).filter(k => alloc[k] > 0);
    const aTotal = aKeys.reduce((s, k) => s + alloc[k], 0);
    mkChart('chAlloc', {
      type: 'doughnut',
      data: {
        labels: aKeys.map(k => `${k} ${PCT(alloc[k] / aTotal, 0)}`),
        datasets: [{ data: aKeys.map(k => alloc[k]), backgroundColor: aKeys.map(kc), borderColor: '#1f3a5f', borderWidth: 2 }],
      },
      options: {
        cutout: '58%',
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${NT(c.parsed)}` } } },
      },
    });
    const cashBars = ci.accounts.slice().sort((a, b) => b.v - a.v).map(a => barRow(a.name, a.v / (ci.cash || 1), NT(a.v), kc('現金'))).join('');
    const concBars = conc.list.slice(0, 7).map(x => barRow(x.name, x.share, `${PCT(x.share, 0)}｜${NT(x.v)}`, kc(x.kind))).join('');
    $('pnlConc').innerHTML = `
      <div class="k" style="color:var(--mut);font-size:12px">持股集中度（股票市值＋期貨現值）</div>
      <div style="font-size:20px;font-weight:700;margin:4px 0 6px">前五大占 ${PCT(conc.top5, 0)}</div>
      <div class="bars">${concBars}</div>
      <div class="k" style="color:var(--mut);font-size:12px;margin-top:14px">現金明細（合計 ${NT(ci.cash)}）</div>
      <div class="bars">${cashBars}</div>`;

    // ---- 資產曲線 ----
    const snaps = b.history.filter(r => r[0]).map(r => ({ d: new Date(r[0]), total: +r[1], mv: +r[4] }));
    mkChart('chAsset', {
      type: 'line',
      data: { labels: snaps.map(s => s.d.toLocaleDateString('zh-TW')), datasets: [
        { label: '含信貸總資產', data: snaps.map(s => s.total), borderColor: GOLD, backgroundColor: 'rgba(201,162,39,.12)', fill: true, pointRadius: 0, tension: .25, borderWidth: 2 },
        { label: '投資總市值', data: snaps.map(s => s.mv), borderColor: '#3d8fd6', pointRadius: 0, tension: .25, borderWidth: 2 },
      ]},
    });

    // ---- 回撤曲線 ----
    mkChart('chDD', {
      type: 'line',
      data: { labels: dd.series.map(p => p.day), datasets: [
        { label: '距峰值回撤', data: dd.series.map(p => p.dd * 100), borderColor: '#dd5555', backgroundColor: 'rgba(221,85,85,.18)', fill: 'origin', pointRadius: 0, tension: .15, borderWidth: 2 },
      ]},
      options: { scales: { y: { max: 0, title: { display: true, text: '%' } } } },
    });
    $('ddNote').textContent = `歷史最大回撤 ${PCT(dd.maxDD)}（依日報酬 TWR 計算，對入金免疫）｜目前距峰值 ${PCT(dd.current)}`;

    // ---- 月度績效 ----
    mkChart('chMonthly', {
      type: 'bar',
      data: { labels: perf.map(m => m.month), datasets: [
        { label: '投資月報酬', data: perf.map(m => m.ret == null ? null : m.ret * 100), backgroundColor: perf.map(m => (m.ret || 0) >= 0 ? '#e05b5b' : '#3ba272'), borderRadius: 4 },
        { label: '0050', type: 'line', data: perf.map(m => m.tw == null ? null : m.tw * 100), borderColor: CREAM, pointRadius: 2, borderWidth: 2 },
        { label: 'SPY', type: 'line', data: perf.map(m => m.us == null ? null : m.us * 100), borderColor: '#3d8fd6', pointRadius: 2, borderWidth: 2 },
      ]},
      options: { scales: { y: { title: { display: true, text: '%' } } } },
    });
    mkChart('chCum', {
      type: 'line',
      data: { labels: perf.map(m => m.month), datasets: [
        { label: '我的累積報酬(TWR)', data: perf.map(m => m.cum * 100), borderColor: GOLD, pointRadius: 0, tension: .2, borderWidth: 2 },
        { label: '0050 累積', data: perf.map(m => m.cumTw * 100), borderColor: CREAM, pointRadius: 0, tension: .2, borderWidth: 2 },
        { label: 'SPY 累積', data: perf.map(m => m.cumUs * 100), borderColor: '#3d8fd6', pointRadius: 0, tension: .2, borderWidth: 2 },
      ]},
      options: { scales: { y: { title: { display: true, text: '%' } } } },
    });
    const cf = Engine.vs0050(perf);
    mkChart('chVs', {
      type: 'line',
      data: { labels: cf.map(m => m.month), datasets: [
        { label: '我的累積損益', data: cf.map(m => m.mine), borderColor: GOLD, backgroundColor: 'rgba(201,162,39,.10)', fill: true, pointRadius: 2, tension: .2, borderWidth: 2 },
        { label: '全買 0050', data: cf.map(m => m.tw), borderColor: CREAM, pointRadius: 2, tension: .2, borderWidth: 2, borderDash: [6, 4] },
      ]},
      options: { scales: { y: { ticks: { callback: (v) => (v / 10000) + '萬' } } } },
    });
    $('tblMonthly').innerHTML = table(
      ['月份', '損益', '報酬率', '0050', 'SPY', 'α(0050)', '利息', '扣息後', '總資產'],
      perf.slice().reverse().map(m => [
        m.month, num(m.pnl), pct(m.ret), pct(m.tw), pct(m.us),
        pct(m.ret != null && m.tw != null ? m.ret - m.tw : null),
        NT(m.interest), pct(m.netRet), NT(m.total),
      ]));

    // ---- 個股歷史績效 ----
    $('tblStocks').innerHTML = table(
      ['標的', '類型', '狀態', '已實現', '未實現', '合計', '年化XIRR', '勝-敗', '持有天數'],
      stocks.map(s => [
        s.item, `<span class="tag" style="margin-left:0">${s.type}</span>`, s.open ? '持倉中' : '已出清',
        num(s.realized), s.open ? num(s.unrealized) : '—', num(s.total),
        s.type === '期貨' ? '—' : xirrTxt(s.xirr),
        `${s.wins}-${s.losses}`, s.days,
      ]));

    // ---- 支出 ----
    const months = Object.keys(expM).sort();
    const cats = [...new Set(months.flatMap(m => Object.keys(expM[m])))];
    const palette = ['#dd5555', '#3d8fd6', '#b3880f', '#28a065', '#b55cc2', '#c96a2c', GRAY];
    mkChart('chExpense', {
      type: 'bar',
      data: { labels: months, datasets: cats.map((c, i) => ({ label: c, data: months.map(m => expM[m][c] || 0), backgroundColor: palette[i % palette.length], stack: 's', borderRadius: 3 })) },
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
    const up = (cfg.options || {}).plugins || {};
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: Object.assign({}, up, {
        legend: Object.assign({}, up.legend, { labels: Object.assign({ color: CREAM, boxWidth: 14 }, (up.legend || {}).labels) }),
      }),
    };
    if (cfg.type !== 'doughnut') {
      const user = (cfg.options || {}).scales || {};
      const axis = (extra) => {
        const merged = Object.assign({ ticks: { color: GRAY }, grid: { color: '#22405f' } }, extra || {});
        if (merged.title) merged.title = Object.assign({ color: GRAY }, merged.title);
        return merged;
      };
      base.scales = { x: axis(user.x), y: axis(user.y) };
      base.interaction = { mode: 'index', intersect: false };
    }
    cfg.options = Object.assign({}, cfg.options, base);
    charts[id] = new Chart($(id), cfg);
  }
  function table(head, rows) {
    return `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  }
  const barRow = (name, share, val, color) =>
    `<div class="row"><div class="name" title="${name}">${name}</div><div class="bar"><i style="width:${Math.min(100, share * 100).toFixed(1)}%;background:${color}"></i></div><div class="val">${val}</div></div>`;
  const num = (v) => v == null ? '—' : `<span class="${cls(v)}">${Math.round(v).toLocaleString()}</span>`;
  const pct = (v) => v == null ? '—' : `<span class="${cls(v)}">${(v * 100).toFixed(1)}%</span>`;
  const xirrTxt = (r) => r == null ? '—' : Math.abs(r) > 9.99 ? `<span class="${cls(r)}">${r > 0 ? '>' : '<-'}999%</span>` : `<span class="${cls(r)}">${(r * 100).toFixed(0)}%</span>`;

  load();
  return { saveConfig, reconfig, reload: load };
})();
