# Family Bank · 家庭银行

![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22family-bank%22%5D.downloads&url=https%3A%2F%2Freleases.obsidian.md%2Fstats)

## English

A fixed-deposit savings manager for children. Each child has an independent account; deposits earn interest, and saving goals are always visible.

- **Two savings products**: Monthly deposit (0.5%/month) and yearly deposit (7%/year)
- **Automatic interest settlement**: Interest accrues per full period; settle as cash or roll it into a new deposit
- **Deduction tracking**: Reduce a deposit proportionally or by a specific one, with a reason recorded
- **Saving goals**: Set a target amount with a real-time progress bar
- **Asset chart**: Track total assets over time, hover for details
- **Deposit pie chart**: Monthly vs yearly allocation
- **Sibling comparison**: Leaderboard with leading amount
- **Dynamic accounts**: Add or remove children anytime
- **Auto-save**: Data written to a JSON file inside your vault
- **Cross-device sync**: Works with Remotely Save / Obsidian Sync

### Installation

**Option 1 — Community plugins (recommended)**
1. Open Settings → Community plugins → Browse
2. Search for "Family Bank"
3. Install → Enable

**Option 2 — BRAT**
1. Install the BRAT plugin
2. Add the repo: `https://github.com/kumoonet/obsidian-family-bank`

**Option 3 — Manual**
1. Download the latest release from GitHub
2. Extract into `.obsidian/plugins/family-bank/`
3. Restart Obsidian and enable the plugin

### Usage

Click the wallet icon in the left ribbon to open the Family Bank dashboard.

- **Dashboard**: total assets (monthly + yearly principal), asset chart, deposit pie chart, sibling comparison, goal progress
- **Banking**: "New fixed deposit" to save money (choose monthly or yearly, tag a source like 压岁钱/零花钱/奖励); "Settle interest" per full period; "Details" to inspect each deposit; "Settlement history" to review and revert
- **Manage**: set/delete saving goals, deduct deposits (proportional or specific, with reason), manage deposits, add/remove accounts, export data / import restore / reset

### Data

Data file (default): `家庭银行数据.json` in your vault root. The path is configurable in plugin settings.

### License

MIT

---

## 中文

儿童定期存款管理系统。每个孩子独立账户，存钱进去产生利息，攒钱目标看得见。

> 🏦 银行只记录定存，日常花销不记在这里。利息结算可选现金拿走，或自动转存为新定期。

### 功能

- **两个储蓄产品**：月定存（0.5%/月）和年定存（7%/年）
- **自动利息结算**：满完整周期自动计息，不满的继续留着；结算方式可选现金拿走或自动转存新定期
- **定存扣减**：按比例分摊或指定某笔，记录扣减原因
- **攒钱目标**：设定目标金额，进度条实时显示
- **资产走势图**：总资产变化一目了然，鼠标悬停看数据
- **定存占比饼图**：月/年定存分布
- **两个孩子对比**：排行榜 + 领先金额
- **动态增删账户**：不是固化的两个孩子，可随时增减
- **数据自动保存**：写入 vault 内 JSON 文件
- **跨设备同步**：配合 Remotely Save / Obsidian Sync 自动同步

### 安装

**方法一：社区市场（推荐）**
1. 打开 Obsidian 设置 → 社区插件 → 点击「浏览」
2. 搜索 **Family Bank**（中文暂不支持搜索，官方未来会支持本地化名称）
3. 点击安装 → 启用

**方法二：BRAT**
1. 安装 BRAT 插件
2. 添加仓库：`https://github.com/kumoonet/obsidian-family-bank`

**方法三：手动**
1. 从 GitHub Release 下载最新版
2. 解压到 `.obsidian/plugins/family-bank/`
3. 重启 Obsidian，启用插件

### 使用

点击左侧钱包图标打开家庭银行看板。

**看板**
显示总资产（月定存 + 年定存本金总和）、资产走势图、定存占比、两个孩子对比排行、攒钱目标进度。

**理财**
- 点「新增定期存款」存钱，可选月定存或年定存，可标注来源（压岁钱/零花钱/奖励）
- 点「结算利息」按完整周期结息
- 点「明细」查看每笔存款的状态，可单独取回
- 点「结息记录」查看历史结息明细，可撤回

**管理**
进入管理模式后可：
- 设定/删除攒钱目标
- 定存扣减（按比例或指定某笔，记录原因）
- 管理定期存款（查看、取回）
- 增删账户
- 导出数据到 vault 文件 / 导入恢复 / 清零

### 数据

数据文件路径（默认）：`家庭银行数据.json`（vault 根目录）
可在插件设置中修改路径。

### License

MIT
