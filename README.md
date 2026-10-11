# work-meter

Claude Code mod：在輸入框上方顯示

- **工作進度**：任務清單完成數與進度條、正在做的項目、本回合耗時與工具呼叫次數
- **帳號額度**：5 小時 / 7 天 rate limit 各剩多少 % 與重置倒數，另有 context 用量與本 session 花費

指令：`/meter` 開詳細面板；`/meter hide`、`/meter show` 隱藏或顯示上方橫條。

非官方的個人專案，與 Anthropic 無關。

## 需求

- Claude Code **2.1.296 或更新**。mod 的 function hooks API 仍是 early access，版本差太多可能無法載入；這項功能是否可用，也可能因帳號或伺服器設定而異。
- 額度只在訂閱帳號、且收到第一次 API 回應後才會出現；API key 帳號只會顯示 context 與花費。
- 橫條只畫在終端機與桌面版；VS Code 擴充套件與手機請用 `/meter` 開面板。
- 新對話一開始只會有一行簡略的額度列，進度列要等第一個回合開始才出現。

## 安裝

### 方式 A：從 GitHub 安裝

```
claude plugin install work-meter --marketplace https://github.com/evasuka/work-meter.git
```

也可以在 Claude Code 對話裡輸入 `/plugin install work-meter --marketplace https://github.com/evasuka/work-meter.git`；出現 `Add marketplace?` 按 `y`，scope 建議選 user。不需要任何 GitHub 帳號或認證，請使用完整網址。

安裝後新開的對話會自動載入；已開著的對話請輸入 `/reload-plugins`。輸入 `/meter`：出現在指令選單並開啟面板，就代表已載入。

### 方式 B：先 clone，再從本機資料夾安裝

想先看過原始碼，或需要離線使用時：

```
git clone https://github.com/evasuka/work-meter.git ~/claude-mods/work-meter
claude plugin install work-meter --marketplace ~/claude-mods/work-meter
```

這種方式 Claude Code 會直接讀那個資料夾（不會另外複製一份），資料夾搬動或刪除後 mod 就失效。

### 只想試用（不安裝）

先依方式 B clone，然後：

```
claude --plugin-dir ~/claude-mods/work-meter
```

只對這一次啟動的 session 有效。

## 隱私與安全

mod 只在本機執行：不會發出任何網路請求，也不會讀寫檔案或執行外部程式。它讀取目前 session 的用量資訊（rate limit、context、花費）與工具呼叫事件，並顯示在畫面上；橫條會顯示工具呼叫的名稱與參數片段（例如 Bash 指令的第一行）。這些內容只出現在你的畫面上，mod 不會把它們寫入檔案或傳送出去。原始碼在 `hooks/`，可自行檢視。

## 更新與移除

- 更新：`claude plugin update work-meter@work-meter-marketplace`，再於對話裡輸入 `/reload-plugins`。
- 移除：`claude plugin uninstall work-meter@work-meter-marketplace`，再執行 `claude plugin marketplace remove work-meter-marketplace`。

## 開發與測試

```
claude plugin validate .
claude plugin test .
```

編輯器型別提示：用 `claude --plugin-dir .` 載入一次，Claude Code 會在 `.claude-plugin/types/` 產生型別宣告。

## 授權

[MIT License](LICENSE)
