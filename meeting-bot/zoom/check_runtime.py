"""B8 image check: native imports and used API symbols, without SDK auth/join."""
import ast
from pathlib import Path
from importlib.metadata import version
from gi.repository import GLib
import zoom_meeting_sdk as sdk

assert version("zoom-meeting-sdk") == "0.0.27"
assert callable(GLib.MainLoop)
tree = ast.parse(Path(__file__).with_name("native.py").read_text())
required = {node.attr for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
            and node.value.id == "z"}
missing = sorted(name for name in required if not hasattr(sdk, name))
if missing:
    raise RuntimeError("native_api_missing:" + ",".join(missing))
print("zoom_native_symbols_verified")
