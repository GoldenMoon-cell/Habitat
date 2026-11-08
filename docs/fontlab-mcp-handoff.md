# FontLab 9 MCP 接入说明

> 给 Claude Desktop / 其他 MCP 客户端。这套做法已在 DeepSeek Harness 上实测跑通
> （推了 89 个字形进 FontLab，跑过 remove_overlap，全程稳定）。

## 一句话结论

**`fontlab-mcp.exe` 只是个 46 KB 的 stdio 桥，它连的是「正在运行的 FontLab 9 主程序」。**
报 `Cannot connect to FontLab 9` 时，99% 是下面三件事之一。

## 配置

```json
{
  "mcpServers": {
    "fontlab": {
      "command": "D:\\Program Files\\Fontlab\\FontLab 9\\fontlab-mcp.exe",
      "args": []
    }
  }
}
```

- **transport：stdio**（不是 HTTP，没有端口）
- **args：留空** —— 这个 exe 不接任何命令行参数
- 路径含空格没关系，整条字符串即可

## 报错 `Cannot connect to FontLab 9` 的四个真实原因

按发生频率排：

### 1. FontLab 主程序没在运行
这是桥，不是服务。FontLab 关着，它连不上很正常。

**判断方法**：看窗口标题
- `FontLab 9` ← 主界面，正常
- `FontLab: <文件名>` ← 主界面 + 打开了字体，正常
- **`FontLab 崩溃报告`** ← **这是坏的**，见下面第 3 条

### 2. Preferences > Aidus 没允许外部 MCP 客户端
路径：`Preferences（偏好设置） > Aidus` → 勾上允许外部 MCP 客户端的开关。
报错信息里那句 "enable external MCP clients in Preferences > Aidus" 说的就是这个。

### 3. FontLab 卡在「崩溃报告」窗口，起不来主界面
**这是我们踩过的最深的坑。** 症状：每次启动只弹一个「FontLab 崩溃报告」窗口，
主界面永远不出来，MCP 自然连不上。Windows 事件日志里**没有**崩溃记录，
也**没有**任何 dump / log 文件。

**修法**（实测有效，保留激活和 MCP token）：

```powershell
# 1. 结束所有 FontLab 进程
Get-Process | Where-Object { $_.ProcessName -match 'FontLab' } | Stop-Process -Force

# 2. 删掉崩溃状态目录
Remove-Item "$env:LOCALAPPDATA\Fontlab\fontlab9" -Recurse -Force

# 3. 清空 Autosave（坏掉的恢复点会让它继续崩）
Remove-Item "$env:LOCALAPPDATA\Fontlab\FontLab 9\Autosave\*" -Force

# 4. 重新启动
& "D:\Program Files\Fontlab\FontLab 9\FontLab 9.exe"
```

**不要删的**：
- `%LOCALAPPDATA%\Fontlab\FontLab 9\Licenser\` —— 激活信息
- `%LOCALAPPDATA%\Fontlab\MCP\token` —— MCP 令牌

**至于它为什么会崩**：往 FontLab 里塞**大量互相重叠的子路径**会把它内部状态搞坏。
我们第一版每个字形展开成 4~19 个重叠矩形（整张表 664 条子路径），
推完就崩了。换成合并过的轮廓（549 条、无重叠）后完全稳定。
**如果你也要生成字形：先做布尔合并，别把重叠矩形直接灌进去。**

### 4. 多个客户端同时连
桥是单实例的。如果另一个客户端（比如另一个 IDE 或脚本）正在占用，
新起的会话可能连不上。先确认没有别的东西在连。

## 手动验证（不依赖任何客户端）

它是标准 JSON-RPC over stdin/stdout，一行一条：

```powershell
$exe = "D:\Program Files\Fontlab\FontLab 9\fontlab-mcp.exe"
$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
$list = '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
"`n$init`n$list" | & $exe
```

**成功的样子**：
```json
{"id":1,...{"serverInfo":{"name":"FontLab 9","version":"1.0.0"}}}
{"id":2,"result":{"tools":[...49 个工具...]}}
```

**失败的样子**：
```json
{"error":{"code":-32000,"message":"Cannot connect to FontLab 9. ..."}}
```

关键点：**`initialize` 会成功，`tools/list` 才报错。**
说明协议层是通的，断在「连不上 FontLab 主程序」那一步 —— 所以不是客户端配置错了，是 FontLab 侧的问题。

## 49 个工具里最常用的

| 工具 | 用途 |
|---|---|
| `new_font` / `open_font` / `save_font` | 字体生命周期（**`save_font` 只认 .vfj/.vfc/.vfjp，导不出 OTF**） |
| `set_glyph` / `get_glyph` | 写 / 读单个字形（`glyph_data` = layers[].elements[].elementData.contours[].nodes_list[]） |
| `run_actions` | 跑 FontLab 内置动作：`remove_overlap` `round_to_integer` `auto_kern` `adjust_stems` `cleanup` … |
| `run_python` | 在 FontLab 的 Python 环境里跑代码（有 `fontlab` / `fontgate` / `FL` 模块） |
| `get_preferences` / `set_preferences` | 读写 FontLab 设置 |

**导出 OTF/TTF 不要走 MCP** —— `save_font` 只支持 FontLab 自家格式，
OTF 要用 `ExportControl`，那是个需要 Qt 上下文的类，`run_python` 里
`ExportControl.init()` 会报 `unbound method needs an argument`。

**建议的分工**：
- FontLab：编辑、看效果、跑 `remove_overlap` 这类动作
- **fonttools**：出最终产物（`FontBuilder` + `TTGlyphPen`，确定性，不依赖 GUI）

我们就是这么分工的：字形数据在 JS 里是坐标表 → Node 展开成轮廓 →
Python `skia-pathops` 合并 → `fonttools` 打包成 4~6 KB 的 woff2。
FontLab 只是「肉眼看 + 手动调」的那一环，它坏了不影响出片。
