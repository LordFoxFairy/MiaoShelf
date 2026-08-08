#!/bin/bash
# 定时同步管理：开 / 关 / 改间隔 / 查状态 / 看日志 / 立即跑。
#
# 为什么定时任务必须在本机跑：ldxp.cn 按出口 IP 判定，境外/机房/公开代理 IP
# 一律弹滑动验证码，只有你本机的国内住宅 IP 直连畅通（2026-08-08 实测）。
#
# 用法：
#   pnpm schedule                查看状态
#   pnpm schedule on             开启（默认 30 分钟）
#   pnpm schedule on 15          开启，每 15 分钟
#   pnpm schedule every 60       只改间隔，不动开关状态
#   pnpm schedule off            关闭
#   pnpm schedule run            立刻手动跑一次
#   pnpm schedule logs           跟踪日志
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.miaokit.catalog.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$PROJECT_DIR/data/sync.log"
STATE="$PROJECT_DIR/data/sync-state.json"

mkdir -p "$PROJECT_DIR/data"

# launchd 的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，nvm 装的 pnpm/node 都不在里面，
# 而且它不走登录 shell（`bash -lc` 也加载不到 nvm）。所以必须把绝对路径写死进 plist。
PNPM_BIN="$(command -v pnpm || true)"
if [ -z "$PNPM_BIN" ]; then
  echo "✗ 找不到 pnpm，无法配置定时任务"; exit 1
fi
NODE_DIR="$(dirname "$PNPM_BIN")"

# 不要写成 `launchctl list | grep -q`：grep -q 命中即退出，launchctl 收到
# SIGPIPE 返回非零，pipefail 会把整条管道判成失败 —— 明明加载了却报「未加载」。
is_loaded() {
  local out
  out="$(launchctl list 2>/dev/null)"
  case "$out" in *"$LABEL"*) return 0 ;; *) return 1 ;; esac
}

# launchctl load 之后 launchd 注册有延迟，紧接着查会读到旧状态。
# 短暂重试几次再下结论，否则会误报「加载失败」。
wait_loaded() {
  for _ in 1 2 3 4 5 6; do
    is_loaded && return 0
    sleep 0.3
  done
  return 1
}

current_interval() {
  # 从 plist 里读回当前间隔，改间隔时不用用户重复输入
  [ -f "$PLIST" ] || { echo ""; return; }
  /usr/libexec/PlistBuddy -c "Print :StartInterval" "$PLIST" 2>/dev/null || echo ""
}

write_plist() {
  local seconds="$1"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd "$PROJECT_DIR" &amp;&amp; "$PNPM_BIN" sync --deploy</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <!-- 抖动上限 = 一个间隔，所以实际间隔在 [N, 2N] 分钟之间随机 -->
    <key>SYNC_JITTER_MAX_MS</key><string>$(( seconds * 1000 ))</string>
  </dict>
  <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
  <key>StartInterval</key><integer>$seconds</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF
}

reload() {
  # 先验语法——plist 里 & 之类没转义会静默失败，很难查
  if ! plutil -lint "$PLIST" >/dev/null 2>&1; then
    echo "✗ plist 格式有误："; plutil -lint "$PLIST"; return 1
  fi
  launchctl unload "$PLIST" 2>/dev/null
  # 注意不要用管道过滤输出——空输出会让 pipefail 判定整条失败
  local out
  out="$(launchctl load "$PLIST" 2>&1)"
  [ -n "$out" ] && echo "$out"
  return 0
}

show_status() {
  echo "定时同步状态"
  echo "────────────────────────────"
  if is_loaded; then
    local sec; sec="$(current_interval)"
    echo "  开关     ● 已开启"
    [ -n "$sec" ] && echo "  间隔     $(( sec / 60 ))-$(( sec / 30 )) 分钟（带随机抖动）"
  else
    echo "  开关     ○ 已关闭"
    [ -f "$PLIST" ] && echo "           （配置还在，pnpm schedule on 可直接恢复）"
  fi

  if [ -f "$STATE" ]; then
    echo ""
    node -e '
      const s = require(process.argv[1]);
      const ok = s.ok ? "✓ 成功" : "✗ 失败";
      const t = new Date(s.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      const ago = Math.round((Date.now() - new Date(s.at)) / 60000);
      console.log(`  上次同步 ${t}（${ago} 分钟前）`);
      console.log(`  结果     ${ok}`);
      if (s.ok) {
        console.log(`  商品     ${s.items} 件（${s.sold} 件售罄）`);
      } else {
        console.log(`  连续失败 ${s.failStreak ?? 1} 次`);
        const e = String(s.error ?? "");
        const m = e.toLowerCase();
        let hint = e.slice(0, 90);
        if (/oauth|unauthorized|authentication|10000|expired|invalid token/.test(m))
          hint = "Cloudflare 登录过期 → 跑 wrangler login 重新授权";
        else if (/挑战页|forbidden|滑动验证|waf/.test(e))
          hint = "货源平台拦截 → 检查出口 IP 是否变了";
        else if (/timeout|econnreset|network|fetch failed/.test(m))
          hint = "网络不通 → 通常自己会恢复";
        console.log(`  怎么办   ${hint}`);
      }
    ' "$STATE" 2>/dev/null || echo "  （状态文件读不出来）"
  else
    echo ""
    echo "  上次同步 —（还没跑过）"
  fi

  # 登录态是最容易悄悄失效的一环，状态面板顺手查一下
  if npx wrangler whoami >/dev/null 2>&1; then
    echo "  部署授权 ● 有效"
  else
    echo "  部署授权 ✗ 已失效 → 跑 wrangler login 重新授权"
  fi

  echo ""
  echo "  日志     $LOG"
  echo "────────────────────────────"
  echo "  开启 pnpm schedule on [分钟]  ·  关闭 pnpm schedule off"
  echo "  改间隔 pnpm schedule every 15 ·  立即跑 pnpm schedule run"
}

case "${1:-status}" in
  on)
    minutes="${2:-}"
    if [ -z "$minutes" ]; then
      sec="$(current_interval)"
      minutes=$(( ${sec:-1800} / 60 ))   # 没传就沿用上次的，默认 30 分钟
    fi
    if ! [[ "$minutes" =~ ^[0-9]+$ ]] || [ "$minutes" -lt 1 ]; then
      echo "✗ 间隔要是大于 0 的整数分钟"; exit 1
    fi
    write_plist $(( minutes * 60 ))
    reload
    if wait_loaded; then
      echo "✓ 已开启：每 $minutes-$(( minutes * 2 )) 分钟同步一次（随机抖动）"
      echo "  下一次在 $minutes 分钟后；想立刻跑一次用 pnpm schedule run"
    else
      echo "✗ 加载失败，看看 $LOG"; exit 1
    fi
    ;;

  off)
    launchctl unload "$PLIST" 2>/dev/null
    if is_loaded; then echo "✗ 关闭失败"; exit 1; fi
    echo "✓ 已关闭（配置保留，pnpm schedule on 可直接恢复）"
    ;;

  every)
    minutes="${2:-}"
    if ! [[ "$minutes" =~ ^[0-9]+$ ]] || [ "$minutes" -lt 1 ]; then
      echo "用法：pnpm schedule every <分钟>"; exit 1
    fi
    was_on=false; is_loaded && was_on=true
    write_plist $(( minutes * 60 ))
    # 原来开着就重载让新间隔生效；原来关着就只改配置，不擅自打开
    if $was_on; then reload; echo "✓ 间隔已改为 $minutes 分钟（已生效）"
    else echo "✓ 间隔已改为 $minutes 分钟（当前是关闭状态，开启后生效）"; fi
    ;;

  run)
    echo "手动同步中…"
    cd "$PROJECT_DIR" && pnpm sync --deploy
    ;;

  logs)
    [ -f "$LOG" ] || { echo "还没有日志"; exit 0; }
    tail -f "$LOG"
    ;;

  status|"")
    show_status
    ;;

  *)
    echo "未知命令：$1"
    echo "可用：status / on [分钟] / off / every <分钟> / run / logs"
    exit 1
    ;;
esac
