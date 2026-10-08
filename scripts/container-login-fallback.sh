#!/bin/sh
# Optional protected fallback: its own failure never stops MCP/QR.
set -eu
state=/run/fanqie/login-fallback.json
monitor=/app/scripts/lib/login-fallback-monitor.mjs
vnc_pid=''
web_pid=''
vnc_identity=''
web_identity=''
fallback_code=worker_failed
cleanup() {
  [ -z "$web_identity" ] || node "$monitor" cleanup "$web_identity" >/dev/null 2>&1 || true
  [ -z "$vnc_identity" ] || node "$monitor" cleanup "$vnc_identity" >/dev/null 2>&1 || true
  [ -z "$web_pid" ] || wait "$web_pid" 2>/dev/null || true
  [ -z "$vnc_pid" ] || wait "$vnc_pid" 2>/dev/null || true
  node "$monitor" finalize "$state" "$FANQIE_LOGIN_FALLBACK_INSTANCE" "$fallback_code" >/dev/null 2>&1 || true
  unset vnc_pass
}
trap cleanup EXIT
node "$monitor" state "$state" "$FANQIE_LOGIN_FALLBACK_INSTANCE" starting checking >/dev/null 2>&1
fallback_code=password_unavailable
vnc_pass=$(cat /run/fanqie/login-fallback-secret 2>/dev/null)
[ -n "$vnc_pass" ] || exit 1
x11vnc -storepasswd "$vnc_pass" /run/fanqie/vnc-passwd >/dev/null 2>&1
unset vnc_pass
x11vnc -display :99 -rfbauth /run/fanqie/vnc-passwd -localhost -forever -shared -noxdamage -noshm >/dev/null 2>&1 &
vnc_pid=$!
vnc_identity=$(node "$monitor" identity "$vnc_pid" "$$" 2>/dev/null)
fallback_code=rfb_unavailable
node "$monitor" rfb "$state" "$FANQIE_LOGIN_FALLBACK_INSTANCE" "$vnc_identity" >/dev/null 2>&1
websockify --web=/usr/share/novnc/ 0.0.0.0:6080 localhost:5900 >/dev/null 2>&1 &
web_pid=$!
web_identity=$(node "$monitor" identity "$web_pid" "$$" 2>/dev/null)
fallback_code=probe_failed
node "$monitor" monitor "$state" "$FANQIE_LOGIN_FALLBACK_INSTANCE" "$vnc_identity" "$web_identity" >/dev/null 2>&1
