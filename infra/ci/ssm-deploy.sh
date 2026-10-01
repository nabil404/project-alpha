#!/bin/bash
# Runs /opt/app/bin/deploy <sha> on one instance over SSM Run Command and waits
# for it, printing its output. `aws ssm wait command-executed` gives up after
# 100 s, too soon for an image pull plus migrations, so this polls itself.
#
# Usage: ssm-deploy.sh <instance-id> <commit-sha> [timeout-seconds]
set -euo pipefail

instance="$1"
sha="$2"
timeout="${3:-1200}"

parameters="$(jq -nc --arg c "/opt/app/bin/deploy $sha" --arg t "$timeout" \
  '{commands: [$c], executionTimeout: [$t]}')"
command_id="$(aws ssm send-command \
  --instance-ids "$instance" \
  --document-name AWS-RunShellScript \
  --comment "deploy ${sha:0:7}" \
  --parameters "$parameters" \
  --query Command.CommandId --output text)"
echo "ssm command $command_id"

deadline=$((SECONDS + timeout + 60))
while :; do
  sleep 10
  # Right after send-command the invocation may not exist yet.
  status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in
    Pending | InProgress | Delayed) ;;
    *) break ;;
  esac
  if ((SECONDS > deadline)); then
    status=TimedOut
    break
  fi
done

# SSM keeps the first 24,000 characters of each stream.
aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text || true

echo "ssm status: $status"
[ "$status" = Success ]
