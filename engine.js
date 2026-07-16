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
  function loanCost(settings, overview, trades) {
    const rate = (label) => {
      const row = (settings || []).find((r) => String(r[0]).startsWith(label));
      return row ? +row[1] || 0 : 0;
    };
    const marginBal = (trades || []).reduce((s, t) => s + (t.margin || 0), 0);
    const balA = Math.abs(+overview.loan_a || 0);
    const balB = Math.abs(+overview.loan_b || 0);
    const yearly = balA * rate('信貸A年利率') + balB * rate('信貸B年利率') + marginBal * rate('融資年利率');
    return { balA, balB, marginBal: Math.round(marginBal), yearly: Math.round(yearly), monthly: Math.round(yearly / 12) };
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

  const api = { parseTrades, xirr, stockStats, monthlyPerf, loanCost, expenseMonthly, savingsRate };
  if (typeof module !== 'undefined') module.exports = api;
  root.Engine = api;
})(typeof self !== 'undefined' ? self : globalThis);
