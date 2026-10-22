#!/bin/bash
# Run the board tests inside the WSL distro (engine venv at /opt/ss-venv).
# Usage: bash /mnt/e/Winter/siliconsmith/.claude/worktrees/ws-board-814095/engine/siliconsmith/board/run_tests.sh
set -e
WT=/mnt/e/Winter/siliconsmith/.claude/worktrees/ws-board-814095
cd "$WT"
export PYTHONPATH="$WT/engine"
/opt/ss-venv/bin/python -m pytest -q engine/tests/test_board_*.py "$@"
