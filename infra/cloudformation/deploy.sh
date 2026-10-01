#!/bin/bash
# Creates or updates one CloudFormation stack from the repository:
#   infra/cloudformation/deploy.sh bootstrap       # dev + stage's shared pieces, first
#   infra/cloudformation/deploy.sh bootstrap-prod  # prod's own copy, before prod
#   infra/cloudformation/deploy.sh dev|stage|prod  # environment.yml + environments/<env>.params
#
# Needs AWS CLI v2 signed in to the account, and AWS_REGION set.
set -euo pipefail

target="${1:-}"
dir="$(cd "$(dirname "$0")" && pwd)"
: "${AWS_REGION:?set AWS_REGION to the region the stacks live in}"

outputs() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
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
    ;;
  dev | stage | prod)
    params="$dir/environments/$target.params"
    lines="$(grep -Ev '^[[:space:]]*(#|$)' "$params")"

    if ! grep -qx "EnvName=$target" <<<"$lines"; then
      echo "$params must set EnvName=$target" >&2
      exit 1
    fi
    if ! grep -q '^ImageId=ami-' <<<"$lines"; then
      latest="$(aws ssm get-parameter \
        --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
        --query Parameter.Value --output text)"
      echo "ImageId is not pinned in $params. The current Amazon Linux 2023 AMI in" >&2
      echo "$AWS_REGION is $latest - set ImageId=$latest there, commit it, and re-run." >&2
      exit 1
    fi
    # CloudFormation rejects an empty value for a String parameter on the
    # command line; leaving it out keeps the template default instead. A plain
    # read loop, not mapfile: macOS ships bash 3.2, which has no mapfile.
    overrides=()
    while IFS= read -r line; do
      case "$line" in
        *=) ;;
        *) overrides+=("$line") ;;
      esac
    done <<<"$lines"

    aws cloudformation deploy --stack-name "app-$target" \
      --template-file "$dir/environment.yml" \
      --capabilities CAPABILITY_IAM \
      --no-fail-on-empty-changeset \
      --tags "app:env=$target" \
      --parameter-overrides "${overrides[@]}"
    outputs "app-$target"
    ;;
  *)
    echo "usage: $0 bootstrap|bootstrap-prod|dev|stage|prod" >&2
    exit 2
    ;;
esac
