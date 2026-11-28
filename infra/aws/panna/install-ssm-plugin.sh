#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s):$(uname -m)" = Darwin:x86_64
work="$(mktemp -d "${RUNNER_TEMP:?}/panna-ssm.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
package="$work/session-manager-plugin.pkg"
curl -fsS --proto '=https' --max-time 60 --retry 2   https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/session-manager-plugin.pkg -o "$package"
printf '%s  %s\n' b95139a76cb473654d92185c200ac65205244b20f96aeb240b53837ba4973084 "$package" | shasum -a 256 -c -
pkgutil --check-signature "$package" | grep -F 'Developer ID Installer: AMZN Mobile LLC (94KV3E626L)'
pkgutil --expand-full "$package" "$work/expanded"
plugin="$(find "$work/expanded" -type f -name session-manager-plugin)"
test -f "$plugin"
mkdir -p "$RUNNER_TEMP/panna-bin"
install -m 755 "$plugin" "$RUNNER_TEMP/panna-bin/session-manager-plugin"
"$RUNNER_TEMP/panna-bin/session-manager-plugin" --version
printf '%s\n' "$RUNNER_TEMP/panna-bin" >> "$GITHUB_PATH"
