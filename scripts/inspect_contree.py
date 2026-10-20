"""Dev helper: print the contree-sdk public API (run inside the engine venv)."""
import inspect
import os

import contree_sdk
from contree_sdk import ContreeSync

print("package dir:", os.path.dirname(contree_sdk.__file__))
print("exports:", [n for n in dir(contree_sdk) if not n.startswith("_")])
print("ContreeSync.__init__", inspect.signature(ContreeSync.__init__))
for name, member in inspect.getmembers(ContreeSync):
    if not name.startswith("_"):
        print(" ", name, type(member).__name__)
