#!/bin/sh
set -eu

profile=${DSH_PROFILE:-web}
config=$(dsh --profile "$profile" --dump-config)

for id in codex-subscription session-import solana-wallet community-themes; do
  count=$(printf '%s\n' "$config" | grep -c "id: $id" || true)
  if [ "$count" -ne 1 ]; then
    echo "expected one '$id' entry in profile '$profile'; found $count" >&2
    exit 1
  fi
done

echo "DSH profile '$profile' contains one entry for each plugin."
