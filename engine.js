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
        month: months[i] + (spanned ? '（含前月）' : ''), pnl: Math.round(pnl), ret: r,
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
  function cashInfo(overview, flow) {
    const accounts = (overview.positions || []).filter((p) => p[0] === '現金').map((p) => ({ name: p[1], v: +p[9] || 0 }));
    const cash = accounts.reduce((s, a) => s + a.v, 0);
    const spends = (flow || []).filter((r) => r[0] && +r[11]).map((r) => +r[11]).slice(-6).sort((a, b) => a - b);
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

  // monthly_flow 欄序：金流月份/薪資收入/../當月總支出(L=idx11)
  function savingsRate(flow) {
    return (flow || []).filter((r) => r[0] && +r[1]).map((r) => ({
      month: String(r[0]), salary: +r[1] || 0, spend: +r[11] || 0,
      rate: +r[1] ? 1 - (+r[11] || 0) / +r[1] : null,
    }));
  }

  const api = { parseTrades, xirr, stockStats, monthlyPerf, loanCost, expenseMonthly, savingsRate,
    dailySeries, todayYesterday, drawdownSeries, allocation, concentration, cashInfo, futuresRisk, holdings, futuresRows };
  if (typeof module !== 'undefined') module.exports = api;
  root.Engine = api;
})(typeof self !== 'undefined' ? self : globalThis);
