#!/bin/bash
# Creates or updates one CloudFormation stack from the repository.
#
#   deploy.sh bootstrap                # dev + stage's shared pieces; by hand, first
#   deploy.sh bootstrap-prod           # prod's own copy; by hand, before prod
#   deploy.sh dev|stage|prod [apply]   # environment.yml + environments/<env>.params
#   deploy.sh dev|stage|prod plan      # show what apply would change, change nothing
#
# Environment stacks go through a change set: it is summarised (also into the
# GitHub job summary), then discarded (plan) or executed (apply). CloudFormation
# runs it as the bootstrap stack's execution role, so the caller - you, or the
# infra workflows - needs only permission to hand changes to CloudFormation.
# apply refuses to replace the instance, its data volume or its IP unless
# ALLOW_REPLACEMENT=true.
#
# Needs AWS CLI v2, jq, and AWS_REGION.
set -euo pipefail

target="${1:-}"
mode="${2:-apply}"
dir="$(cd "$(dirname "$0")" && pwd)"
: "${AWS_REGION:?set AWS_REGION to the region the stacks live in}"

outputs() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
}

# Printed, and appended to the GitHub job summary when there is one.
report() {
  echo "$*"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$*" >>"$GITHUB_STEP_SUMMARY"; fi
}

case "$target" in
  bootstrap | bootstrap-prod)
    stack="app-$target"
    aws cloudformation deploy --stack-name "$stack" \
      --template-file "$dir/$target.yml" \
      --capabilities CAPABILITY_IAM \
      --no-fail-on-empty-changeset \
      ${CREATE_OIDC_PROVIDER:+--parameter-overrides CreateOidcProvider="$CREATE_OIDC_PROVIDER"}
    outputs "$stack"
    exit 0
    ;;
  dev | stage | prod) ;;
  *)
    echo "usage: $0 bootstrap|bootstrap-prod|dev|stage|prod [plan|apply]" >&2
    exit 2
    ;;
esac
case "$mode" in plan | apply) ;; *)
  echo "mode must be plan or apply" >&2
  exit 2
  ;;
esac

stack="app-$target"
params="$dir/environments/$target.params"
lines="$(grep -Ev '^[[:space:]]*(#|$)' "$params")"

if ! grep -qx "EnvName=$target" <<<"$lines"; then
  echo "$params must set EnvName=$target" >&2
  exit 1
fi
if ! grep -q '^ImageId=ami-' <<<"$lines"; then
  latest="$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query Parameter.Value --output text 2>/dev/null || echo '<look it up>')"
  echo "ImageId is not pinned in $params. The current Amazon Linux 2023 AMI in" >&2
  echo "$AWS_REGION is $latest - set ImageId=$latest there, commit it, and re-run." >&2
  exit 1
fi

# Every key in the file is passed, empty ones included, so the file stays the
# whole truth: a key removed from it falls back to the template default.
parameters="$(jq -Rn '[inputs | capture("^(?<k>[^=]+)=(?<v>.*)$") | {ParameterKey: .k, ParameterValue: .v}]' <<<"$lines")"
bootstrap="$(jq -r '(.[] | select(.ParameterKey == "BootstrapStackName") | .ParameterValue) // "app-bootstrap"' <<<"$parameters")"
role_arn="$(aws cloudformation describe-stacks --stack-name "$bootstrap" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFormationExecutionRoleArn'].OutputValue" --output text)"

if aws cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1; then
  type=UPDATE
elif [ "$mode" = plan ]; then
  # A CREATE change set would leave an empty stack behind; plan never creates.
  report "### $stack"
  report "The stack does not exist yet: \`apply\` would create every resource in environment.yml."
  exit 0
else
  type=CREATE
fi

change_set="$mode-$(date -u +%Y%m%d%H%M%S)"
aws cloudformation create-change-set \
  --stack-name "$stack" --change-set-name "$change_set" --change-set-type "$type" \
  --template-body "file://$dir/environment.yml" \
  --parameters "$parameters" \
  --capabilities CAPABILITY_IAM \
  --role-arn "$role_arn" \
  --tags "Key=app:env,Value=$target" >/dev/null
aws cloudformation wait change-set-create-complete \
  --stack-name "$stack" --change-set-name "$change_set" 2>/dev/null || true

described="$(aws cloudformation describe-change-set --stack-name "$stack" --change-set-name "$change_set" --output json)"
status="$(jq -r .Status <<<"$described")"
if [ "$status" != CREATE_COMPLETE ]; then
  reason="$(jq -r '.StatusReason // ""' <<<"$described")"
  aws cloudformation delete-change-set --stack-name "$stack" --change-set-name "$change_set" >/dev/null || true
  if [[ "$reason" == *"didn't contain changes"* || "$reason" == *"No updates are to be performed"* ]]; then
    report "### $stack"
    report "No changes."
    exit 0
  fi
  echo "change set failed: $reason" >&2
  exit 1
fi

report "### $stack - $mode"
report ""
report "| Action | Resource | Type | Replacement |"
report "| ------ | -------- | ---- | ----------- |"
report "$(jq -r '.Changes[].ResourceChange | "| \(.Action) | \(.LogicalResourceId) | \(.ResourceType) | \(.Replacement // "-") |"' <<<"$described")"

# Replacing any of these takes the server down or empties its disk.
dangerous="$(jq -r '.Changes[].ResourceChange
  | select(.ResourceType == "AWS::EC2::Instance" or .ResourceType == "AWS::EC2::Volume" or .ResourceType == "AWS::EC2::EIP")
  | select(.Replacement == "True" or .Replacement == "Conditional")
  | .LogicalResourceId' <<<"$described")"
if [ -n "$dangerous" ]; then
  report ""
  report "**Replaces:** $(echo "$dangerous" | paste -sd, -). Apply refuses this unless ALLOW_REPLACEMENT=true."
fi

if [ "$mode" = plan ]; then
  aws cloudformation delete-change-set --stack-name "$stack" --change-set-name "$change_set" >/dev/null
  exit 0
fi
if [ -n "$dangerous" ] && [ "${ALLOW_REPLACEMENT:-}" != true ]; then
  aws cloudformation delete-change-set --stack-name "$stack" --change-set-name "$change_set" >/dev/null
  echo "refusing to replace $dangerous; re-run with ALLOW_REPLACEMENT=true if that is intended" >&2
  exit 1
fi

aws cloudformation execute-change-set --stack-name "$stack" --change-set-name "$change_set"
waiter="stack-update-complete"
[ "$type" = CREATE ] && waiter="stack-create-complete"
if ! aws cloudformation wait "$waiter" --stack-name "$stack"; then
  echo "stack $type failed; latest events:" >&2
  aws cloudformation describe-stack-events --stack-name "$stack" --max-items 15 \
    --query 'StackEvents[].[LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table >&2
  exit 1
fi
outputs "$stack"
