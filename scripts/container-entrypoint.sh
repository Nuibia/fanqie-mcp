#!/bin/sh
set -eu
mkdir -p /run/fanqie /data/profile /data/runtime /data/uploads /data/evidence
cp /run/secrets/api_token /run/fanqie/api-token
chown -R pwuser:pwuser /run/fanqie /data
chmod 700 /run/fanqie /data
chmod 600 /run/fanqie/api-token
# These files belong to this container's fixed display. Container stop can leave
# them behind; a socket alone does not prove that an X server is running.
[ ! -L /tmp/.X99-lock ] && [ ! -L /tmp/.X11-unix/X99 ] || { echo "Unexpected virtual display links" >&2; exit 1; }
for display_comm_path in /proc/[0-9]*/comm; do
  [ -e "$display_comm_path" ] || continue
  display_process=$(cat "$display_comm_path" 2>/dev/null || true)
  case "$display_process" in
    Xvfb|Xorg|X) echo "An X server is already running in this container" >&2; exit 1 ;;
    '') if [ -e "$display_comm_path" ]; then
          echo "Could not verify container display processes" >&2; exit 1
        fi ;;
  esac
done
if [ -f /tmp/.X99-lock ]; then
  display_lock_pid=$(tr -d '[:space:]' </tmp/.X99-lock)
  case "$display_lock_pid" in
    ''|*[!0-9]*) echo "Invalid virtual display lock" >&2; exit 1 ;;
    *) if kill -0 "$display_lock_pid" 2>/dev/null; then
         display_lock_process=$(cat "/proc/$display_lock_pid/comm" 2>/dev/null || true)
         case "$display_lock_process" in
           Xvfb|Xorg|X) echo "Virtual display lock belongs to a running X server" >&2; exit 1 ;;
           '') echo "Could not verify virtual display lock owner" >&2; exit 1 ;;
         esac
       fi ;;
  esac
fi
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /run/fanqie/display.ready
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp -displayfd 3 3>/run/fanqie/display.ready >/run/fanqie/display.log 2>&1 &
display_pid=$!
display_attempt=0
while [ ! -s /run/fanqie/display.ready ]; do
  display_attempt=$((display_attempt + 1))
  if ! kill -0 "$display_pid" 2>/dev/null || [ "$display_attempt" -ge 100 ]; then
    echo "Virtual display did not start" >&2
    exit 1
  fi
  sleep 0.1
done
[ "$(tr -d '[:space:]' </run/fanqie/display.ready)" = 99 ] || { echo "Unexpected virtual display" >&2; exit 1; }
gosu pwuser fluxbox >/dev/null 2>&1 &
# VNC is optional. Its log/worker failures must not delay or stop MCP/QR.
FANQIE_LOGIN_FALLBACK_INSTANCE=$(node -e "process.stdout.write(require('node:crypto').randomUUID())")
export FANQIE_LOGIN_FALLBACK_INSTANCE
/bin/sh -c '
  set -eu
  umask 077
  [ ! -L /run/fanqie/login-fallback.log ] && [ ! -L /run/fanqie/login-fallback-secret ] || exit 1
  cp /run/secrets/vnc_password /run/fanqie/login-fallback-secret
  chown pwuser:pwuser /run/fanqie/login-fallback-secret
  chmod 600 /run/fanqie/login-fallback-secret
  : >/run/fanqie/login-fallback.log
  chown pwuser:pwuser /run/fanqie/login-fallback.log
  chmod 600 /run/fanqie/login-fallback.log
  exec gosu pwuser /bin/sh /app/scripts/container-login-fallback.sh >/run/fanqie/login-fallback.log 2>&1
' >/dev/null 2>&1 &
exec gosu pwuser node /app/dist/index.js
