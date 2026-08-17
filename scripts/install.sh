#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$#" -eq 0 ]; then set -- all; fi
exec node "$repo_dir/bin/dsh-plugins-extra.js" install "$@"
