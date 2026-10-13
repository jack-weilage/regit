#!/bin/sh
# Docker in a Cloudflare Container: the daemon starts on first use and can't manage iptables, so containers on
# Docker's bridge network have no internet. Builds use the host network instead.
if ! /usr/bin/docker version >/dev/null 2>&1; then
	exec 9>/run/regit-dockerd.lock
	flock 9
	if ! /usr/bin/docker version >/dev/null 2>&1; then
		setsid dockerd --iptables=false --ip6tables=false >/var/log/dockerd.log 2>&1 9>&- &
		tries=0
		until /usr/bin/docker version >/dev/null 2>&1; do
			tries=$((tries + 1))
			if [ "$tries" -gt 120 ]; then
				echo 'The Docker daemon did not start; see /var/log/dockerd.log' >&2
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
