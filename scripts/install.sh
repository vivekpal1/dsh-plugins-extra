#!/bin/sh
set -eu

target=${1:-all}
profile=${DSH_PROFILE:-web}
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dsh_home=${DSH_HOME:-${HOME:?HOME is required}/.dsh}
archive_dir=$dsh_home/packages

command -v dsh >/dev/null 2>&1 || {
  echo "dsh is required and was not found in PATH" >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "npm is required and was not found in PATH" >&2
  exit 1
}

case "$target" in
  all) packages="packages/dsh-codex-subscription packages/dsh-session-import dsh-themes" ;;
  codex) packages="packages/dsh-codex-subscription" ;;
  import) packages="packages/dsh-session-import" ;;
  themes) packages="dsh-themes" ;;
  *)
    echo "usage: $0 [all|codex|import|themes]" >&2
    exit 2
    ;;
esac

mkdir -p "$archive_dir"

for package in $packages; do
  package_dir=$repo_dir/$package
  archive=$(npm pack "$package_dir" --pack-destination "$archive_dir" --silent | tail -n 1)
  echo "Installing $archive into DSH profile '$profile'"
  dsh plugin --profile "$profile" add "$archive_dir/$archive"
done

echo "Installed successfully. Restart DSH when convenient, then verify with:"
echo "  dsh --profile $profile --dump-config"
