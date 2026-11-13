"""Write the API contract to backend/openapi.json.

The web application's TypeScript types are generated from this file, so the two can never drift apart
unnoticed: CI fails if either the contract or the generated types are out of date.

    python scripts/export_openapi.py            # rewrite the file
    python scripts/export_openapi.py --check    # fail if it is out of date
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402


def main() -> int:
    path = ROOT / "openapi.json"
    text = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    if "--check" in sys.argv:
        if not path.exists() or path.read_text() != text:
            print("backend/openapi.json is out of date. Run: python scripts/export_openapi.py", file=sys.stderr)
            return 1
        return 0
    path.write_text(text)
    print(f"Wrote {path.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
