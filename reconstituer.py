"""Reconstitue et vérifie le ZIP de passation à partir des parties Git."""
from hashlib import sha256
from pathlib import Path
import json
import tempfile


def main():
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "manifeste.json").read_text())
    target = Path.cwd() / Path(manifest["archive"]).name
    if target.exists():
        with target.open("rb") as existing:
            from hashlib import file_digest
            if file_digest(existing, "sha256").hexdigest() == manifest["sha256"]:
                print(f"ZIP déjà présent et vérifié : {target}")
                return
        raise SystemExit(f"Un fichier différent existe déjà : {target}")
    digest = sha256()
    with tempfile.TemporaryDirectory(prefix=".reconstitution-", dir=target.parent) as tmp:
        pending = Path(tmp) / target.name
        with pending.open("xb") as output:
            for part in manifest["parts"]:
                part_path = root / part["file"]
                if part_path.resolve().parent != (root / "parts").resolve():
                    raise SystemExit("Chemin de partie invalide")
                content = part_path.read_bytes()
                if len(content) != part["bytes"] or sha256(content).hexdigest() != part["sha256"]:
                    raise SystemExit(f"Partie invalide : {part_path.name}")
                output.write(content)
                digest.update(content)
        if pending.stat().st_size != manifest["bytes"] or digest.hexdigest() != manifest["sha256"]:
            raise SystemExit("L’empreinte du ZIP reconstitué diffère du manifeste")
        if target.exists():
            raise SystemExit(f"La destination est apparue pendant la reconstitution : {target}")
        pending.rename(target)
    print(f"ZIP vérifié : {target}")


if __name__ == "__main__":
    main()
