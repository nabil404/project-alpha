#!/usr/bin/env bash
# Lists the files a change touches and, for each, the docs that mention it.
#
#   .claude/skills/docs-sync/scripts/related-docs.sh [--base <ref>]
#
# The change is every commit since the merge-base with --base (default
# `develop`), plus staged, unstaged and untracked files. On develop itself
# that is the working tree only; pass `--base HEAD~1` to check the last commit.
#
# A doc "mentions" a changed file when it contains the file's repo path, its
# file name, its name without the extension, or (for code under
# apps/*/src/modules/<m>/ or apps/web/src/features/<m>/) the module path. The
# match is a starting point for reading, not a verdict: a doc can be stale
# without naming the file.
#
# Needs bash 3.2 or later, git, and POSIX grep and sed. It uses only flags
# that GNU, BSD and BusyBox share, so it runs on Linux, macOS and in CI.

set -euo pipefail
export LC_ALL=C

base_ref=develop
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base_ref="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

if ! base=$(git merge-base HEAD "$base_ref" 2>/dev/null); then
  echo "No merge-base with \"$base_ref\". Pass --base <ref>." >&2
  exit 1
fi

# docs/superpowers/ and .superpowers/ are local plans, not project docs.
skipped() {
  case "$1" in
    docs/superpowers/* | .superpowers/*) return 0 ;;
    */meta/*_snapshot.json | *_journal.json | pnpm-lock.yaml) return 0 ;;
  esac
  return 1
}

is_doc() {
  case "$1" in
    .claude/*) return 1 ;;
    docs/*.md | AGENTS.md | README.md | */README.md) return 0 ;;
  esac
  return 1
}

changed=$(
  {
    git diff --name-only "$base" HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | sort -u
)

all_docs=()
while IFS= read -r f; do
  if is_doc "$f" && ! skipped "$f" && [ -f "$f" ]; then all_docs+=("$f"); fi
done < <(git ls-files --cached --others --exclude-standard '*.md' | sort -u)

changed_docs=()
changed_code=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  skipped "$f" && continue
  if is_doc "$f"; then changed_docs+=("$f"); else changed_code+=("$f"); fi
done <<< "$changed"

in_change() { printf '%s\n' "$changed" | grep -qxF -- "$1"; }

# Most specific first. Generic names would match every doc, so they only
# match by full path.
needles() {
  local file="$1" name stem
  name=$(basename "$file")
  stem="${name%.*}"
  echo "$file"
  case "$stem" in
    index | README | package | main | app.module | schema | types | utils) ;;
    *)
      if [ "${#stem}" -gt 3 ]; then
        echo "$name"
        echo "$stem"
      fi
      ;;
  esac
  printf '%s\n' "$file" | sed -nE 's#^(apps/[^/]+/src/(modules|features)/[^/]+)/.*#\1/#p'
}

echo "Base: ${base:0:7} (merge-base with $base_ref)"
echo
echo "Docs changed (${#changed_docs[@]}):"
for d in ${changed_docs[@]+"${changed_docs[@]}"}; do echo "  $d"; done
echo
echo "Code changed (${#changed_code[@]}), with docs that mention it:"

for file in ${changed_code[@]+"${changed_code[@]}"}; do
  echo
  echo "  $file"
  seen=""
  while IFS= read -r needle; do
    [ -n "$needle" ] || continue
    [ ${#all_docs[@]} -gt 0 ] || break
    while IFS= read -r doc; do
      [ -n "$doc" ] || continue
      case "$seen" in *"|$doc|"*) continue ;; esac
      seen="$seen|$doc|"
      if in_change "$doc"; then mark="✓"; else mark="·"; fi
      echo "    $mark $doc  [$needle]"
    done < <(grep -lF -- "$needle" "${all_docs[@]}" 2>/dev/null | sort || true)
  done < <(needles "$file")
  [ -n "$seen" ] || echo "    (no doc mentions it)"
done

echo
echo "✓ = doc is part of this change, · = not touched"
