#!/usr/bin/env bash
#
# Deploys Lunera Silver on the cPanel server: the API, then the website.
#
#   bash ~/lunerasilver-api/scripts/deploy.sh             # both
#   bash ~/lunerasilver-api/scripts/deploy.sh --api-only
#   bash ~/lunerasilver-api/scripts/deploy.sh --web-only
#   bash ~/lunerasilver-api/scripts/deploy.sh --skip-backup   # not recommended
#   bash ~/lunerasilver-api/scripts/deploy.sh --debug         # print every command as it runs
#
# API:  git pull -> npm install -> link migrations -> list -> (backup) -> migrate
#       -> safe seeds -> build -> restart
# Web:  git pull -> copy dist/ into public_html (nothing there is deleted)
#
# Stops at the first thing that fails, so a half-finished deploy never carries
# on as if it had worked.

set -Eeuo pipefail

# ---------------------------------------------------------------- settings --
HOME_DIR="${HOME_DIR:-/home2/luneraon}"
API_DIR="${API_DIR:-$HOME_DIR/lunerasilver-api}"
PUBLIC_DIR="${PUBLIC_DIR:-$HOME_DIR/public_html}"
WEB_REPO="${WEB_REPO:-$PUBLIC_DIR/lunerasilverweb}"
API_URL="${API_URL:-https://api.luneraonlinestore.com}"
BRANCH="${BRANCH:-main}"

# Seeds that are safe to run on every deploy: each one skips or updates what
# is already there. 001_admin and 003_business_profile are left out on
# purpose -- 003 overwrites the shop's profile with the defaults in the code.
SAFE_SEEDS=(
  002_fiscal_years.ts
  004_invoice_sequences.ts
  005_chart_of_accounts.ts
  007_silver_rates_nepal_2026.ts
)

DO_API=1
DO_WEB=1
DO_BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --api-only) DO_WEB=0 ;;
    --web-only) DO_API=0 ;;
    --skip-backup) DO_BACKUP=0 ;;
    --debug) set -x ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ----------------------------------------------------------------- helpers --
bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s  ✓ %s%s\n' "$green" "$*" "$reset"; }
warn() { printf '%s  ! %s%s\n' "$yellow" "$*" "$reset"; }
die()  { printf '%s  ✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
trap 'die "Stopped at line $LINENO: $BASH_COMMAND"' ERR

# Hides dotenv's banner and indents the rest. Never fails itself, so under
# pipefail a pipeline still fails only when the real command before it does.
quiet() { { grep -vE 'injected env|Requiring external module|Ran [0-9]+ seed' || true; } | sed 's/^/    /'; }

# This file lives in the API repo, and the API step pulls that repo. Bash reads
# a script as it runs, so a pull that changes this file mid-run could make it
# execute half of the old version and half of the new. Run from a copy.
if [[ -z "${DEPLOY_FROM_COPY:-}" ]]; then
  copy="$(mktemp "${TMPDIR:-/tmp}/lunera-deploy.XXXXXX")"
  cp "$0" "$copy"
  DEPLOY_FROM_COPY=1 exec bash "$copy" "$@"
fi

git_pull() {
  local dir="$1"
  # A folder of build output that may be put back from git if it was changed
  # on the server. Anything else changed there stops the deploy.
  local restorable="${2:-}"
  cd "$dir"
  [[ -d .git ]] || die "$dir is not a git checkout"
  if [[ -n "$restorable" ]]; then
    local changed
    changed="$(git status --porcelain --untracked-files=no)"
    if [[ -n "$changed" ]] && ! echo "$changed" | grep -qvE "^.. ${restorable}/"; then
      git checkout -- "$restorable"
      warn "Put $restorable/ back from git (it had been moved or changed on the server)"
    fi
  fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    git status --short --untracked-files=no
    die "$dir has local changes on the server. Commit or discard them first (git checkout -- <file>), then run again."
  fi
  local before; before="$(git rev-parse --short HEAD)"
  git fetch --quiet origin "$BRANCH"
  git pull --ff-only --quiet origin "$BRANCH"
  local after; after="$(git rev-parse --short HEAD)"
  if [[ "$before" == "$after" ]]; then ok "Already up to date ($after)"; else ok "Updated $before -> $after"; fi
}

# cPanel's "Setup Node.js App" keeps node and npm in a virtual environment per
# app. Use it when it is there, so npm installs into the app's own modules.
USING_VENV=0

use_node() {
  local activate
  activate="$(ls -d "$HOME_DIR"/nodevenv/lunerasilver-api/*/bin/activate 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -n "$activate" ]]; then
    # cPanel's activate script runs small checks of its own that can "fail"
    # harmlessly. Under this script's stop-on-any-failure rules those would end
    # the deploy, so the rules are relaxed just while it loads.
    trap - ERR
    set +eu
    # shellcheck disable=SC1090
    source "$activate"
    set -eu
    USING_VENV=1
    trap 'die "Stopped at line $LINENO: $BASH_COMMAND"' ERR
    ok "Using the cPanel Node environment ($(basename "$(dirname "$(dirname "$activate")")"))"
  fi
  command -v node >/dev/null || die "node is not available. In cPanel open 'Setup Node.js App', create the app for $API_DIR, then run again."
  command -v npm  >/dev/null || die "npm is not available alongside node."
  ok "node $(node -v), npm $(npm -v)"
}

# ===================================================================== API ==
deploy_api() {
  step "API: pulling the latest code"
  git_pull "$API_DIR"
  [[ -f .env ]] || die "$API_DIR/.env is missing. The database settings live there."

  step "API: checking node"
  use_node

  step "API: installing dependencies"
  # cPanel keeps the app's packages in its Node environment and wants
  # node_modules to be a link to them. A real folder there -- left by an
  # "npm install" run outside that environment -- makes its npm refuse to run.
  # It is moved aside, not deleted, and put back if the install fails.
  local moved=""
  if (( USING_VENV )) && [[ -d node_modules && ! -L node_modules ]]; then
    moved="node_modules.old-$(date +%Y%m%d-%H%M%S)"
    mv node_modules "$moved"
    warn "Moved a plain node_modules folder aside to $moved (cPanel needs a link there)"
  fi

  # Dev dependencies too: the build (typescript) and the migrations (ts-node)
  # both need them on the server.
  if ! npm install --include=dev --no-audit --no-fund --loglevel=error; then
    if [[ -n "$moved" && ! -e node_modules ]]; then
      mv "$moved" node_modules
      warn "Put the old node_modules folder back"
    fi
    die "npm install failed. In cPanel open 'Setup Node.js App', check the app for $API_DIR exists, press 'Run NPM Install', then run this again."
  fi
  ok "Dependencies installed"
  if [[ -n "$moved" ]]; then ok "Once the site works, delete the old folder: rm -rf $API_DIR/$moved"; fi

  step "API: linking migrations"
  npm run --silent link-migrations >/dev/null
  ok "Migrations collected into ./migrations"

  step "API: checking for new migrations"
  local list pending status
  set +e
  list="$(npx knex migrate:list --knexfile knexfile.ts 2>&1)"
  status=$?
  set -e
  # Just the counts and any pending names; the full list of done ones is noise.
  echo "$list" | awk '/Completed Migration/ {print; next} /Pending Migration|No Pending/ {p=1} p' | quiet
  # A list that could not reach the database must not read as "nothing to do".
  (( status == 0 )) || die "Could not read the migration list. Check the database settings in .env."
  if echo "$list" | grep -qi "No Pending Migration"; then
    pending=0
  else
    pending="$(echo "$list" | grep -oiE 'Found [0-9]+ Pending' | grep -oE '[0-9]+' | head -1 || true)"
    pending="${pending:-0}"
  fi

  if (( pending > 0 )); then
    if (( DO_BACKUP )); then
      step "API: backing up the database before migrating"
      if command -v mysqldump >/dev/null; then
        npm run --silent backup || die "The backup failed, so nothing was migrated. Fix it, or run again with --skip-backup if you are sure."
        ok "Backup saved in $API_DIR/backups"
      else
        die "mysqldump is not on this server, so no backup could be taken. Take one from cPanel (phpMyAdmin > Export), then run again with --skip-backup."
      fi
    else
      warn "Skipping the backup (--skip-backup)"
    fi

    step "API: running $pending migration(s)"
    npx knex migrate:latest --knexfile knexfile.ts 2>&1 | quiet
    ok "Database is up to date"
  else
    ok "No new migrations"
  fi

  step "API: loading reference data (safe seeds)"
  for seed in "${SAFE_SEEDS[@]}"; do
    if [[ -f "seeds/$seed" ]]; then
      npx knex seed:run --knexfile knexfile.ts --specific="$seed" 2>&1 | quiet
      ok "$seed"
    else
      warn "$seed not found, skipped"
    fi
  done

  step "API: building"
  npm run --silent build
  [[ -f dist/src/app.js ]] || die "The build finished but dist/src/app.js is missing."
  ok "Built into dist/"

  step "API: restarting"
  mkdir -p tmp && touch tmp/restart.txt
  if command -v cloudlinux-selector >/dev/null; then
    cloudlinux-selector restart --json --interpreter nodejs --app-root "${API_DIR#"$HOME_DIR"/}" >/dev/null 2>&1 \
      && ok "Restarted through cPanel's Node.js app" \
      || warn "cloudlinux-selector could not restart it; tmp/restart.txt was touched instead. If the API still runs old code, press Restart in 'Setup Node.js App'."
  else
    ok "Touched tmp/restart.txt (the app restarts on its next request)"
  fi

  if command -v curl >/dev/null; then
    sleep 3
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL/api/settings" || true)"
    case "$code" in
      2*|401|403) ok "API is answering ($API_URL, HTTP $code)" ;;
      *) warn "API answered HTTP ${code:-nothing} at $API_URL/api/settings. Check the app's log in cPanel." ;;
    esac
  fi
}

# ===================================================================== Web ==
deploy_web() {
  step "Web: pulling the latest code"
  # Earlier deploys moved the files out of dist/ instead of copying them, which
  # git sees as deleted. They are build output, so they are simply restored.
  git_pull "$WEB_REPO" dist

  local dist="$WEB_REPO/dist"
  [[ -f "$dist/index.html" ]] || die "$dist/index.html is missing. Build the website on your computer (npm run build), commit dist/, push, then run again."

  step "Web: publishing dist/ into $PUBLIC_DIR"
  # Copied over the top; nothing already in public_html is removed. Old asset
  # files from earlier builds stay behind -- harmless, index.html no longer
  # points at them.
  cp -R "$dist/." "$PUBLIC_DIR/"
  ok "Copied $(find "$dist" -type f | wc -l | tr -d ' ') files"

  # The site is one page that handles its own routes (/admin/...). Without
  # this, reloading any page other than the home page gives a 404.
  if [[ ! -f "$PUBLIC_DIR/.htaccess" ]]; then
    cat > "$PUBLIC_DIR/.htaccess" <<'HTACCESS'
# Lunera Silver: send every path that is not a real file to the app.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
HTACCESS
    ok "Created $PUBLIC_DIR/.htaccess so page reloads work"
  elif ! grep -q "index.html" "$PUBLIC_DIR/.htaccess"; then
    warn "$PUBLIC_DIR/.htaccess exists but does not send routes to index.html. Reloading /admin pages may 404."
  fi

  # The repo sits inside public_html, so without this its source code and .git
  # history can be downloaded by anyone who guesses the folder name. It is
  # blocked from public_html's .htaccess: the repo has an .htaccess of its own
  # under version control, which a deploy must not edit.
  local repo_name; repo_name="$(basename "$WEB_REPO")"
  if ! grep -q "lunera-deploy: hide repo" "$PUBLIC_DIR/.htaccess"; then
    printf '\n# lunera-deploy: hide repo -- the git checkout is not part of the site.\nRedirectMatch 404 ^/%s(/|$)\n' "$repo_name" >> "$PUBLIC_DIR/.htaccess"
    ok "Blocked web access to /$repo_name (added to $PUBLIC_DIR/.htaccess)"
  fi
}

# ==================================================================== main ==
started=$(date +%s)
(( DO_API )) && deploy_api
(( DO_WEB )) && deploy_web
step "Done in $(( $(date +%s) - started ))s"
