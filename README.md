# 資產儀表板 asset-dashboard

開源、無伺服器的個人資產儀表板。資料存在你自己的 Google Sheet，
由你自己的 Google Apps Script 提供 API，這個網頁只在你的瀏覽器裡把它畫出來。
**你的財務資料不會經過任何第三方伺服器。**

## 功能
- 總覽卡：總資產、已實現/未實現、期貨權益與風險指標、槓桿利息
- 月度績效：投資月報酬（對入金免疫的算法）、TWR 累積曲線 vs 0050 / SPY、α
- 個股表現：自動發現所有標的、FIFO 已實現、真實金流日期的年化 XIRR、勝率
- 支出與儲蓄：每月分類堆疊、薪資 vs 支出

## 快速開始
1. 複製 Google Sheet 模板並部署 Apps Script（見 SETUP.md，撰寫中）
2. 打開本網頁 → 貼上你的 Apps Script 網址與金鑰 → 完成

設定只存在瀏覽器 localStorage。換裝置重貼一次即可。
