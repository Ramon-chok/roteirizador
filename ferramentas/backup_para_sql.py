"""Converte um backup do Roteirizador (.json) em SQL para carregar no Supabase (supabase/schema.sql).
Uso: python ferramentas/backup_para_sql.py backup.json [empresa]
Gera backup.sql ao lado do arquivo. A empresa vem do próprio backup; informe só se ele for antigo.
Pode rodar de novo: atualiza o que já existe. Os percursos pelas ruas não vão no backup."""
import json, pathlib, sys


def lit(v):
    if v is None or v == "":
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def arr(v):
    return "'{" + ",".join(str(int(x)) for x in (v or [])) + "}'::smallint[]"


def data(ms):
    return f"to_timestamp({ms / 1000})" if ms else "now()"


def upsert(tab, cols, vals, chave):
    upd = [c for c in cols if c not in chave and c != "criado_em"]
    fim = f"do update set {', '.join(f'{c} = excluded.{c}' for c in upd)}" if upd else "do nothing"
    return f"insert into public.{tab} ({', '.join(cols)}) values ({', '.join(vals)}) on conflict ({', '.join(chave)}) {fim};"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    arq = pathlib.Path(sys.argv[1])
    d = json.loads(arq.read_text(encoding="utf-8"))
    if d.get("app") != "roteirizador":
        sys.exit("Este arquivo não é um backup do Roteirizador.")
    emp = sys.argv[2] if len(sys.argv) > 2 else d.get("empresa")
    if not emp:
        sys.exit("Backup sem ambiente: informe a empresa. Ex.: python ferramentas/backup_para_sql.py backup.json g4")
    e = lit(emp)
    sql = ["begin;"]

    for c in d.get("clientes", []):
        cols = ["empresa_id", "sold", "nome", "endereco", "bairro", "cidade", "uf", "cep", "lat", "lng", "visitas_mes", "atendimento_min", "geo_origem", "geo_nivel", "geo_pendencia", "exemplo"]
        vals = [e, lit(str(c["sold"])), lit(c.get("nome")), lit(c.get("endereco")), lit(c.get("bairro")), lit(c.get("cidade")), lit(c.get("uf")), lit(c.get("cep")),
                lit(c.get("lat")), lit(c.get("lng")), lit(c.get("f") or 4), lit(c.get("t")), lit(c.get("geo")), lit(c.get("geoNivel")), lit(c.get("geoPend")), lit(bool(c.get("exemplo")))]
        sql.append(upsert("clientes", cols, vals, ["empresa_id", "sold"]))

    for c in d.get("colaboradores", []):
        cols = ["empresa_id", "codigo", "nome", "funcao", "endereco", "bairro", "cidade", "uf", "cep", "lat", "lng", "jornada_min", "cor", "geo_origem", "geo_nivel", "geo_pendencia", "exemplo"]
        vals = [e, lit(str(c["codigo"])), lit(c.get("nome") or c["codigo"]), lit(c.get("funcao")), lit(c.get("endereco")), lit(c.get("bairro")), lit(c.get("cidade")), lit(c.get("uf")), lit(c.get("cep")),
                lit(c.get("lat")), lit(c.get("lng")), lit(c.get("jornada")), lit(c.get("cor")), lit(c.get("geo")), lit(c.get("geoNivel")), lit(c.get("geoPend")), lit(bool(c.get("exemplo")))]
        sql.append(upsert("colaboradores", cols, vals, ["empresa_id", "codigo"]))

    n_est = n_set = n_it = 0
    for est in d.get("estudos", []):
        m, itens = est["meta"], est.get("itens", {})
        p = m.get("params") or {}
        id_ = lit(m["id"])
        cols = ["empresa_id", "id", "nome", "descricao", "semanas", "dias", "velocidade_kmh", "fator_rota", "jornada_min", "atendimento_min", "criterio", "evita_pedagio", "evita_terra", "motor", "pendencias", "exemplo", "criado_em", "atualizado_em"]
        vals = [e, id_, lit(m.get("nome") or "Estudo"), lit(m.get("desc")), lit(p.get("semanas", 4)), arr(p.get("dias", [1, 2, 3, 4, 5])), lit(p.get("vel", 25)), lit(p.get("fator", 1.35)), lit(p.get("jornada", 480)), lit(p.get("tPadrao", 20)),
                lit(p.get("criterio", "tempo")), lit(bool(p.get("evitaPedagio"))), lit(bool(p.get("evitaTerra"))), lit(p.get("motor", "osrm")), lit(m.get("pend") or {"cli": [], "col": []}), lit(bool(m.get("exemplo"))), data(m.get("criado")), data(m.get("alterado") or m.get("criado"))]
        sql.append(upsert("estudos", cols, vals, ["empresa_id", "id"]))
        n_est += 1
        setores = m.get("setores") or {}
        for sid, s in setores.items():
            sql.append(upsert("setores", ["empresa_id", "estudo_id", "id", "nome", "cor", "colaborador_codigo"], [e, id_, lit(sid), lit(s.get("nome") or "Setor"), lit(s.get("cor") or "#7d8a84"), lit(s.get("colab"))], ["empresa_id", "estudo_id", "id"]))
            n_set += 1
        for sold, it in itens.items():
            sid = it.get("s") if it.get("s") in setores else None  # setor que não existe mais vira "sem setor", como no sistema
            cols = ["empresa_id", "estudo_id", "sold", "setor_id", "dias", "semanas", "sequencia"]
            vals = [e, id_, lit(str(sold)), lit(sid), arr(it.get("d")), arr(it.get("w")), f"'{json.dumps(it.get('q') or {})}'::jsonb"]
            sql.append(upsert("estudo_clientes", cols, vals, ["empresa_id", "estudo_id", "sold"]))
            n_it += 1
    sql.append("commit;")

    saida = arq.with_suffix(".sql")
    saida.write_text("\n".join(sql) + "\n", encoding="utf-8")
    print(f"Gerado: {saida}")
    print(f"Ambiente {emp}: {len(d.get('clientes', []))} clientes, {len(d.get('colaboradores', []))} colaboradores, {n_est} estudos, {n_set} setores, {n_it} clientes em estudos.")


if __name__ == "__main__":
    main()
