#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s):$(uname -m)" = Darwin:x86_64
work="$(mktemp -d "${RUNNER_TEMP:?}/panna-ssm.XXXXXXXX")"
trap 'rm -rf "$work"' EXIT
package="$work/session-manager-plugin.pkg"
curl -fsS --proto '=https' --max-time 60 --retry 2   https://s3.amazonaws.com/session-manager-downloads/plugin/1.2.896.0/mac/session-manager-plugin.pkg -o "$package"
printf '%s  %s\n' d9d960f04acb5ba419e0a12f769f9af4f3263e098b9b63e2de659189c138341a "$package" | shasum -a 256 -c -
pkgutil --check-signature "$package" | grep -F 'Developer ID Installer: AMZN Mobile LLC (94KV3E626L)'
pkgutil --expand-full "$package" "$work/expanded"
plugin="$(find "$work/expanded" -type f -name session-manager-plugin)"
test -f "$plugin"
mkdir -p "$RUNNER_TEMP/panna-bin"
install -m 755 "$plugin" "$RUNNER_TEMP/panna-bin/session-manager-plugin"
"$RUNNER_TEMP/panna-bin/session-manager-plugin" --version
printf '%s\n' "$RUNNER_TEMP/panna-bin" >> "$GITHUB_PATH"
