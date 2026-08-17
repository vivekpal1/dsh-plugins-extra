#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node "$repo_dir/bin/dsh-plugins-extra.js" verify all
