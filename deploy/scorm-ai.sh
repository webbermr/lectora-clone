#!/bin/sh
# Sets up SCORM (the editor's AI assistant) when the container starts.
# With ANTHROPIC_API_KEY set, the server passes the assistant's requests on to Anthropic and adds the key
# itself, so the key never reaches anyone's browser. Without it, people can enter their own key in SCORM.
set -eu
dir=/tmp/scorm-ai
mkdir -p "$dir"
rm -f "$dir"/*.conf
key="${ANTHROPIC_API_KEY:-}"
if [ -n "$key" ]; then
  case "$key" in
    *[!A-Za-z0-9_-]*) echo "scorm-ai: ANTHROPIC_API_KEY has unexpected characters; SCORM's server key is off." >&2; key="" ;;
  esac
fi
if [ -n "$key" ]; then
  # The DNS server the container uses (Docker's own on a compose network), for looking up api.anthropic.com.
  ns="${SCORM_AI_RESOLVER:-$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null)}"
  case "$ns" in
    "") ns=127.0.0.11 ;;
    *:*) ns="[$ns]" ;;
  esac
  cat > "$dir/anthropic.conf" <<CONF
# Only the Messages API, with the server's key; nothing from the browser's own credentials is passed on.
location = /api/anthropic/v1/messages {
    limit_except POST { deny all; }
    resolver $ns ipv6=off valid=300s;
    set \$anthropic https://api.anthropic.com;
    proxy_pass \$anthropic/v1/messages\$is_args\$args;
    proxy_ssl_server_name on;
    proxy_set_header Host api.anthropic.com;
    proxy_set_header x-api-key "$key";
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_set_header Origin "";
    proxy_set_header Referer "";
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 600s;
    client_max_body_size 32m;
}
CONF
  echo '{"server":true}' > "$dir/status.json"
  echo "scorm-ai: server key on"
else
  echo '{"server":false}' > "$dir/status.json"
  echo "scorm-ai: no server key (people can enter their own in SCORM)"
fi
