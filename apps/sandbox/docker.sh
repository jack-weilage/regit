#!/bin/sh
# Docker in a Cloudflare Container: the daemon starts on first use and can't manage iptables or IP forwarding
# (/proc/sys is read-only), so there is no bridge network. Builds use the host network instead.
if ! /usr/bin/docker version >/dev/null 2>&1; then
	exec 9>/run/regit-dockerd.lock
	flock 9
	if ! /usr/bin/docker version >/dev/null 2>&1; then
		setsid dockerd --iptables=false --ip6tables=false --ip-forward=false --bridge=none >/var/log/dockerd.log 2>&1 9>&- &
		daemon=$!
		tries=0
		until /usr/bin/docker version >/dev/null 2>&1; do
			tries=$((tries + 1))
			if ! kill -0 "$daemon" 2>/dev/null || [ "$tries" -gt 120 ]; then
				echo 'The Docker daemon did not start:' >&2
				grep -E 'level=(error|fatal)|^failed' /var/log/dockerd.log | tail -n 20 >&2
				exit 1
			fi
			sleep 0.5
		done
	fi
	exec 9>&-
fi
case "$1 $2" in
"build "*)
	shift
	exec /usr/bin/docker build --network=host "$@"
	;;
"buildx build")
	shift 2
	exec /usr/bin/docker buildx build --network=host "$@"
	;;
esac
exec /usr/bin/docker "$@"
