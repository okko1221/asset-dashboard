/* node test_engine.js — 引擎自檢（吃 test_bundle.json 真資料） */
const assert = require('assert');
const E = require('./engine.js');
const b = require('./test_bundle.json');

// ---- 契約看門（見 Desktop/Account/契約.md）：鍵名與陣列列序只能加不能改 ----
// 這幾條若失敗，代表 GAS 端動了契約，儀表板會靜默算錯 → 先看契約.md 再決定怎麼改。
['ok', 'generated', 'overview', 'futures', 'history', 'trades', 'daily',
  'monthly_flow', 'settings', 'yesterday', 'bank_accounts', 'pos_history',
  'benchmarks'].forEach(k => assert.ok(k in b, '契約缺少鍵：' + k));
['gross', 'loan_a', 'loan_b', 'margin_debt', 'fut_leverage', 'net_ex_loan',
  'net_inc_loan', 'realized', 'cost', 'mv', 'unrealized', 'positions']
  .forEach(k => assert.ok(k in b.overview, '契約 overview 缺少：' + k));
['equity', 'withdrawable', 'orig_margin', 'maint_margin', 'contract_value', 'positions']
  .forEach(k => assert.ok(k in b.futures, '契約 futures 缺少：' + k));
assert.ok(b.overview.positions.every(p => p.length >= 11), 'positions 每列至少 11 欄');
assert.ok(b.trades.every(r => r.length >= 16), 'trades 每列至少 16 欄');
assert.ok(b.history.every(r => r.length >= 7), 'history 每列至少 7 欄');
assert.ok(b.pos_history.every(r => r.length >= 6), 'pos_history 每列至少 6 欄');
// 列序：靠位置取值的欄位，抽驗其語意還在原位
const cashRow = b.overview.positions.find(p => p[0] === '現金');
assert.ok(cashRow && typeof cashRow[1] === 'string', 'positions[0]=類型、[1]=項目');
assert.ok(b.monthly_flow.every(r => /^\d{4}[-.]\d{2}/.test(String(r[0]))), 'monthly_flow[0] 是月份');
assert.ok(b.overview.loan_a <= 0 && b.overview.loan_b <= 0, '信貸餘額必須是負數');

// 融資餘額必須來自 A8（現在是 =-SUM(交易紀錄P:P) 公式，P 欄全是對帳單實際值）
const lc = E.loanCost(b.settings, b.overview);
assert.strictEqual(lc.marginBal, Math.abs(+b.overview.margin_debt || 0), '融資餘額=|A8|');
// 信貸餘額取絕對值、月息＝Σ(餘額×年利率)/12（不寫死金額，餘額會隨還款變動）
assert.strictEqual(lc.balA, Math.abs(+b.overview.loan_a), '信貸A餘額=|A4|');
assert.strictEqual(lc.balB, Math.abs(+b.overview.loan_b), '信貸B餘額=|A6|');
assert.ok(lc.monthly > 0 && lc.monthly === Math.round(lc.yearly / 12), '月息=年息/12');

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

// 分市場當日損益：用合成資料驗「晚上看台股、早上看美股」兩個時刻
(function testMarketDaily() {
  const ov = { positions: [
    ['台股', '冠德', '2520', 7000, 36, 36.7, 'TWD', 1, 0, 0, 0],   // 現價 36.7
    ['美股', 'SNPS', 'SNPS', 40, 445, 430, 'USD', 31, 0, 0, 0],     // 現價 430
    ['現金', '台幣證券戶', '', 0, 1, 1, 'TWD', 1, 0, 500, 0],
  ]};
  const fut = { positions: [['台積8', 0, 2471, 400, 1000000, 0]] };
  const ph = [ // [日期, 股/期, 項目, 價or現值, 市值, 數量]
    ['2026-07-18', '股', '冠德', 36.0, 252000, 7000, '06:00'], ['2026-07-18', '股', 'SNPS', 420, 0, 40, '06:00'],
    ['2026-07-18', '期', '台積8', 980000, 980000, 400, '06:00'],
    ['2026-07-19', '股', '冠德', 36.2, 253400, 7000, '06:00'], ['2026-07-19', '股', 'SNPS', 425, 0, 40, '06:00'],
    ['2026-07-19', '期', '台積8', 990000, 990000, 400, '06:00'],
  ];
  // 情境一：晚上 22:37 看 → 台股＝今日（現價 vs 今日06:00）、美股＝今晚進行中
  const night = Engine.marketDaily(ov, fut, ph, new Date('2026-07-19T22:37:00+08:00'));
  assert.strictEqual(night.tw.label, '今日');
  assert.strictEqual(night.us.label, '今晚');
  // 台股：冠德 (36.7-36.2)*7000 = +3500，台積8 現值 1,000,000-990,000 = +10,000
  assert.strictEqual(night.tw.pnl, 13500, '晚上台股今日 got ' + night.tw.pnl);
  // 美股：SNPS (430-425)*40*31 = +6,200
  assert.strictEqual(night.us.pnl, 6200, '晚上美股今晚 got ' + night.us.pnl);

  // 情境二：隔天早上 07:00 看 → 台股＝昨日結果、美股＝昨夜完整一場（今日06:00 vs 昨日06:00）
  const morning = Engine.marketDaily(ov, fut, ph, new Date('2026-07-19T07:00:00+08:00'));
  assert.strictEqual(morning.tw.label, '昨日');
  assert.strictEqual(morning.us.label, '昨夜');
  // 昨夜美股：(425-420)*40*31 = +6,200；昨日台股：(36.2-36)*7000 + (990000-980000) = +11,400
  assert.strictEqual(morning.us.pnl, 6200, '早上昨夜美股 got ' + morning.us.pnl);
  assert.strictEqual(morning.tw.pnl, 11400, '早上昨日台股 got ' + morning.tw.pnl);

  // 只有一天資料時，需要前一日的那格要回 null 而不是壞掉
  const oneDay = Engine.marketDaily(ov, fut, ph.slice(3), new Date('2026-07-19T07:00:00+08:00'));
  assert.strictEqual(oneDay.hasPrev, false);
  assert.strictEqual(oneDay.us, null);

  // 數量變動的標的要被標記（提醒使用者當日進出的已實現損益不在裡面）
  const ph2 = ph.concat([['2026-07-19', '股', 'TSMX', 70, 0, 100, '06:00']]);
  const ov2 = { positions: ov.positions.concat([['美股', 'TSMX', 'TSMX', 50, 90, 72, 'USD', 31, 0, 0, 0]]) };
  const withSell = Engine.marketDaily(ov2, fut, ph2, new Date('2026-07-19T22:37:00+08:00'));
  assert.ok(withSell.us.changed.includes('TSMX'), '數量變動應列入 changed');
  assert.strictEqual(night.tw.baseTime, '06:00', '基準時間要跟著資料走，不能寫死');
  const noTime = Engine.marketDaily(ov, fut, ph.map(r => r.slice(0, 6)), new Date('2026-07-19T22:37:00+08:00'));
  assert.strictEqual(noTime.tw.baseTime, '', '沒記錄時間就留空，不假裝是 06:00');
  console.log('   分市場：晚上台股', night.tw.pnl, '/ 美股今晚', night.us.pnl, '｜早上昨夜美股', morning.us.pnl);
})();

// 年度績效
const yp = E.yearlyPerf(E.parseTrades(b.trades));
assert.ok(yp.length >= 3, '年度筆數: ' + yp.length);
assert.ok(yp.every((y, i) => i === 0 || y.year > yp[i-1].year), '年份遞增');
yp.forEach(y => {
  assert.strictEqual(y.trades, y.wins + y.losses, y.year + ' 交易次數=勝+敗');
  assert.ok(y.winRate >= 0 && y.winRate <= 1, y.year + ' 勝率範圍');
  if (y.profitFactor != null) assert.ok(y.profitFactor >= 0, y.year + ' 獲利因子非負');  // 整年只賠會是 0
  assert.ok(Math.abs(y.gross - y.loss - y.pnl) < 1, y.year + ' 總獲利-總虧損=淨損益');
  assert.ok(y.top.length <= 3 && y.bottom.length <= 3, y.year + ' 前三大');
});
const sumY = yp.reduce((s, y) => s + y.pnl, 0);
console.log('   年度績效:', yp.map(y => y.year + ' ' + Math.round(y.pnl).toLocaleString()).join(' | '));
console.log('   合計', Math.round(sumY).toLocaleString());

console.log('✅ all checks pass');
console.log('   0050對照終點: 我', cf[cf.length - 1].mine, '| 0050', cf[cf.length - 1].tw, '| 貢獻檔數:', ct.length);
console.log('   融資餘額(A8):', lc.marginBal, '| 月息:', lc.monthly);
console.log('   現金:', Math.round(ci.cash), '| 月支出中位:', ci.monthlySpend, '| 可撐:', ci.months.toFixed(1), '月');
console.log('   風險指標:', (fr.risk * 100).toFixed(0) + '%', '| 距警戒125%:', Math.round(fr.toWarn), '| 保證金使用率:', (fr.marginUtil * 100).toFixed(0) + '%');
console.log('   前五大:', (cc.top5 * 100).toFixed(0) + '%', '| 最大回撤:', (dd.maxDD * 100).toFixed(1) + '%', '| 今日:', Math.round(ty.today), '| 昨日:', ty.yesterday == null ? '—' : Math.round(ty.yesterday));
