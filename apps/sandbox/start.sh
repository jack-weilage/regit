#!/bin/sh
ca=/etc/cloudflare/certs/cloudflare-containers-ca.crt
if [ -f "$ca" ]; then
	cp "$ca" /usr/local/share/ca-certificates/cloudflare-containers-ca.crt
	update-ca-certificates >/dev/null
fi
exec regit-sandbox
