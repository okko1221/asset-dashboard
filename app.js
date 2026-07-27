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
    const dd = Engine.drawdownSeries(days, b.overview);
    const alloc = Engine.allocation(b.overview, b.futures);
    const conc = Engine.concentration(b.overview, b.futures);
    const ci = Engine.cashInfo(b.overview, b.monthly_flow, b.bank_accounts);
    const fr = Engine.futuresRisk(b.futures);
    const hold = Engine.holdings(b.overview, b.yesterday);
    const frows = Engine.futuresRows(b.futures, b.yesterday);
    const f = b.futures || {};
    const md = Engine.marketDaily(b.overview, b.futures, b.pos_history);
    const rt = Engine.realizedToday(trades);
    const lv = Engine.leverage(b.overview);
    const tfmt = (d) => new Date(d).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

    // ---- 總覽卡（第4欄=小驚嘆號說明文字）----
    const riskColor = fr && (fr.risk < 1.25 ? 'var(--up)' : fr.risk < 1.5 ? 'var(--gold)' : '');
    const cards = [
      ['含信貸總資產', NT(b.overview.net_inc_loan), '不含信貸 ' + NT(b.overview.net_ex_loan), '', 'hero'],
      ['台股' + (md.tw ? md.tw.label : '今日'), mdCell(md.tw), mdSub(md, md.tw, '台股 09:00–13:30'),
        '基準＝當日 06:00 部位快照（台股還沒開盤，等於昨天的收盤價）。所以收盤後、晚上看信時，這個數字就是今天台股一整天的結果。含台股個股與股票期貨（期貨有夜盤，會一路算到隔天清晨）。算的是持倉的市場波動，當天買賣造成的已實現損益不含在內。'],
      ['美股' + (md.us ? md.us.label : ''), mdCell(md.us), mdSub(md, md.us, '美股 21:30–04:00'),
        '美股開盤中（21:30 後）顯示「今晚」＝現價 vs 今日 06:00；美股收盤後顯示「昨夜」＝今日 06:00 vs 昨日 06:00，也就是完整一場美股的結果——早上起床看到的就是這個。美元部位已用匯率換算成台幣。'],
      ['今日已實現',
        rt.hasToday ? `<span class="${cls(rt.day)}">${sign(rt.day)}</span>` : '<span style="color:#5c728c;font-size:22px">今日無平倉</span>',
        `本月 ${NT(rt.month)}` + (rt.lastDay && !rt.hasToday ? `｜最近平倉 ${rt.lastDay.slice(5).replace('-', '/')} ${NT(rt.lastPnl)}` : ''),
        '當天賣出、期貨平倉真正結算掉的損益（交易紀錄的「已實現損益」欄按日加總）。\n\n' +
        '跟左邊兩張互補、不重疊：台股今日／美股今晚算的是「還抱著的部位漲跌」，這張算的是「已經賣掉入袋的」。\n\n' +
        '對帳單多半晚上 19:50／21:30 那兩班才收得到，所以盤中看到「今日無平倉」也可能只是還沒寄來——副標會顯示最近一次平倉是哪天。'],
      ['未實現損益', `<span class="${cls(b.overview.unrealized)}">${sign(b.overview.unrealized)}</span>`, '已實現 ' + NT(b.overview.realized)],
      ['現金水位', NT(ci.cash), ci.months ? `可撐 ${ci.months.toFixed(1)} 個月（月支出約 ${NT(ci.monthlySpend)}）` : '',
        '可撐月數＝現金 ÷ 近 6 個完整月支出的中位數。故意不算收入——它回答的是「收入中斷時能活多久」的生存底線；有收入時實際能撐更久。'],
      ['投資市值', NT(b.overview.mv), '成本 ' + NT(b.overview.cost)],
      ['期貨風險指標', fr ? `<span style="color:${riskColor}">${PCT(fr.risk, 0)}</span>` : '—',
        fr ? `距警戒線125% 可虧 ${NT(fr.toWarn)}${f.margin_asof ? `<br><span style="color:#5c728c">保證金為 ${f.margin_asof} 的值</span>` : ''}` : '',
        '權益數 ÷ 原始保證金，愈高愈安全。三條線：125% 自設警戒；權益跌破維持保證金（約77%）券商追繳；25% 強制代沖銷。\n\n注意：分子（權益數）是即時的，分母（保證金）是期交所訂的、只有對帳單來才會更新。沒交易的日子保證金會過期，這時風險指標會偏樂觀——副標有標示保證金的日期，差太多就用 ?run=setmargin 從 App 抄一次。'],
      ['保證金使用率', fr ? PCT(fr.marginUtil, 0) : '—', fr ? `原始保證金 ${NT(f.orig_margin)}` : '',
        '原始保證金 ÷ 權益數＝期貨戶裡的錢被部位「佔用」的比例，剩下的才是吸收虧損的緩衝。使用率愈高，同樣的行情波動愈快把你推向追繳。'],
      ['槓桿倍數', lv.xEx == null ? '—' : lv.xEx.toFixed(2) + '<span style="font-size:13px">x</span>',
        `曝險 ${NT(lv.exposure)}<br>含信貸 ${lv.xInc == null ? '—' : lv.xInc.toFixed(2)}x`,
        '曝險部位 ÷ 淨資產。\n\n「不含信貸」＝真正屬於你的錢被放大幾倍（現在 ' +
        (lv.xEx == null ? '—' : lv.xEx.toFixed(2)) + 'x）——這才是你自己承擔的風險倍數。\n' +
        '「含信貸」＝把借來的錢也當自有資金看（銀行的角度）。\n\n' +
        '曝險部位用投資市值計，期貨以合約價值計入市值。'],
      ['槓桿利息/月', NT(lc.monthly), `信貸 ${NT(lc.balA + lc.balB)}｜融資 ${NT(lc.marginBal)}`],
      ['最大回撤', `<span class="${cls(dd.maxDD)}">${PCT(dd.maxDD)}</span>`, `目前距峰值 <span class="${cls(dd.current)}">${PCT(dd.current)}</span>`,
        '投資淨值（含已實現＋未實現）從歷史最高點回吐的最大幅度，已剔除入金影響。這是風險刻度：這套打法最糟時你得吞得下這麼多浮虧。'],
    ];
    $('cards').innerHTML = cards.map(([k, v, s, tip, extra]) =>
      `<div class="card ${extra || ''}"><div class="k">${k}${tip ? infoI(tip) : ''}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

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
        // 快照存的是資產總覽 A12（CELL_TOTAL）＝不含信貸——標籤曾寫成「含信貸」誤導了半年
        { label: '不含信貸總資產', data: snaps.map(s => s.total), borderColor: GOLD, backgroundColor: 'rgba(201,162,39,.12)', fill: true, pointRadius: 0, tension: .25, borderWidth: 2 },
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

    // ---- 期間報告（半年報／年報）----
    const thisYear = new Date().getFullYear();
    const PERIODS = [
      ['今年至今', `${thisYear}-01-01`, `${thisYear}-12-31`],
      ['上半年', `${thisYear}-01-01`, `${thisYear}-06-30`],
      ['下半年', `${thisYear}-07-01`, `${thisYear}-12-31`],
      ['近一年', ymd(new Date(Date.now() - 365 * 86400000)), `${thisYear}-12-31`],
      ['全部', '2000-01-01', '2099-12-31'],
    ];
    window.__rep = { history: b.history, bench: b.benchmarks };
    $('periodPick').innerHTML = PERIODS.map(([n, f, t], i) =>
      `<button class="toggle ${i === 0 ? 'on' : ''}" data-i="${i}" onclick="App.pickPeriod(${i},'${f}','${t}','${n}')">${n}</button>`).join(' ');
    renderPeriod(PERIODS[0][1], PERIODS[0][2], PERIODS[0][0]);

    // ---- 年度績效 ----
    const yrs = Engine.yearlyPerf(trades);
    $('tblYearly').innerHTML = table(
      ['年度', '已實現損益', '交易次數',
        '勝率' + infoI('這一年賣出的交易裡，賺錢的佔幾 %。只看賺或賠，不看金額大小。\n\n' +
          '⚠️ 勝率高不等於有賺：贏九次各賺 100、輸一次賠 2000，勝率是 90%，但實際上是虧的。\n\n' +
          '一定要跟旁邊的「獲利因子」一起看。'),
        '獲利因子' + infoI('所有賺錢交易的總金額 ÷ 所有賠錢交易的總金額。\n\n' +
          '1.0 ＝ 賺賠打平；1.5 以上是機構常用的穩健門檻；2.0 代表每賠 1 元就賺回 2 元。\n\n' +
          '它比勝率誠實：勝率高但獲利因子低，代表你常常小賺、偶爾大賠。'),
        '平均賺', '平均賠', '最佳', '最差'],
      yrs.slice().reverse().map(y => [
        `<b>${y.year}</b>`, num(y.pnl), y.trades, pct(y.winRate),
        y.profitFactor == null ? '—'
          : `<span class="${y.profitFactor >= 1.5 ? 'pos' : y.profitFactor >= 1 ? '' : 'neg'}">${y.profitFactor.toFixed(2)}</span>`,
        NT(y.avgWin), NT(-y.avgLoss),
        y.best ? `${y.best.item} ${sign(y.best.v)}` : '—',
        y.worst ? `${y.worst.item} ${sign(y.worst.v)}` : '—',
      ]));
    $('yearDetail').innerHTML = yrs.slice().reverse().map(y => {
      const kinds = Object.keys(y.byType).sort((a, b) => y.byType[b] - y.byType[a]);
      return `<div style="padding:9px 0;border-bottom:1px solid rgba(44,74,115,.5)">
        <b>${y.year}</b> <span class="${cls(y.pnl)}">${sign(y.pnl)}</span>
        <span style="color:var(--mut);font-size:12px">　${kinds.map(k => `${k} ${sign(y.byType[k])}`).join('　')}</span>
        <div style="font-size:12.5px;color:var(--sub);margin-top:3px">
          最賺 ${y.top.map(x => `${x.item} ${sign(x.v)}`).join('、') || '—'}
          ／ 最賠 ${y.bottom.map(x => `${x.item} ${sign(x.v)}`).join('、') || '—'}</div></div>`;
    }).join('');

    // ---- 個股歷史績效（只顯示前十大賺賠，其餘收合）----
    const stockRow = s => [
      s.item, `<span class="tag" style="margin-left:0">${s.type}</span>`, s.open ? '持倉中' : '已出清',
      num(s.realized), s.open ? num(s.unrealized) : '—', num(s.total),
      s.type === '期貨' ? '—' : xirrTxt(s.xirr), `${s.wins}-${s.losses}`, s.days,
    ];
    const HEAD = ['標的', '類型', '狀態', '已實現', '未實現', '合計',
      '年化XIRR' + infoI('把每一筆錢「什麼時候投入、什麼時候拿回來」都算進去，換算成「等於一年賺幾 %」。\n\n' +
        '跟單純的報酬率不一樣：它會把時間長短和分批進出考慮進去。\n\n' +
        '例：投 10 萬、三個月後拿回 11 萬 → 報酬率是 10%，但年化 XIRR 約 46%（因為只花了三個月）。' +
        '反過來，抱五年才賺 10%，年化 XIRR 只剩 2% 左右。\n\n' +
        '期貨不算這個（沒有明確的投入本金）。'),
      '勝-敗' + infoI('這一檔你賣出過幾次是賺的、幾次是賠的。\n\n' +
        '例：3-1 ＝ 總共賣出四次，三次賺、一次賠。\n\n' +
        '只算「已經賣掉」的部分，還抱在手上的不列入；同一檔分批賣出會分開計算。'),
      '持有天數'];
    const top10 = stocks.slice(0, 10), bot10 = stocks.slice(-10).reverse();
    const midCount = Math.max(0, stocks.length - 20);
    $('tblStocks').innerHTML =
      `<div class="note" style="margin:0 0 6px">共 ${stocks.length} 檔　賺最多前 10</div>` +
      table(HEAD, top10.map(stockRow)) +
      (midCount ? `<div style="margin:12px 0 6px"><button class="toggle" onclick="App.toggleStocks()">
         ▾ 展開中間 ${midCount} 檔</button></div>
         <div id="stocksMid" style="display:none">${table(HEAD, stocks.slice(10, -10).map(stockRow))}</div>` : '') +
      `<div class="note" style="margin:14px 0 6px">賠最多前 10</div>` +
      table(HEAD, bot10.map(stockRow));

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
      ['月份', '收入', '總支出', '其中大筆', '結餘', '儲蓄率'],
      sav.slice().reverse().map(r => [r.month, NT(r.salary), NT(r.spend), NT(r.big),
        r.salary ? num(r.salary - r.spend) : '—', r.salary ? pct(r.rate) : '—']));
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
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function renderPeriod(from, to, name) {
    const s = window.__rep;
    const r = Engine.periodReport(s.history, s.bench, from, to);
    if (!r) { $('periodReport').innerHTML = '<div class="note">這段期間的快照不足 3 天，算不出來。</div>'; return; }
    const cell = (k, v, tip) => `<div><div class="k">${k}</div><div class="v">${v}</div>${tip ? `<div class="s">${tip}</div>` : ''}</div>`;
    const lowCov = r.coverage != null && r.coverage < 0.8;
    $('periodReport').innerHTML = `
      <div style="font-size:13px;color:var(--sub);margin-bottom:10px">
        <b style="color:var(--gold)">${name}</b>　${r.from} ~ ${r.to}　
        <span style="color:var(--mut)">${r.days} 個快照 / ${r.calDays} 天</span>
        ${lowCov ? `<span class="neg">　⚠️ 涵蓋度 ${PCT(r.coverage, 0)}，波動與 Sharpe 會偏高</span>` : ''}
      </div>
      <div class="repgrid">
        ${cell('期間損益', `<span class="${cls(r.pnl)}">${sign(r.pnl)}</span>`, '已實現＋未實現變化')}
        ${cell('TWR 報酬率', `<span class="${cls(r.twr)}">${PCT(r.twr)}</span>`, `年化 ${PCT(r.annualized)}`)}
        ${cell('vs 0050', r.alphaTw == null ? '—' : `<span class="${cls(r.alphaTw)}">${PCT(r.alphaTw)}</span>`,
          r.tw == null ? '' : `0050 ${PCT(r.tw)}`)}
        ${cell('vs SPY', r.alphaUs == null ? '—' : `<span class="${cls(r.alphaUs)}">${PCT(r.alphaUs)}</span>`,
          r.us == null ? '' : `SPY ${PCT(r.us)}`)}
        ${cell('年化波動', PCT(r.vol, 0), lowCov ? '快照不足，偏高' : '日報酬標準差×√252')}
        ${cell('Sharpe' + infoI('夏普值：每承受一單位風險，換到多少報酬。\n\n' +
          '算法是（這段期間的報酬率 − 無風險利率 1.5%）÷ 波動度。\n\n' +
          '1 以上算不錯、2 以上很好、小於 0 代表還不如放定存。\n\n' +
          '同樣是賺 20%，一路平穩的 Sharpe 會遠高於大起大落的——它衡量的是「賺得穩不穩」。\n\n' +
          '⚠️ 快照涵蓋度不足時這個值會被高估（不足時上方會標示）。'),
          r.sharpe == null ? '—' : r.sharpe.toFixed(2), '每單位風險的超額報酬')}
        ${cell('期間最大回撤', `<span class="${cls(r.maxDD)}">${PCT(r.maxDD)}</span>`,
          r.calmar == null ? '' : `Calmar ${r.calmar.toFixed(2)}`)}
        ${cell('上漲天數', `${r.winDays}/${r.totalDays}`, PCT(r.dayWinRate, 0) + ' 的日子是賺的')}
        ${cell('最好的一天', r.best ? `<span class="pos">${PCT(r.best.r)}</span>` : '—', r.best ? r.best.day : '')}
        ${cell('最差的一天', r.worst ? `<span class="neg">${PCT(r.worst.r)}</span>` : '—', r.worst ? r.worst.day : '')}
      </div>`;
  }

  function pickPeriod(i, f, t, n) {
    document.querySelectorAll('#periodPick .toggle').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
    renderPeriod(f, t, n);
  }

  // 分市場損益卡：沒有基準資料時老實說「累積中」，不要顯示假的 0
  const mdCell = (m) => (!m || !m.counted) ? '<span style="font-size:15px;color:#8fa3bd">累積中</span>'
    : `<span class="${cls(m.pnl)}">${sign(m.pnl)}</span>`;
  const mdSub = (md, m, hours) => {
    if (!m || !m.counted) return '每日 06:00 存基準，明早起可用';
    const bits = [`基準 ${m.base}<span style="color:#5c728c"> ${m.baseTime || '(時間未記錄)'}</span>`];
    if (m.live) bits.push('<span style="color:#c9a227">盤中</span>');
    if (m.changed && m.changed.length) bits.push(`${m.changed.join('、')} 今日有進出，未計入`);
    return bits.join('｜') + `<br><span style="color:#5c728c">${hours}</span>`;
  };

  // 小驚嘆號：點圖示浮出說明，點其他地方收起
  const infoI = (tip) => `<span class="info" data-tip="${tip}">!</span>`;
  const tipbox = document.createElement('div');
  tipbox.id = 'tipbox';
  document.body.appendChild(tipbox);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.info');
    if (!t) { tipbox.style.display = 'none'; return; }
    tipbox.textContent = t.dataset.tip;
    tipbox.style.display = 'block';
    const w = Math.min(300, innerWidth - 24);
    tipbox.style.maxWidth = w + 'px';
    const r = t.getBoundingClientRect();
    tipbox.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 12)) + 'px';
    tipbox.style.top = Math.min(r.bottom + 8, innerHeight - 60) + 'px';
    e.stopPropagation();
  });
  const barRow = (name, share, val, color) =>
    `<div class="row"><div class="name" title="${name}">${name}</div><div class="bar"><i style="width:${Math.min(100, share * 100).toFixed(1)}%;background:${color}"></i></div><div class="val">${val}</div></div>`;
  const num = (v) => v == null ? '—' : `<span class="${cls(v)}">${Math.round(v).toLocaleString()}</span>`;
  const pct = (v) => v == null ? '—' : `<span class="${cls(v)}">${(v * 100).toFixed(1)}%</span>`;
  const xirrTxt = (r) => r == null ? '—' : Math.abs(r) > 9.99 ? `<span class="${cls(r)}">${r > 0 ? '>' : '<-'}999%</span>` : `<span class="${cls(r)}">${(r * 100).toFixed(0)}%</span>`;

  load();
  function toggleStocks() {
    const el = $('stocksMid'), btn = document.querySelector('.toggle');
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    btn.textContent = (open ? '▴ 收合中間 ' : '▾ 展開中間 ') + el.querySelectorAll('tbody tr').length + ' 檔';
  }

  return { saveConfig, reconfig, reload: load, toggleStocks, pickPeriod };
})();
