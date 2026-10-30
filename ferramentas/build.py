"""Gera dist/roteirizador.html (arquivo único) a partir de index.html + css + js.
Uso: python ferramentas/build.py   (na pasta do projeto)"""
import pathlib, re
R = pathlib.Path(__file__).resolve().parent.parent
h = (R / "index.html").read_text(encoding="utf-8")
h = h.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + (R / "css/style.css").read_text(encoding="utf-8") + "\n</style>")
for f in ["js/config.js", "js/engine.js", "js/app.js"]:
    h = h.replace(f'<script src="{f}"></script>', "<script>\n" + (R / f).read_text(encoding="utf-8") + "\n</script>")
(R / "dist").mkdir(exist_ok=True)
(R / "dist/roteirizador.html").write_text(h, encoding="utf-8")
print("Gerado: dist/roteirizador.html")
