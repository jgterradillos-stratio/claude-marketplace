#!/bin/sh
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
[ -d "$HOME/.volta/bin" ] && PATH="$HOME/.volta/bin:$PATH"
command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)"

exec node "${CLAUDE_PLUGIN_ROOT}/dist/mcp/index.js"
