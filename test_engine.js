/* node test_engine.js — 引擎自檢（吃 test_bundle.json 真資料） */
const assert = require('assert');
const E = require('./engine.js');
const b = require('./test_bundle.json');

// 融資餘額必須來自 A8（現在是 =-SUM(交易紀錄P:P) 公式，P 欄全是對帳單實際值）
const lc = E.loanCost(b.settings, b.overview);
assert.strictEqual(lc.marginBal, Math.abs(+b.overview.margin_debt || 0), '融資餘額=|A8|');
assert.ok(lc.monthly > 0 && lc.balA === 1350000 && lc.balB === 778000, '信貸餘額/月息');

// 現金水位 = 四個現金帳戶市值合計
const ci = E.cashInfo(b.overview, b.monthly_flow);
const expCash = b.overview.positions.filter(p => p[0] === '現金').reduce((s, p) => s + p[9], 0);
assert.ok(Math.abs(ci.cash - expCash) < 1, '現金水位');
assert.strictEqual(ci.accounts.length, 4, '現金帳戶數');
assert.ok(ci.months > 0 && ci.months < 60, '可撐月數合理範圍: ' + ci.months);

// 配置：五類、期貨曝險=合約價值
const al = E.allocation(b.overview, b.futures);
assert.strictEqual(al['期貨曝險'], b.futures.contract_value, '期貨曝險=合約價值');
assert.ok(al['現金'] > 0 && al['台股'] > 0 && al['美股'] > 0, '配置桶');
assert.ok(!('期貨部位' in al), '期貨部位列不重複計入');

// 集中度：份額加總=1、前五大介於 0~1
const cc = E.concentration(b.overview, b.futures);
assert.ok(Math.abs(cc.list.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, '份額和=1');
assert.ok(cc.top5 > 0.3 && cc.top5 <= 1, '前五大: ' + cc.top5);

// 期貨風險：188% 上下、距警戒=權益-1.25×原始
const fr = E.futuresRisk(b.futures);
assert.ok(Math.abs(fr.risk - b.futures.equity / b.futures.orig_margin) < 1e-9);
assert.ok(Math.abs(fr.toWarn - (b.futures.equity - 1.25 * b.futures.orig_margin)) < 1e-6);
assert.ok(fr.marginUtil > 0 && fr.marginUtil < 1, '保證金使用率');

// 持股明細：不含現金/期貨部位、權重和=1、當日漲跌吃 yesterday
const hd = E.holdings(b.overview, b.yesterday);
assert.ok(hd.every(r => r.type !== '現金' && r.type !== '期貨部位'));
assert.ok(Math.abs(hd.reduce((s, r) => s + r.weight, 0) - 1) < 1e-9, '權重和=1');
if (b.yesterday) {
  const withDay = hd.filter(r => r.dayPct != null);
  assert.ok(withDay.length > 0, 'yesterday 存在時應有當日漲跌');
}

// 每日序列 + 今日昨日 + 回撤
const days = E.dailySeries(b.history);
assert.ok(days.length > 30 && days.every((d, i) => i === 0 || d.day > days[i - 1].day), '日序遞增');
const ty = E.todayYesterday(b.overview, days);
assert.ok(ty && isFinite(ty.today), '今日損益');
const dd = E.drawdownSeries(days, b.overview);
assert.ok(dd.maxDD <= 0 && dd.maxDD > -1, '最大回撤範圍: ' + dd.maxDD);
assert.ok(dd.series.length === days.length, '回撤點數（含現在）');
assert.ok(dd.series.every(p => p.dd <= 1e-12), '回撤永不為正');

// 期貨明細列
const frow = E.futuresRows(b.futures, b.yesterday);
assert.strictEqual(frow.length, b.futures.positions.length);
assert.ok(frow.every(r => Math.abs(r.value - r.cost - r.pl) < 1), '現值-成本=損益');

// 損益貢獻 + 0050 對照
const ct = E.contribution(b.pos_history, b.overview, '2000-01-01');
assert.ok(Array.isArray(ct) && ct.every(x => isFinite(x.pnl)), '貢獻值有限');
assert.ok(ct.every((x, i) => i === 0 || x.pnl <= ct[i - 1].pnl), '貢獻由大到小');
const cf = E.vs0050(E.monthlyPerf(b.history, b.benchmarks, lc));
assert.strictEqual(cf.length, E.monthlyPerf(b.history, b.benchmarks, lc).length);
assert.ok(cf.every(m => isFinite(m.mine) && isFinite(m.tw)), '對照曲線數值');
assert.ok(Math.abs(cf[cf.length - 1].mine - E.monthlyPerf(b.history, b.benchmarks, lc).reduce((s, m) => s + m.pnl, 0)) < 2, '累積=月損益總和');

console.log('✅ all checks pass');
console.log('   0050對照終點: 我', cf[cf.length - 1].mine, '| 0050', cf[cf.length - 1].tw, '| 貢獻檔數:', ct.length);
console.log('   融資餘額(A8):', lc.marginBal, '| 月息:', lc.monthly);
console.log('   現金:', Math.round(ci.cash), '| 月支出中位:', ci.monthlySpend, '| 可撐:', ci.months.toFixed(1), '月');
console.log('   風險指標:', (fr.risk * 100).toFixed(0) + '%', '| 距警戒125%:', Math.round(fr.toWarn), '| 保證金使用率:', (fr.marginUtil * 100).toFixed(0) + '%');
console.log('   前五大:', (cc.top5 * 100).toFixed(0) + '%', '| 最大回撤:', (dd.maxDD * 100).toFixed(1) + '%', '| 今日:', Math.round(ty.today), '| 昨日:', ty.yesterday == null ? '—' : Math.round(ty.yesterday));
