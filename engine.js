/* 資產儀表板 — 分析引擎（純函式，node 可測）
 * 資料來源：GAS ?run=data 的 bundle。Sheet 是資料庫，所有分析在這裡算。
 */
(function (root) {
  'use strict';

  const D = (v) => (v instanceof Date ? v : new Date(v));
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  // ---- 交易紀錄正規化（欄序見 Sheet：A..P）----
  function parseTrades(rows) {
    return rows
      .filter((r) => r[0])
      .map((r) => ({
        date: D(r[0]), type: r[1], item: r[2], price: +r[3] || 0, qty: +r[4] || 0,
        ttype: r[5], cost: +r[6] || 0, rate: +r[7] || 0, realized: r[8] === '' ? null : +r[8],
        cash: +r[11] || 0, account: r[12], usd: +r[13] || 0, method: r[14], margin: +r[15] || 0,
      }));
  }

  // ---- XIRR（牛頓法＋二分法保底）----
  function xirr(flows) {
    if (flows.length < 2) return null;
    const t0 = flows[0].date.getTime();
    const yrs = flows.map((f) => (f.date.getTime() - t0) / 31557600000);
    const npv = (r) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, yrs[i]), 0);
    let r = 0.1;
    for (let i = 0; i < 50; i++) {
      const f = npv(r);
      const df = (npv(r + 1e-6) - f) / 1e-6;
      if (!isFinite(df) || df === 0) break;
      const nr = r - f / df;
      if (!isFinite(nr) || nr <= -0.999) break;
      if (Math.abs(nr - r) < 1e-8) return nr;
      r = nr;
    }
    let lo = -0.99, hi = 10;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      (npv(lo) * npv(mid) <= 0) ? (hi = mid) : (lo = mid);
    }
    return (lo + hi) / 2;
  }

  // ---- 個股表現：從交易紀錄自動發現標的 ----
  // positions: 資產總覽 B..O 列（拿目前市值當未平倉終值）
  function stockStats(trades, positions, today) {
    today = today || new Date();
    // 資產總覽 B..O：idx1=項目 idx8=成本J idx9=市值K idx10=獲利L
    const posByItem = {};
    const cashNames = new Set(); // 資產總覽裡類型=現金的「項目」是帳戶名，不是投資標的
    (positions || []).forEach((p) => {
      posByItem[p[1]] = { mv: +p[9] || 0, unreal: +p[10] || 0 };
      if (p[0] === '現金') cashNames.add(p[1]);
    });
    const items = {};
    trades.forEach((t) => {
      if (t.type === '現金' || !t.item || cashNames.has(t.item)) return;
      const it = (items[t.item] = items[t.item] || {
        item: t.item, type: t.type, isFut: false, realized: 0, invested: 0,
        first: t.date, last: t.date, qty: 0, flows: [], wins: 0, losses: 0,
      });
      it.first = t.date < it.first ? t.date : it.first;
      it.last = t.date > it.last ? t.date : it.last;
      if (t.ttype === '期貨損益') {
        it.isFut = true;
        it.realized += t.qty; // 期貨列的「數量」欄就是損益
        (t.qty >= 0 ? it.wins++ : it.losses++);
      } else if (t.ttype === '買入') {
        it.invested += t.cost;
        it.qty += t.qty;
        it.flows.push({ date: t.date, amount: -t.cost });
      } else if (t.ttype === '賣出') {
        it.qty -= t.qty;
        if (t.realized != null) { it.realized += t.realized; (t.realized >= 0 ? it.wins++ : it.losses++); }
        it.flows.push({ date: t.date, amount: t.cost });
      } else if (t.ttype === '收到股息') {
        it.realized += t.cost;
        it.flows.push({ date: t.date, amount: t.cost });
      }
    });
    return Object.values(items).map((it) => {
      const open = it.qty > 0.0001;
      const pos = posByItem[it.item] || { mv: 0, unreal: 0 };
      const mv = open ? pos.mv : 0;
      let rate = null;
      if (!it.isFut) {
        const flows = it.flows.slice();
        if (open && mv) flows.push({ date: today, amount: mv });
        flows.sort((a, b) => a.date - b.date);
        rate = xirr(flows);
      }
      const days = Math.max(1, Math.round(((open ? today : it.last) - it.first) / 86400000));
      return {
        item: it.item, type: it.isFut ? '期貨' : it.type, open, days,
        realized: Math.round(it.realized),
        unrealized: open ? Math.round(pos.unreal) : 0,
        invested: Math.round(it.invested), mv: Math.round(mv),
        total: Math.round(it.realized + (open ? pos.unreal : 0)),
        xirr: rate, wins: it.wins, losses: it.losses,
      };
    }).sort((a, b) => b.total - a.total);
  }

  // ---- 月度績效 ----
  // history 欄序：日期/總資產/已實現/投資成本/投資總市值/未實現/報酬率
  // 月報酬 =（Δ已實現＋Δ未實現）÷ 平均投資市值 —— 對入金免疫
  function monthlyPerf(history, benchmarks, loanCost) {
    const snaps = history.filter((r) => r[0]).map((r) => ({
      date: D(r[0]), total: +r[1] || 0, realized: +r[2] || 0, cost: +r[3] || 0, mv: +r[4] || 0, unreal: +r[5] || 0,
    })).sort((a, b) => a.date - b.date);
    if (!snaps.length) return [];
    const eom = {}; // 每月最後一筆快照
    snaps.forEach((s) => { eom[ym(s.date)] = s; });
    const months = Object.keys(eom).sort();
    const benchAt = (series, month) => { // 該月最後一個收盤
      let last = null;
      (series || []).forEach((r) => { const d = D(r[0]); if (ym(d) <= month && r[1]) last = +r[1]; });
      return last;
    };
    const out = [];
    for (let i = 1; i < months.length; i++) {
      const a = eom[months[i - 1]], b = eom[months[i]];
      // 缺快照的月份會跨月：標記讓使用者知道這格涵蓋多個月
      const gap = (new Date(months[i] + '-01') - new Date(months[i - 1] + '-01')) / 2592000000;
      const spanned = gap > 1.5;
      const pnl = (b.realized - a.realized) + (b.unreal - a.unreal);
      const base = (a.mv + b.mv) / 2;
      const r = base > 0 ? pnl / base : null;
      const tw0 = benchAt(benchmarks && benchmarks.taiex, months[i - 1]);
      const tw1 = benchAt(benchmarks && benchmarks.taiex, months[i]);
      const us0 = benchAt(benchmarks && benchmarks.spy, months[i - 1]);
      const us1 = benchAt(benchmarks && benchmarks.spy, months[i]);
      const interest = loanCost ? loanCost.monthly : 0;
      out.push({
        month: months[i] + (spanned ? '（含前月）' : ''), pnl: Math.round(pnl), ret: r, base: Math.round(base),
        totalDelta: Math.round(b.total - a.total), total: Math.round(b.total),
        tw: tw0 && tw1 ? tw1 / tw0 - 1 : null,
        us: us0 && us1 ? us1 / us0 - 1 : null,
        netRet: r != null && base > 0 ? r - interest / base : null,
        interest: Math.round(interest),
      });
    }
    // TWR 累積
    let acc = 1, accTw = 1, accUs = 1;
    out.forEach((m) => {
      if (m.ret != null) acc *= 1 + m.ret;
      if (m.tw != null) accTw *= 1 + m.tw;
      if (m.us != null) accUs *= 1 + m.us;
      m.cum = acc - 1; m.cumTw = accTw - 1; m.cumUs = accUs - 1;
    });
    return out;
  }

  // ---- 槓桿成本（用目前餘額×年利率，v1 平算）----
  // settings: 設定分頁 A1:C14；overview: bundle.overview
  function loanCost(settings, overview) {
    const rate = (label) => {
      const row = (settings || []).find((r) => String(r[0]).startsWith(label));
      return row ? +row[1] || 0 : 0;
    };
    // 融資餘額以資產總覽 A8 為準；交易紀錄 P 欄含舊公式「賣價六成估償還」的殘差，不能當餘額
    const marginBal = Math.abs(+overview.margin_debt || 0);
    const balA = Math.abs(+overview.loan_a || 0);
    const balB = Math.abs(+overview.loan_b || 0);
    const yearly = balA * rate('信貸A年利率') + balB * rate('信貸B年利率') + marginBal * rate('融資年利率');
    return { balA, balB, marginBal: Math.round(marginBal), yearly: Math.round(yearly), monthly: Math.round(yearly / 12) };
  }

  // ---- 每日序列：歷史快照每天取最後一筆 ----
  const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function dailySeries(history) {
    const byDay = {};
    (history || []).filter((r) => r[0])
      .map((r) => ({ date: D(r[0]), total: +r[1] || 0, realized: +r[2] || 0, mv: +r[4] || 0, unreal: +r[5] || 0 }))
      .sort((a, b) => a.date - b.date)
      .forEach((s) => { byDay[ymdLocal(s.date)] = s; });
    return Object.keys(byDay).sort().map((k) => Object.assign({ day: k }, byDay[k]));
  }

  // ---- 今日 vs 昨日投資損益（快照在每晨 6:00＝前日收盤）----
  function todayYesterday(overview, days) {
    if (!days.length) return null;
    const nowPnl = (+overview.realized || 0) + (+overview.unrealized || 0);
    const last = days[days.length - 1];
    const prev = days.length > 1 ? days[days.length - 2] : null;
    return {
      today: nowPnl - (last.realized + last.unreal),
      todayPct: last.mv > 0 ? (nowPnl - (last.realized + last.unreal)) / last.mv : null,
      todayBase: last.day, todayBaseAt: last.date,
      yesterday: prev ? (last.realized + last.unreal) - (prev.realized + prev.unreal) : null,
      yesterdayBase: prev ? prev.day : null,
      totalToday: (+overview.net_inc_loan || 0) - last.total,
    };
  }

  // ---- 分市場當日損益 ----
  // 台股 09:00-13:30、美股 21:30-04:00（台北時間）完全不重疊，混成單一「今日損益」必然切斷其中一邊。
  // 基準一律取當日 06:00 部位快照：該時刻台股未開、美股已收，是全天唯一同時乾淨的起點。
  //   台股：現價 vs 今日06:00 → 收盤後看到的就是今天整天
  //   美股：盤中 → 現價 vs 今日06:00（今晚進行中）；收盤後 → 今日06:00 vs 昨日06:00（昨夜完整一場）
  // 用「基準日持有量×價差」算純市場波動，不含當日進出的已實現損益（qty 有變動的標的會列進 changed）。
  const TW_TYPES = new Set(['台股', '台股ETF']);
  const US_TYPES = new Set(['美股', '美股ETF']);
  function marketDaily(overview, futures, posHistory, now) {
    now = now || new Date();
    const byDay = {}, atTime = {};
    (posHistory || []).forEach((r) => {
      const d = String(r[0]);
      (byDay[d] = byDay[d] || {})[r[2]] = { price: +r[3] || 0, qty: +r[5] || 0 };
      if (r[6]) atTime[d] = String(r[6]); // 基準實際存檔時間，沒有就不顯示（別假裝是 06:00）
    });
    const days = Object.keys(byDay).sort();
    const today = days[days.length - 1] || null;
    const prev = days.length > 1 ? days[days.length - 2] : null;

    const cur = {};
    (overview.positions || []).forEach((p) => {
      if (p[0] === '現金' || p[0] === '期貨部位') return;
      const b = TW_TYPES.has(p[0]) ? 'TW' : US_TYPES.has(p[0]) ? 'US' : 'OTHER';
      cur[p[1]] = { bucket: b, price: +p[5] || 0, qty: +p[3] || 0, fx: +p[7] || 1, isFut: false };
    });
    (((futures || {}).positions) || []).forEach((f) => { // 期貨存的是「現值」不是單價，且屬台股市場
      cur[f[0]] = { bucket: 'TW', price: +f[4] || 0, qty: +f[3] || 0, fx: 1, isFut: true };
    });

    // baseDay→(cmpDay 或現價) 的市場波動
    function delta(baseDay, cmpDay, bucket) {
      if (!baseDay) return null;
      let pnl = 0;
      const changed = [];
      let counted = 0, skipped = 0;
      Object.keys(cur).forEach((item) => {
        const c = cur[item];
        if (c.bucket !== bucket) return;
        const base = (byDay[baseDay] || {})[item];
        const tgt = cmpDay ? (byDay[cmpDay] || {})[item] : c;
        if (!base || !tgt) { skipped++; return; }
        if (base.qty !== tgt.qty) changed.push(item);
        pnl += c.isFut ? (tgt.price - base.price) : (tgt.price - base.price) * base.qty * c.fx;
        counted++;
      });
      return { pnl: Math.round(pnl), changed, counted, skipped };
    }

    const h = now.getHours() + now.getMinutes() / 60;
    const nowDay = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    // 凌晨 00:00～晨間快照之間，最新快照其實是「昨天的」。這時收盤視角要比
    // 現價 vs 昨晨快照（現價＝昨收，正好是昨天完整一天）；退去比前晨vs昨晨會變成前天的行情。
    const snapIsToday = today === nowDay;
    const usLive = h >= 21.5 || h < 5;      // 美股盤中（夏令 21:30-04:00，冬令順延一小時）
    const twStarted = h >= 9;               // 台股已開盤 → 比的是今天；之前則顯示昨日結果
    const closed = (bucket) => snapIsToday ? delta(prev, today, bucket) : delta(today, null, bucket);
    const tw = twStarted ? delta(today, null, 'TW') : closed('TW');
    const us = usLive ? delta(today, null, 'US') : closed('US');
    const closedBase = snapIsToday ? prev : today;
    const tag = (o, label, live, base) => o && Object.assign(o, { label, live, base, baseTime: atTime[base] || '' });
    return {
      baseDay: today, prevDay: prev, hasPrev: !!prev,
      tw: tag(tw, twStarted ? '今日' : '昨日', twStarted && h < 13.5, twStarted ? today : closedBase),
      us: tag(us, usLive ? '今晚' : '昨夜', usLive, usLive ? today : closedBase),
    };
  }

  // ---- 今日已實現：當天賣出／期貨平倉真正結算掉的損益 ----
  // 跟 marketDaily 互補、不重疊：那邊算「還抱著的部位漲跌」，這邊算「已經結算掉的」。
  // 對帳單多半晚上才寄到，盤中當日常常是 0 → 用 hasToday 區分「今天沒平倉」與「還沒收到」，
  // 並附上最近一個有平倉的日子，免得看到 0 以為壞了。
  function realizedToday(trades, now) {
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = key(now || new Date());
    const byDay = {};
    (trades || []).forEach((t) => {
      if (!t.realized) return; // null（存入資金等不進 FIFO）與 0 都不算平倉
      const k = key(t.date);
      byDay[k] = (byDay[k] || 0) + t.realized;
    });
    const lastDay = Object.keys(byDay).sort().pop() || null;
    return {
      today, day: Math.round(byDay[today] || 0), hasToday: today in byDay,
      month: Math.round(Object.keys(byDay).filter((k) => k.slice(0, 7) === today.slice(0, 7))
        .reduce((s, k) => s + byDay[k], 0)),
      lastDay, lastPnl: lastDay ? Math.round(byDay[lastDay]) : null,
    };
  }

  // ---- 融資健康度：擔保品市值 ÷ 融資餘額，跌破 130% 券商就發追繳令 ----
  // 擔保品只算「交易紀錄 P 欄（融資金額影響）還有餘額」的那幾檔，不是全部台股——
  // 現金買的股票不是融資的擔保品，混進來會把維持率算得太樂觀。
  function marginHealth(tradeRows, positions, marginDebt) {
    const debt = Math.abs(+marginDebt || 0);
    if (!debt) return null;
    const bal = {};
    (tradeRows || []).forEach((r) => { const p = +r[15] || 0; if (p) bal[r[2]] = (bal[r[2]] || 0) + p; });
    const items = Object.keys(bal).filter((k) => Math.abs(bal[k]) > 0.5);
    const list = (positions || []).filter((p) => items.indexOf(p[1]) >= 0)
      .map((p) => ({ name: p[1], mv: +p[9] || 0, debt: Math.round(bal[p[1]]) }))
      .sort((a, b) => b.mv - a.mv);
    const collateral = list.reduce((s, x) => s + x.mv, 0);
    return { debt, collateral, list, call: debt * 1.3,
      ratio: collateral ? collateral / debt : null,
      buffer: collateral ? 1 - (debt * 1.3) / collateral : null };  // 還可以跌幾 % 才碰到追繳線
  }

  // ---- 大筆開銷可花額度：額度＝股票已實現損益（他的規矩：賺到的才拿來花大的）----
  function majorBudget(major, realized) {
    const rows = (major || []).filter((r) => r[0]);
    const spent = rows.reduce((s, r) => s + (+r[3] || 0), 0);  // 金額本身就是負的
    return {
      quota: Math.round(+realized || 0), spent: Math.round(-spent), count: rows.length,
      left: Math.round((+realized || 0) + spent),
      recent: rows.slice().sort((a, b) => D(b[0]) - D(a[0])).slice(0, 12).map((r) => ({
        date: D(r[0]), item: String(r[1] || ''), amount: +r[3] || 0, status: String(r[5] || ''),
      })),
    };
  }

  // ---- 分市場明細：跟試算表右上四張卡同一套定義（依「類型」欄分桶，不是列號）----
  // 成本刻意不扣融資：這樣同一列的「市值−成本≈未實現」讀起來才一致。
  // 試算表的「投資成本」有扣融資，所以合計會差一個融資餘額，畫面上另外標。
  const MKT = { 台股: '台股', 台股ETF: '台股', 美股: '美股', 美股ETF: '美股', 虛擬貨幣: '加密貨幣', 期貨部位: '期貨' };
  function marketBreakdown(positions) {
    const m = {};
    (positions || []).forEach((p) => {
      const k = MKT[p[0]]; if (!k) return;
      const o = m[k] || (m[k] = { name: k, cost: 0, mv: 0, unreal: 0 });
      o.cost += +p[8] || 0; o.mv += +p[9] || 0; o.unreal += +p[10] || 0;
    });
    const tot = Object.keys(m).reduce((s, k) => s + m[k].mv, 0);
    return Object.keys(m).map((k) => Object.assign(m[k], {
      ret: m[k].cost ? m[k].unreal / m[k].cost : null, share: tot ? m[k].mv / tot : null,
    })).sort((a, b) => b.mv - a.mv);
  }

  // ---- 本月收支（月度總覽最後一列）----
  function monthFlow(flow) {
    const rows = (flow || []).filter((r) => r[0]);
    const r = rows[rows.length - 1];
    return r ? { month: String(r[0]), salary: +r[1] || 0, spend: +r[2] || 0,
      big: +r[3] || 0, daily: +r[4] || 0 } : null;
  }

  // ---- 回撤：日報酬串成 TWR 指數，距歷史峰值（對入金免疫）----
  function drawdownSeries(days, overview) {
    const pts = days.map((d) => ({ day: d.day, pnl: d.realized + d.unreal, mv: d.mv }));
    if (overview) pts.push({ day: '現在', pnl: (+overview.realized || 0) + (+overview.unrealized || 0), mv: +overview.mv || 0 });
    let idx = 1, peak = 1;
    const series = [];
    for (let i = 1; i < pts.length; i++) {
      const base = (pts[i - 1].mv + pts[i].mv) / 2;
      const r = base > 0 ? (pts[i].pnl - pts[i - 1].pnl) / base : 0;
      idx *= 1 + r;
      peak = Math.max(peak, idx);
      series.push({ day: pts[i].day, dd: idx / peak - 1 });
    }
    const maxDD = series.length ? Math.min(...series.map((p) => p.dd)) : 0;
    return { series, maxDD, current: series.length ? series[series.length - 1].dd : 0 };
  }

  // ---- 資產配置（曝險觀點：期貨用合約價值，其餘用市值）----
  function allocation(overview, futures) {
    const buckets = {};
    (overview.positions || []).forEach((p) => {
      if (p[0] === '期貨部位') return;
      buckets[p[0]] = (buckets[p[0]] || 0) + (+p[9] || 0);
    });
    if (futures && +futures.contract_value) buckets['期貨曝險'] = +futures.contract_value;
    return buckets;
  }

  // ---- 持股集中度：股票市值＋期貨現值 ----
  function concentration(overview, futures) {
    const list = [];
    (overview.positions || []).forEach((p) => {
      if (p[0] === '現金' || p[0] === '期貨部位') return;
      list.push({ name: p[1], kind: p[0], v: +p[9] || 0 });
    });
    (((futures || {}).positions) || []).forEach((f) => list.push({ name: f[0], kind: '期貨', v: +f[4] || 0 }));
    const total = list.reduce((s, x) => s + x.v, 0);
    list.sort((a, b) => b.v - a.v);
    list.forEach((x) => { x.share = total > 0 ? x.v / total : 0; });
    return { list, total, top5: list.slice(0, 5).reduce((s, x) => s + x.share, 0) };
  }

  // ---- 現金水位與可撐月數（月支出取近 6 個月中位數）----
  // banks（帳戶餘額分頁）有資料時，「各種帳戶」拆成各銀行明細（總額相同，因為資產總覽就是加總它）
  function cashInfo(overview, flow, banks) {
    let accounts = (overview.positions || []).filter((p) => p[0] === '現金').map((p) => ({ name: p[1], v: +p[9] || 0 }));
    if (banks && banks.length) {
      accounts = accounts.filter((a) => a.name !== '各種帳戶')
        .concat(banks.map((b) => ({ name: b[0], v: +b[1] || 0, at: b[2] })));
    }
    const cash = accounts.reduce((s, a) => s + a.v, 0);
    // 月度總覽列 [月份,收入,總支出,...]；進行中的當月支出未滿不列入中位數
    const nowYm = ym(new Date());
    const spends = (flow || []).filter((r) => r[0] && +r[2] && String(r[0]) !== nowYm)
      .map((r) => +r[2]).slice(-6).sort((a, b) => a - b);
    const n = spends.length;
    const spend = n ? (spends[Math.floor((n - 1) / 2)] + spends[Math.ceil((n - 1) / 2)]) / 2 : 0;
    return { cash, accounts, monthlySpend: spend, months: spend > 0 ? cash / spend : null };
  }

  // ---- 期貨風險（風險指標=權益/原始保證金；警戒125%、追繳=權益<維持、代沖銷25%）----
  function futuresRisk(f) {
    if (!f || !+f.orig_margin) return null;
    return {
      risk: f.equity / f.orig_margin,
      marginUtil: f.equity > 0 ? f.orig_margin / f.equity : null,
      toWarn: f.equity - 1.25 * f.orig_margin,
      toCall: f.equity - f.maint_margin,
      toLiq: f.equity - 0.25 * f.orig_margin,
      maintPct: f.maint_margin / f.orig_margin,
    };
  }

  // ---- 持股明細（當日漲跌基準＝GAS 晨間部位快照 yesterday）----
  function holdings(overview, yesterday) {
    const y = (yesterday && yesterday.positions) || {};
    const rows = (overview.positions || [])
      .filter((p) => p[0] !== '現金' && p[0] !== '期貨部位')
      .map((p) => {
        const qty = +p[3] || 0, price = +p[5] || 0, fx = +p[7] || 1;
        const cost = +p[8] || 0, mv = +p[9] || 0, pl = +p[10] || 0;
        const prev = y[p[1]];
        const dayPct = prev && prev[0] > 0 && price > 0 ? price / prev[0] - 1 : null;
        return {
          type: p[0], item: p[1], qty, avg: +p[4] || 0, price, ccy: p[6] || 'TWD',
          cost, mv, pl, plPct: cost > 0 ? pl / cost : null,
          dayPct, dayNt: dayPct != null ? (price - prev[0]) * qty * fx : null,
        };
      });
    const total = rows.reduce((s, r) => s + r.mv, 0);
    rows.forEach((r) => { r.weight = total > 0 ? r.mv / total : 0; });
    return rows.sort((a, b) => b.mv - a.mv);
  }

  // ---- 期貨部位明細（E名 F合約成本 G均價 H數量 I現值 J損益）----
  function futuresRows(futures, yesterday) {
    const y = (yesterday && yesterday.futures) || {};
    return (((futures || {}).positions) || []).map((f) => {
      const prev = y[f[0]];
      return {
        name: f[0], cost: +f[1] || 0, avg: +f[2] || 0, qty: +f[3] || 0,
        value: +f[4] || 0, pl: +f[5] || 0,
        dayNt: prev && prev[1] === (+f[3] || 0) ? (+f[4] || 0) - prev[0] : null, // 數量變動過就不比
      };
    });
  }

  // ---- 個股損益貢獻（部位歷史：同檔連續兩筆數量相同 → 價差×數量×匯率；期貨直接比現值）----
  // posHistory 列：[日期str, 類別(股/期), 項目, 現價/現值, 市值, 數量]
  function contribution(posHistory, overview, cutoffDay) {
    const fx = {};
    (overview.positions || []).forEach((p) => { fx[p[1]] = +p[7] || 1; });
    const byItem = {};
    (posHistory || []).forEach((r) => {
      if (cutoffDay && String(r[0]) < cutoffDay) return;
      (byItem[r[2]] = byItem[r[2]] || []).push({ d: String(r[0]), kind: r[1], price: +r[3] || 0, qty: +r[5] || 0 });
    });
    const out = [];
    Object.keys(byItem).forEach((item) => {
      const s = byItem[item].sort((a, b) => (a.d < b.d ? -1 : 1));
      let pnl = 0;
      for (let i = 1; i < s.length; i++) {
        if (s[i].qty === s[i - 1].qty && s[i - 1].price > 0) { // 數量變了那天不算（進出場日交給對帳單）
          const diff = s[i].price - s[i - 1].price;
          pnl += s[i].kind === '期' ? diff : diff * s[i].qty * (fx[item] || 1);
        }
      }
      out.push({ item, kind: s[0].kind, pnl: Math.round(pnl) });
    });
    return out.sort((a, b) => b.pnl - a.pnl);
  }

  // ---- 全買 0050 對照：每月「同樣的平均部位規模 × 0050 月報酬」累積 NT$ vs 實際累積損益 ----
  function vs0050(perf) {
    let mine = 0, tw = 0;
    return perf.map((m) => {
      mine += m.pnl || 0;
      if (m.tw != null && m.base) tw += m.base * m.tw;
      return { month: m.month, mine: Math.round(mine), tw: Math.round(tw) };
    });
  }

  // ---- 槓桿倍數 ----
  // 曝險部位 ÷ 淨資產。含信貸看的是「銀行眼中的我」，不含信貸看的是「真正屬於我的錢被放大幾倍」。
  function leverage(overview) {
    const exp = +overview.mv || 0;
    const inc = +overview.net_inc_loan || 0;
    const ex = +overview.net_ex_loan || 0;
    return { exposure: exp, incLoan: inc, exLoan: ex,
      xInc: inc > 0 ? exp / inc : null, xEx: ex > 0 ? exp / ex : null };
  }

  // ---- 期間報告（半年報／年報）----
  // 有了每日快照才算得出來的專業指標：
  //   TWR      時間加權報酬率——把每天的報酬連乘，入金出金不影響，這是評「操作」的標準做法
  //   年化波動  日報酬標準差 × √252，衡量顛簸程度
  //   Sharpe   (年化報酬 − 無風險利率) ÷ 年化波動，每承受一單位風險換到多少超額報酬
  //   最大回撤  期間內從高點回吐最多多少
  //   Calmar   年化報酬 ÷ |最大回撤|，另一種風險調整後報酬
  //   勝率     上漲天數比例
  function periodReport(history, benchmarks, from, to, riskFree) {
    riskFree = riskFree == null ? 0.015 : riskFree;   // 台幣定存約 1.5%
    const days = dailySeries(history).filter((d) => (!from || d.day >= from) && (!to || d.day <= to));
    if (days.length < 3) return null;
    const rets = [];
    for (let i = 1; i < days.length; i++) {
      const base = (days[i - 1].mv + days[i].mv) / 2;
      const pnl = (days[i].realized - days[i - 1].realized) + (days[i].unreal - days[i - 1].unreal);
      rets.push({ day: days[i].day, r: base > 0 ? pnl / base : 0, pnl });
    }
    let idx = 1, peak = 1, maxDD = 0;
    rets.forEach((x) => {
      idx *= 1 + x.r;
      peak = Math.max(peak, idx);
      maxDD = Math.min(maxDD, idx / peak - 1);
    });
    const twr = idx - 1;
    const yrs = Math.max(1 / 365, (new Date(days[days.length - 1].day) - new Date(days[0].day)) / 31557600000);
    const ann = Math.pow(1 + twr, 1 / yrs) - 1;
    const mean = rets.reduce((s, x) => s + x.r, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, x) => s + (x.r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    const vol = sd * Math.sqrt(252);
    const bench = (series) => {   // 同期間的指數報酬
      const pts = (series || []).filter((r) => r[0] && r[1])
        .map((r) => ({ d: D(r[0]), v: +r[1] })).sort((a, b) => a.d - b.d)
        .filter((p) => ymdLocal(p.d) >= days[0].day && ymdLocal(p.d) <= days[days.length - 1].day);
      return pts.length >= 2 ? pts[pts.length - 1].v / pts[0].v - 1 : null;
    };
    const tw = bench(benchmarks && benchmarks.taiex), us = bench(benchmarks && benchmarks.spy);
    // 快照密度：早期不是每天都有，會讓「日報酬」其實橫跨數日 → 波動與 Sharpe 會失真，要標示出來
    const calDays = Math.round((new Date(days[days.length - 1].day) - new Date(days[0].day)) / 86400000) + 1;
    return {
      from: days[0].day, to: days[days.length - 1].day, days: days.length, years: yrs,
      coverage: calDays > 0 ? days.length / calDays : null, calDays,
      pnl: Math.round((days[days.length - 1].realized + days[days.length - 1].unreal) -
        (days[0].realized + days[0].unreal)),
      twr, annualized: ann, vol,
      sharpe: vol > 0 ? (ann - riskFree) / vol : null,
      maxDD, calmar: maxDD < 0 ? ann / Math.abs(maxDD) : null,
      winDays: rets.filter((x) => x.r > 0).length, totalDays: rets.length,
      dayWinRate: rets.length ? rets.filter((x) => x.r > 0).length / rets.length : null,
      best: rets.reduce((a, b) => (!a || b.r > a.r ? b : a), null),
      worst: rets.reduce((a, b) => (!a || b.r < a.r ? b : a), null),
      tw, us, alphaTw: tw == null ? null : twr - tw, alphaUs: us == null ? null : twr - us,
    };
  }

  // ---- 年度績效 ----
  // 專業機構的年報通常看四件事：報酬、風險、一致性、歸因。
  // 這裡只用「交易紀錄算得出來」的版本（每日快照 2025-08 才開始，早年算不出 TWR）：
  //   報酬 → 年度已實現損益（不是報酬率，因為早年沒有每日部位可當分母）
  //   一致性 → 勝率、獲利因子（總獲利÷總虧損，>1.5 算穩健）、最大單筆賺賠
  //   歸因 → 依類型（台股/美股/期貨）與前三大貢獻／拖累
  function yearlyPerf(trades) {
    const years = {};
    const bucket = (t) => t.ttype === '期貨損益' ? '期貨' : (t.type || '其他');
    trades.forEach((t) => {
      if (t.realized == null || !t.realized) return;
      const y = String(t.date.getFullYear());
      const Y = (years[y] = years[y] || {
        year: y, pnl: 0, wins: 0, losses: 0, gross: 0, loss: 0,
        best: null, worst: null, byType: {}, byItem: {},
      });
      const v = t.realized;
      Y.pnl += v;
      if (v > 0) { Y.wins++; Y.gross += v; } else { Y.losses++; Y.loss += -v; }
      if (!Y.best || v > Y.best.v) Y.best = { item: t.item, v };
      if (!Y.worst || v < Y.worst.v) Y.worst = { item: t.item, v };
      const b = bucket(t);
      Y.byType[b] = (Y.byType[b] || 0) + v;
      Y.byItem[t.item] = (Y.byItem[t.item] || 0) + v;
    });
    return Object.values(years).sort((a, b) => a.year.localeCompare(b.year)).map((Y) => {
      const items = Object.keys(Y.byItem).sort((a, b) => Y.byItem[b] - Y.byItem[a]);
      return Object.assign(Y, {
        trades: Y.wins + Y.losses,
        winRate: (Y.wins + Y.losses) ? Y.wins / (Y.wins + Y.losses) : null,
        // 獲利因子＝總獲利÷總虧損。1.0 是打平，機構常用 >1.5 當穩健門檻
        profitFactor: Y.loss > 0 ? Y.gross / Y.loss : null,
        avgWin: Y.wins ? Y.gross / Y.wins : 0,
        avgLoss: Y.losses ? Y.loss / Y.losses : 0,
        top: items.slice(0, 3).map((k) => ({ item: k, v: Y.byItem[k] })),
        bottom: items.slice(-3).reverse().map((k) => ({ item: k, v: Y.byItem[k] })),
      });
    });
  }

  // ---- 支出與儲蓄 ----
  // daily 欄序：日期/類別/金額/備註/是否大筆/付款方式/來源
  function expenseMonthly(daily) {
    const months = {};
    (daily || []).forEach((r) => {
      if (!r[0]) return;
      const amt = +r[2] || 0;
      const cat = r[1] || '日常';
      if (amt >= 0 || cat === '轉帳' || cat === '儲值') return; // 只算支出，轉帳/儲值不是消費
      const m = ym(D(r[0]));
      months[m] = months[m] || {};
      months[m][cat] = (months[m][cat] || 0) + Math.abs(amt);
    });
    return months; // {2026-07: {吃: 1234, 日常: 567, ...}}
  }

  // monthly_flow（月度總覽）欄序：[月份, 收入, 總支出, 其中大筆, 日常, 結餘]
  function savingsRate(flow) {
    return (flow || []).filter((r) => r[0] && (+r[1] || +r[2])).map((r) => ({
      month: String(r[0]), salary: +r[1] || 0, spend: +r[2] || 0, big: +r[3] || 0,
      rate: +r[1] ? 1 - (+r[2] || 0) / +r[1] : null,
    }));
  }

  const api = { parseTrades, xirr, stockStats, monthlyPerf, loanCost, expenseMonthly, savingsRate,
    dailySeries, todayYesterday, drawdownSeries, allocation, concentration, cashInfo, futuresRisk, holdings, futuresRows,
    contribution, vs0050, marketDaily, realizedToday, marginHealth, majorBudget, marketBreakdown, monthFlow,
    yearlyPerf, leverage, periodReport };
  if (typeof module !== 'undefined') module.exports = api;
  root.Engine = api;
})(typeof self !== 'undefined' ? self : globalThis);
