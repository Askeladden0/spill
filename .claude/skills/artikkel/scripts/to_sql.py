"""Gjør en artikkel-JSON om til SQL for guides + guide_modules.

  python -I to_sql.py artikkel.json > artikkel.sql

Kjøres fra roten av repoet (bildestiene sjekkes relativt til den).
Validerer det som ellers ville gitt en stygg side, og avbryter med en
forklaring hvis noe er galt.
"""
import json
import os
import re
import sys

SITE = "https://studilla.no/"
TYPES = {"tekst", "tabell", "bilde", "triks", "fil", "gevinst", "poll"}


def fail(msg):
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(f"Feil i artikkelen: {msg}")


def lit(s):
    """SQL-streng med dollar-quoting, så norsk tekst med ' og " går rett inn."""
    s = str(s)
    tag = "$a$"
    while tag in s:
        tag = tag[:-1] + "a$"
    return f"{tag}{s}{tag}"


def check(a):
    for key in ("id", "title", "excerpt", "cover", "modules"):
        if not a.get(key):
            fail(f"mangler «{key}»")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", a["id"]):
        fail("id må være en slug med bare a-z, 0-9 og bindestrek (ingen æøå)")
    if not os.path.isfile(a["cover"]):
        fail(f"coverbildet {a['cover']} finnes ikke")

    mods = a["modules"]
    for i, m in enumerate(mods, 1):
        t, d = m.get("type"), m.get("data")
        if t not in TYPES or not isinstance(d, dict):
            fail(f"modul {i} har ukjent type eller mangler data")
        if t == "tabell" and len(d.get("columns") or []) != 3:
            fail(f"tabellen i modul {i} må ha nøyaktig tre kolonner")
        if t == "tabell" and any(set(r) - {"a", "b", "c"} for r in d.get("rows") or []):
            fail(f"radene i tabellen i modul {i} skal bare ha feltene a, b og c")
        if t == "bilde":
            url = d.get("url", "")
            if url.startswith(SITE):
                url = url[len(SITE):]
            if not os.path.isfile(url):
                fail(f"bildet {d.get('url')} i modul {i} finnes ikke i repoet")
            if not d.get("alt"):
                fail(f"bildet i modul {i} mangler alt-tekst")
        if t == "bilde" and i > 1 and mods[i - 2].get("type") == "bilde":
            fail(f"modul {i - 1} og {i} er to bilder etter hverandre")
    if not any(m["type"] == "tabell" for m in mods):
        fail("artikkelen skal ha minst én tabell")
    if sum(m["type"] == "bilde" for m in mods) < 2:
        fail("artikkelen skal ha minst to bilder i teksten")
    if mods[-1]["type"] != "triks" or not mods[-1]["data"].get("gameId"):
        fail("siste modul skal være en triks-henvisning med gameId")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        a = json.load(f)
    check(a)

    cover = a["cover"] if a["cover"].startswith("http") else SITE + a["cover"].lstrip("/")
    gid = lit(a["id"])
    out = [
        "begin;",
        f"do $chk$ begin if exists (select 1 from public.guides where id = {gid}) then "
        f"raise exception 'Det finnes allerede et tips med id {a['id']}'; end if; end $chk$;",
        "insert into public.guides (id, title, category, excerpt, value_label, read_time, cover_url, "
        "is_featured, is_hidden, sort_order) select "
        f"{gid}, {lit(a['title'])}, '', {lit(a['excerpt'])}, {lit(a.get('value_label', ''))}, "
        f"{lit(a.get('read_time', ''))}, {lit(cover)}, false, false, "
        "coalesce(max(sort_order), 0) + 1 from public.guides;",
    ]
    for i, m in enumerate(a["modules"], 1):
        data = json.dumps(m["data"], ensure_ascii=False)
        out.append(
            "insert into public.guide_modules (guide_id, type, sort_order, data) values "
            f"({gid}, {lit(m['type'])}, {i}, {lit(data)}::jsonb);"
        )
    out.append("commit;")
    out.append(f"select type, count(*) from public.guide_modules where guide_id = {gid} group by type;")
    sys.stdout.reconfigure(encoding="utf-8")
    print("\n".join(out))


if __name__ == "__main__":
    main()
