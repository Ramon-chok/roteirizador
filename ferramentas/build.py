"""Gera dist/roteirizador.html (arquivo único) a partir de index.html + css + js.
Uso: python ferramentas/build.py   (na pasta do projeto)"""
import pathlib, re
R = pathlib.Path(__file__).resolve().parent.parent
h = (R / "index.html").read_text(encoding="utf-8")
css = "<style>\n" + (R / "css/style.css").read_text(encoding="utf-8") + "\n</style>"
h, n = re.subn(r'<link rel="stylesheet" href="css/style.css"\s*/?>', lambda m: css, h)
assert n == 1, "link do css/style.css não encontrado no index.html"
for f in ["js/config.js", "js/engine.js", "js/app.js", "js/rotas.js", "js/calendario.js", "js/verba.js"]:
    js = "<script>\n" + (R / f).read_text(encoding="utf-8") + "\n</script>"
    h, n = re.subn(r'<script src="' + re.escape(f) + r'"></script>', lambda m: js, h)
    assert n == 1, f"script {f} não encontrado no index.html"
# No arquivo único os scripts ficam embutidos: a política de conteúdo precisa permitir script embutido
h = h.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'", 1)
(R / "dist").mkdir(exist_ok=True)
(R / "dist/roteirizador.html").write_text(h, encoding="utf-8")
print("Gerado: dist/roteirizador.html")
