# work-meter

Claude Code mod：在輸入框上方顯示

- **工作進度**：任務清單完成數與進度條、正在做的項目、本回合耗時與工具呼叫次數
- **帳號額度**：5 小時 / 7 天 rate limit 各剩多少 % 與重置倒數，另有 context 用量與本 session 花費
- **額度警示**：剩餘額度低於門檻（預設 20%、10%）時提醒一次，額度恢復時也會提醒
- **Token 數**：上回合與本 session 的 token 用量，面板另有輸入、輸出、快取讀、快取寫四項明細
- **長回合通知**（選用，預設關閉）：回合跑很久之後，透過你自己的通知管道提醒
- **額度用完暫停**：5 小時額度用完時，中止進行中的回合並暫停新工作，避免繼續燒 extra usage；可以選擇暫停或繼續

指令：`/meter` 開詳細面板；`/meter hide`、`/meter show` 隱藏或顯示上方橫條；`/meter resume` 在額度用完暫停後繼續工作。

非官方的個人專案，與 Anthropic 無關。

## 需求

- Claude Code **2.1.296 或更新**。mod 的 function hooks API 仍是 early access，版本差太多可能無法載入；這項功能是否可用，也可能因帳號或伺服器設定而異。
- 額度只在訂閱帳號、且收到第一次 API 回應後才會出現；API key 帳號只會顯示 context 與花費，也不會有額度警示。
- 額度資訊只有「已用 %」與重置時間，沒有剩餘 token 數；顯示的 token 數是各回合實際用量的加總，不是額度。
- 橫條只畫在終端機與桌面版；VS Code 擴充套件與手機請用 `/meter` 開面板。
- 新對話一開始只會有一行簡略的額度列，進度列要等第一個回合開始才出現。

## 設定

在 `/config` 找到下列設定列，修改後會自動重新載入：

| 設定 | 預設 | 說明 |
| --- | --- | --- |
| `work-meter.alerts` | 開 | 額度警示開關 |
| `work-meter.alertThresholds` | `20,10` | 警示門檻（剩餘 %），以逗號分隔、由大到小 |
| `work-meter.showTokens` | 開 | 在橫條與面板顯示 token 數 |
| `work-meter.longTurnNotifySeconds` | `0` | 回合耗時超過這個秒數時通知；0 為關閉 |
| `work-meter.limitAction` | `ask` | 5 小時額度用完時：`ask` 先暫停再問你、`pause` 直接暫停、`off` 不處理 |
| `work-meter.pauseAtUsed` | `100` | 5 小時額度已用到這個 %（1 到 100）就觸發暫停 |

長回合通知要靠你自己的通知管道，需先在 `/config` 設定通知方式；沒有設定時不會有任何效果。

## 額度用完暫停

5 小時額度的已用 % 達到 `pauseAtUsed`（預設 100）時：

1. 先中止進行中的回合，免得在等你回答的時候繼續燒額度。
2. 暫停新工作：新的提示會被拒絕，並告訴你幾時重置、怎麼繼續。橫條會顯示「⏸ 已暫停」。
3. `limitAction` 為 `ask`（預設）時會跳出對話框，讓你選「暫停到重置」或「繼續使用 extra usage」；關掉對話框或沒人回答，就維持暫停。
4. 額度重置時自動恢復；或隨時輸入 `/meter resume` 繼續，同一個額度視窗內不會再自動暫停。重新載入外掛不會讓暫停卡住：重置時間一過，下一個提示就會直接通過。
5. 想關掉：把 `work-meter.limitAction` 設成 `off`，會立刻停用，不用等重置。

限制：

- 守衛只對目前這個 session 生效。同時開著多個對話（例如背景對話）時，一個對話暫停不會讓其他對話停下；每個新對話在收到第一筆用量讀數之前，也還是會先送出一個請求。

- Claude Code 不會告訴外掛是否開啟了 extra usage，所以只能用「5 小時額度的已用 %」判斷。沒開 extra usage 的帳號，額度用完時 API 本來就會拒絕請求，這個功能只是更早、更清楚地停下來。
- 只看 5 小時額度，不處理 7 天額度。
- 中止的是主對話的回合；背景的 subagent 或 workflow 是否會一併停下，尚未驗證。
- 剛開的新 session 還沒有用量讀數，額度已用完時第一個請求仍可能送出，收到讀數後才會暫停。
- 想先試試看會不會動：把 `work-meter.pauseAtUsed` 調低（例如目前用量以下的數字），下一次回合結束就會觸發。

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

mod 只在本機執行：不會發出任何網路請求，也不會讀寫檔案或執行外部程式。它讀取目前 session 的用量資訊（rate limit、context、花費）與工具呼叫事件，並顯示在畫面上；橫條會顯示工具呼叫的名稱與參數片段（例如 Bash 指令的第一行）。這些內容只出現在你的畫面上，mod 不會把它們寫入檔案或傳送出去。額度警示以畫面上的提示呈現；長回合通知（預設關閉）只會透過你自己設定的通知管道發出。token 數與警示記錄只保存在 session 的狀態裡，mod 不會把它們寫入檔案。額度用完暫停會在觸發時中止回合、拒絕新提示，這是 mod 唯一會干預工作流程的地方，可用 `work-meter.limitAction` 設成 `off` 關閉。原始碼在 `hooks/`，可自行檢視。

## 更新與移除

- 更新：`claude plugin update work-meter@work-meter-marketplace`，再於對話裡輸入 `/reload-plugins`。
- 移除：`claude plugin uninstall work-meter@work-meter-marketplace`，再執行 `claude plugin marketplace remove work-meter-marketplace`。

## 開發與測試

```
claude plugin validate .
claude plugin test .
```

編輯器型別提示：用 `claude --plugin-dir .` 載入一次，Claude Code 會在 `.claude-plugin/types/` 產生型別宣告。

## 更新紀錄

- 0.3.0：新增額度用完暫停（`limitAction`、`pauseAtUsed`、`/meter resume`）
- 0.2.0：新增額度警示、token 數、長回合通知（選用）與設定選項
- 0.1.0：首次發佈

## 授權

[MIT License](LICENSE)
