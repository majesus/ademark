# ademark_pipeline.py
# Pipeline único (sin Streamlit) que genera 7 CSVs:
#   out/profesores.csv
#   out/profesores_perfil.csv
#   out/profesores_centros.csv
#   out/profesores_asignaturas.csv   <-- ahora incluye asignatura_url
#   out/investigadores.csv
#   out/runs.csv
#   out/cambios.csv
#
# Además, crea/actualiza automáticamente:
#   csv/urls.csv   (URLs PRISMA descubiertas desde profesores_perfil: perfil_prisma_url + resolución por email)
#
# Requisitos:
#   pip install requests beautifulsoup4 pandas urllib3
#
# Ejecución (desde la carpeta del proyecto):
#   python ademark_pipeline.py --dpto I0G7
#
# Opcionales:
#   python ademark_pipeline.py --dpto I0G7 --sleep 0.7 --use-cache 1
#   python ademark_pipeline.py --dpto I0G7 --rebuild-prisma-urls 1

import argparse
import hashlib
import json
import re
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Set

import pandas as pd
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# -------------------------
# Utilidades generales
# -------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()

def ensure_parent(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)

def safe_write_csv(df: pd.DataFrame, path: Path) -> None:
    ensure_parent(path)
    df.to_csv(path, index=False, encoding="utf-8-sig")

def read_csv_if_exists(path: Path) -> pd.DataFrame:
    if path.exists():
        try:
            return pd.read_csv(path, encoding="utf-8-sig")
        except UnicodeDecodeError:
            # fallback para CSVs legacy escritos con cp1252/latin-1
            return pd.read_csv(path, encoding="latin-1")
    return pd.DataFrame()

def cache_path_for(url: str, cache_dir: Path) -> Path:
    safe = (
        url.replace("://", "_")
        .replace("/", "_")
        .replace("?", "_")
        .replace("&", "_")
        .replace("=", "_")
        .replace("#", "_")
    )
    return cache_dir / f"{safe}.html"


# -------------------------
# HTTP Session robusta
# -------------------------
def build_session(user_agent: str) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=6,
        connect=6,
        read=6,
        backoff_factor=0.6,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=50, pool_maxsize=50)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    s.headers.update({"User-Agent": user_agent})
    return s

def fetch_html(
    session: requests.Session,
    url: str,
    cache_dir: Path,
    use_cache: bool,
    timeout: Tuple[int, int],
) -> str:
    cp = cache_path_for(url, cache_dir)
    if use_cache and cp.exists():
        return cp.read_text(encoding="utf-8", errors="ignore")

    r = session.get(url, timeout=timeout, allow_redirects=True)
    r.raise_for_status()
    # Pasar bytes crudos a BeautifulSoup para que detecte el encoding
    # desde el <meta charset> del HTML (más fiable que chardet para
    # páginas universitarias españolas que suelen servir ISO-8859-1)
    html = str(BeautifulSoup(r.content, "html.parser"))

    cache_dir.mkdir(parents=True, exist_ok=True)
    cp.write_text(html, encoding="utf-8")
    return html


# -------------------------
# Parsing: Profesores (US alojawebapps)
# -------------------------
US_BASE = "http://alojawebapps.us.es/"
US_LIST_FMT = "http://alojawebapps.us.es/centrosdptos/departamentos/listpdi.php?dpto={dpto}"

def parse_profesores_list(html: str, dpto_code: str) -> pd.DataFrame:
    soup = BeautifulSoup(html, "html.parser")
    li_nodes = soup.find_all("li")
    rows: List[Dict[str, Any]] = []

    for li in li_nodes:
        a = li.find("a")
        if not a or not a.get("href"):
            continue
        nombre = a.get_text(strip=True)
        url_rel = a["href"]
        url_abs = US_BASE + url_rel.lstrip("/")
        rows.append({
            "url_abs": url_abs,
            "nombre_listado": nombre,
            "dpto_code": dpto_code,
        })

    return pd.DataFrame(rows).drop_duplicates(subset=["url_abs"])


def _get_text(node) -> Optional[str]:
    return node.get_text(strip=True) if node else None

def _find_heading_exact(soup: BeautifulSoup, tag: str, exact_text: str):
    for h in soup.find_all(tag):
        if h.get_text(strip=True) == exact_text:
            return h
    return None

def parse_profesor_profile(html: str, url_abs: str) -> Tuple[Dict[str, Any], List[str], List[Dict[str, str]]]:
    """
    CAMBIO MÍNIMO:
      - antes devolvía asignaturas como List[str]
      - ahora devuelve asignaturas como List[{"asignatura": str, "asignatura_url": str}]
    El resto se mantiene igual.
    """
    soup = BeautifulSoup(html, "html.parser")

    h2 = soup.find("h2")
    nombre = _get_text(h2) or ""

    def pick_after_heading(heading_tag: str, heading_text: str, next_tag: str) -> str:
        h = _find_heading_exact(soup, heading_tag, heading_text)
        if not h:
            return ""
        nxt = h.find_next(next_tag)
        return _get_text(nxt) or ""

    categoria = pick_after_heading("h3", "Categoría:", "p")

    perfil_prisma_url = ""
    h_prisma = _find_heading_exact(soup, "h3", "Perfil de PRISMA:")
    if h_prisma:
        a = h_prisma.find_next("a")
        if a and a.get("href"):
            perfil_prisma_url = a["href"].strip()

    telefono = pick_after_heading("h4", "Teléfono:", "p")
    email = pick_after_heading("h4", "Correo electrónico personal:", "p")

    departamento = ""
    h_dpto = _find_heading_exact(soup, "h3", "Departamento:")
    if h_dpto:
        a = h_dpto.find_next("a")
        departamento = _get_text(a) or ""

    # Nota: en tu HTML original suele venir "Area de Conocimiento:" (sin tilde en Area)
    area_conocimiento = pick_after_heading("h3", "Area de Conocimiento:", "p")

    centros: List[str] = []
    h_centros = _find_heading_exact(soup, "h3", "Centro(s):")
    if h_centros:
        ul = h_centros.find_next("ul")
        if ul:
            for a in ul.find_all("a"):
                t = _get_text(a)
                if t:
                    centros.append(t)

    # ----- CAMBIO: extraer también href de cada asignatura -----
    asignaturas: List[Dict[str, str]] = []
    h_asig = _find_heading_exact(soup, "h3", "Asignaturas:")
    if h_asig:
        ul = h_asig.find_next("ul")
        if ul:
            for a in ul.find_all("a"):
                t = _get_text(a)
                href = (a.get("href") or "").strip()
                if href and not href.startswith(("http://", "https://")):
                    href = US_BASE + href.lstrip("/")
                if t:
                    asignaturas.append({
                        "asignatura": t,
                        "asignatura_url": href,
                    })
    # ----------------------------------------------------------

    # content_hash: incluye ahora también las URLs de asignaturas para detectar cambios reales
    asignaturas_hash_blob = "||".join([f"{x.get('asignatura','')}@@{x.get('asignatura_url','')}" for x in asignaturas])

    profile = {
        "url_abs": url_abs,
        "nombre": nombre,
        "categoria": categoria,
        "telefono": telefono,
        "email": email,
        "departamento": departamento,
        "area_conocimiento": area_conocimiento,
        "perfil_prisma_url": perfil_prisma_url,
        "content_hash": sha256_text("|".join([
            nombre, categoria, telefono, email, departamento, area_conocimiento, perfil_prisma_url,
            "||".join(centros),
            asignaturas_hash_blob,
        ])),
        "scraped_at": now_iso(),
    }
    return profile, centros, asignaturas


# -------------------------
# PRISMA: descubrir URLs desde profesores_perfil
# -------------------------
def is_valid_http_url(u: str) -> bool:
    return isinstance(u, str) and u.startswith(("http://", "https://"))

def canonicalize_prisma_url(u: str) -> str:
    if not is_valid_http_url(u):
        return ""
    u = u.split("#")[0].split("?")[0].strip()
    m = re.search(r"/investigador/(\d+)", u)
    if m:
        return u[:m.end()]  # .../investigador/<id>
    return u

def resolve_prisma_by_email(session: requests.Session, email: str, timeout: Tuple[int, int]) -> str:
    """
    Usa el endpoint por email:
      https://bibliometria.us.es/prisma/investigador/email/<email>
    y sigue redirecciones. Devuelve URL canónica /investigador/<id> o "".
    """
    if not email or "@" not in email:
        return ""
    enc = urllib.parse.quote(email.strip())
    url = f"https://bibliometria.us.es/prisma/investigador/email/{enc}"
    try:
        r = session.get(url, timeout=timeout, allow_redirects=True)
        final_url = (r.url or "").strip()
        return canonicalize_prisma_url(final_url)
    except Exception:
        return ""


# -------------------------
# Parsing: Investigadores (PRISMA)
# -------------------------
def parse_investigador_prisma(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")

    nombre = _get_text(soup.find("h1", id="nombre")) or "No disponible"
    categoria = _get_text(soup.find("div", id="categoria")) or "No disponible"
    email = _get_text(soup.find("div", id="email")) or "No disponible"

    def span_value(label: str, next_tag: str) -> str:
        sp = soup.find("span", string=label)
        if not sp:
            return "No disponible"
        nxt = sp.find_next(next_tag)
        return _get_text(nxt) or "No disponible"

    area_conocimiento = span_value("Área de conocimiento: ", "span")

    dep_sp = soup.find("span", string="Departamento: ")
    departamento = "No disponible"
    if dep_sp:
        a = dep_sp.find_next("a")
        departamento = _get_text(a) or "No disponible"

    # --- Grupo (evitar contaminar con identificadores) ---
    grupo = "No disponible"
    url_grupo = "No disponible"

    # PRISMA puede variar el literal, así que probamos varias etiquetas posibles.
    group_labels = ["Grupo: ", "Grupo de investigación: ", "Grupo de investigación:"]  # tolerancia
    gr_sp = None
    for lab in group_labels:
        gr_sp = soup.find("span", string=lab)
        if gr_sp:
            break

    if gr_sp:
        # Buscar el <a> solo dentro del elemento padre del span,
        # nunca en el resto del documento (evita capturar el ORCID u otros
        # identificadores cuando el profesor no tiene grupo asignado).
        parent = gr_sp.parent
        a = parent.find("a") if parent else None
        if a:
            grupo_txt = _get_text(a)
            if grupo_txt:
                grupo = grupo_txt
            href = (a.get("href") or "").strip()
            if href:
                url_grupo = href

    instituto_inv = "No disponible"
    ins_sp = soup.find("span", string="Instituto de Inv.: ")
    if ins_sp:
        a = ins_sp.find_next("a")
        instituto_inv = _get_text(a) or "No disponible"

    prog_doctorado = "No disponible"
    pd_sp = soup.find("span", string="Prog. doctorado: ")
    if pd_sp:
        a = pd_sp.find_next("a")
        prog_doctorado = _get_text(a) or "No disponible"

    # --- NUEVO: Identificadores (div#identificadores) ---
    # Cada "chip" tiene un <img alt="...:"> y un <a> con el código y href al perfil externo
    ids = {
        "orcid": "No disponible",
        "researcherid": "No disponible",
        "scopus_author_id": "No disponible",
        "google_scholar_id": "No disponible",
        "dialnet_id": "No disponible",
        "idus_id": "No disponible",
        "sisiius_id": "No disponible",
        "openalex_id": "No disponible",
        # (opcional pero útil para tu web)
        "orcid_url": "No disponible",
        "researcherid_url": "No disponible",
        "scopus_author_url": "No disponible",
        "google_scholar_url": "No disponible",
        "dialnet_url": "No disponible",
        "idus_url": "No disponible",
        "sisiius_url": "No disponible",
        "openalex_url": "No disponible",
    }

    ident_div = soup.find("div", id="identificadores")
    if ident_div:
        for chip in ident_div.find_all("div", class_="chip"):
            img = chip.find("img")
            a = chip.find("a")
            if not img or not a:
                continue

            label = (img.get("alt") or "").strip().rstrip(":").lower()
            code = (a.get_text(" ", strip=True) or "").strip()
            href = (a.get("href") or "").strip()

            # Mapeo por alt (según tu HTML)
            if label == "orcid":
                ids["orcid"] = code or ids["orcid"]
                ids["orcid_url"] = href or ids["orcid_url"]
            elif label == "researcherid":
                ids["researcherid"] = code or ids["researcherid"]
                ids["researcherid_url"] = href or ids["researcherid_url"]
            elif label == "author scopus id":
                ids["scopus_author_id"] = code or ids["scopus_author_id"]
                ids["scopus_author_url"] = href or ids["scopus_author_url"]
            elif label == "google scholar":
                ids["google_scholar_id"] = code or ids["google_scholar_id"]
                ids["google_scholar_url"] = href or ids["google_scholar_url"]
            elif label == "dialnet":
                ids["dialnet_id"] = code or ids["dialnet_id"]
                ids["dialnet_url"] = href or ids["dialnet_url"]
            elif label == "idus":
                ids["idus_id"] = code or ids["idus_id"]
                ids["idus_url"] = href or ids["idus_url"]
            elif label == "sisiius":
                ids["sisiius_id"] = code or ids["sisiius_id"]
                ids["sisiius_url"] = href or ids["sisiius_url"]
            elif label == "openalex":
                ids["openalex_id"] = code or ids["openalex_id"]
                ids["openalex_url"] = href or ids["openalex_url"]

    row = {
        "url": url,
        "nombre": nombre,
        "categoria": categoria,
        "email": email,
        "area_conocimiento": area_conocimiento,
        "departamento": departamento,
        "grupo": grupo,
        "url_grupo": url_grupo,
        "instituto_inv": instituto_inv,
        "prog_doctorado": prog_doctorado,
        # NUEVAS columnas (códigos + urls)
        **ids,
        "content_hash": sha256_text("|".join([
            nombre, categoria, email, area_conocimiento, departamento,
            grupo, url_grupo, instituto_inv, prog_doctorado,
            ids["orcid"], ids["researcherid"], ids["scopus_author_id"], ids["google_scholar_id"],
            ids["dialnet_id"], ids["idus_id"], ids["sisiius_id"], ids["openalex_id"],
            ids["orcid_url"], ids["researcherid_url"], ids["scopus_author_url"], ids["google_scholar_url"],
            ids["dialnet_url"], ids["idus_url"], ids["sisiius_url"], ids["openalex_url"],
        ])),
        "scraped_at": now_iso(),
    }
    return row


# -------------------------
# Cambios: comparación por hashes
# -------------------------
def diff_hash_map(old_map: Dict[str, str], new_map: Dict[str, str], entity: str, run_id: str) -> pd.DataFrame:
    detected = now_iso()
    rows: List[Dict[str, Any]] = []

    old_keys = set(old_map.keys())
    new_keys = set(new_map.keys())

    for k in sorted(new_keys - old_keys):
        rows.append({
            "run_id": run_id,
            "entity": entity,
            "entity_key": k,
            "change_type": "added",
            "old_hash": "",
            "new_hash": new_map[k],
            "detected_at": detected,
        })

    for k in sorted(old_keys - new_keys):
        rows.append({
            "run_id": run_id,
            "entity": entity,
            "entity_key": k,
            "change_type": "removed",
            "old_hash": old_map[k],
            "new_hash": "",
            "detected_at": detected,
        })

    for k in sorted(old_keys & new_keys):
        if old_map[k] != new_map[k]:
            rows.append({
                "run_id": run_id,
                "entity": entity,
                "entity_key": k,
                "change_type": "updated",
                "old_hash": old_map[k],
                "new_hash": new_map[k],
                "detected_at": detected,
            })

    return pd.DataFrame(rows)

def agg_list_hash(df: pd.DataFrame, key_col: str, value_col: str) -> Dict[str, str]:
    """
    Para tablas 1-N (centros/asignaturas):
    hash por key (profesor) basado en lista ordenada.
    """
    if df.empty:
        return {}
    m: Dict[str, List[str]] = {}
    for _, r in df.iterrows():
        k = str(r.get(key_col, "")).strip()
        v = str(r.get(value_col, "")).strip()
        if not k or not v:
            continue
        m.setdefault(k, []).append(v)
    return {k: sha256_text("||".join(sorted(vs))) for k, vs in m.items()}

def agg_asignaturas_hash(df_asig: pd.DataFrame) -> Dict[str, str]:
    """
    CAMBIO MÍNIMO:
      hash por profesor usando (asignatura + asignatura_url)
      para que cambios en URL también se detecten.
    """
    if df_asig.empty:
        return {}
    tmp = df_asig.copy()
    if "asignatura_url" not in tmp.columns:
        tmp["asignatura_url"] = ""
    tmp["_pair"] = tmp["asignatura"].astype(str).fillna("") + "@@" + tmp["asignatura_url"].astype(str).fillna("")
    return agg_list_hash(tmp, "url_abs", "_pair")


# -------------------------
# Pipeline principal
# -------------------------
@dataclass
class RunStats:
    profesores_ok: int = 0
    profesores_err: int = 0
    investigadores_ok: int = 0
    investigadores_err: int = 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dpto", default="I0G7", help="Código de departamento (ej: I0G7)")
    ap.add_argument("--out-dir", default="out", help="Directorio de salida")
    ap.add_argument("--cache-dir", default="cache_html", help="Directorio de caché HTML")
    ap.add_argument("--csv-dir", default="csv", help="Directorio para intermedios (urls.csv)")
    ap.add_argument("--use-cache", type=int, default=1, help="1 usa caché, 0 fuerza descarga")
    ap.add_argument("--sleep", type=float, default=0.7, help="Segundos entre peticiones")
    ap.add_argument("--timeout-connect", type=int, default=5)
    ap.add_argument("--timeout-read", type=int, default=20)
    ap.add_argument("--user-agent", default="Mozilla/5.0 (compatible; ademark-scraper/1.0)")
    ap.add_argument("--rebuild-prisma-urls", type=int, default=0, help="1 fuerza reconstruir csv/urls.csv desde profesores")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    cache_dir = Path(args.cache_dir)
    csv_dir = Path(args.csv_dir)

    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    csv_dir.mkdir(parents=True, exist_ok=True)

    use_cache = bool(args.use_cache)
    timeout = (args.timeout_connect, args.timeout_read)

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    started_at = now_iso()
    stats = RunStats()

    session = build_session(args.user_agent)
    err_path = out_dir / "errores.jsonl"

    # ---- Cargar versiones antiguas para calcular cambios ----
    old_prof_perfil = read_csv_if_exists(out_dir / "profesores_perfil.csv")
    old_inv = read_csv_if_exists(out_dir / "investigadores.csv")
    old_centros = read_csv_if_exists(out_dir / "profesores_centros.csv")
    old_asig = read_csv_if_exists(out_dir / "profesores_asignaturas.csv")

    old_prof_hash = dict(zip(old_prof_perfil.get("url_abs", []), old_prof_perfil.get("content_hash", []))) if not old_prof_perfil.empty else {}
    old_inv_hash = dict(zip(old_inv.get("url", []), old_inv.get("content_hash", []))) if not old_inv.empty else {}
    old_centros_hash = agg_list_hash(old_centros, "url_abs", "centro")
    # CAMBIO: asignaturas hash por (asignatura + url)
    old_asig_hash = agg_asignaturas_hash(old_asig)

    cambios_frames: List[pd.DataFrame] = []

    # -------------------------
    # 1) PROFESORES: listado -> out/profesores.csv
    # -------------------------
    list_url = US_LIST_FMT.format(dpto=args.dpto)
    list_html = fetch_html(session, list_url, cache_dir, use_cache, timeout)
    df_list_new = parse_profesores_list(list_html, args.dpto)

    profesores_csv_path = out_dir / "profesores.csv"
    df_list_old = read_csv_if_exists(profesores_csv_path)

    now_ts = now_iso()
    if df_list_old.empty:
        df_list_new["first_seen"] = now_ts
        df_list_new["last_seen"] = now_ts
        df_profesores = df_list_new.copy()
    else:
        old_first = dict(zip(df_list_old["url_abs"].astype(str), df_list_old.get("first_seen", "")))

        df_list_new["first_seen"] = df_list_new["url_abs"].astype(str).map(lambda u: old_first.get(u, now_ts))
        df_list_new["last_seen"] = now_ts

        # conservar históricos que ya no aparecen hoy (para no perderlos)
        old_urls = set(df_list_old["url_abs"].astype(str).tolist())
        new_urls = set(df_list_new["url_abs"].astype(str).tolist())
        missing = sorted(old_urls - new_urls)
        df_missing = df_list_old[df_list_old["url_abs"].astype(str).isin(missing)].copy()

        df_profesores = pd.concat([df_list_new, df_missing], ignore_index=True)

    safe_write_csv(df_profesores, profesores_csv_path)

    # -------------------------
    # 2) PROFESORES: perfiles + centros + asignaturas
    # -------------------------
    prof_profiles: List[Dict[str, Any]] = []
    prof_centros_rows: List[Dict[str, Any]] = []
    prof_asig_rows: List[Dict[str, Any]] = []

    urls_prof = df_list_new["url_abs"].astype(str).tolist()

    for url_abs in urls_prof:
        try:
            html = fetch_html(session, url_abs, cache_dir, use_cache, timeout)
            profile, centros, asignaturas = parse_profesor_profile(html, url_abs)

            prof_profiles.append(profile)
            scraped_at = profile["scraped_at"]

            for idx, c in enumerate(centros, start=1):
                prof_centros_rows.append({
                    "url_abs": url_abs,
                    "centro": c,
                    "position": idx,
                    "scraped_at": scraped_at,
                })

            # CAMBIO: ahora asignaturas incluye nombre + url
            for idx, a in enumerate(asignaturas, start=1):
                prof_asig_rows.append({
                    "url_abs": url_abs,
                    "asignatura": a.get("asignatura", ""),
                    "asignatura_url": a.get("asignatura_url", ""),
                    "position": idx,
                    "scraped_at": scraped_at,
                })

            stats.profesores_ok += 1

        except Exception as e:
            stats.profesores_err += 1
            ensure_parent(err_path)
            with err_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"where": "profesor_profile", "url": url_abs, "error": str(e)}, ensure_ascii=False) + "\n")

        time.sleep(args.sleep)

    df_prof_perfil = pd.DataFrame(prof_profiles)
    df_prof_centros = pd.DataFrame(prof_centros_rows)
    df_prof_asig = pd.DataFrame(prof_asig_rows)

    safe_write_csv(df_prof_perfil, out_dir / "profesores_perfil.csv")
    safe_write_csv(df_prof_centros, out_dir / "profesores_centros.csv")
    safe_write_csv(df_prof_asig, out_dir / "profesores_asignaturas.csv")

    # cambios profesores_perfil + centros/asignaturas (agregados por profesor)
    new_prof_hash = dict(zip(df_prof_perfil["url_abs"].astype(str), df_prof_perfil["content_hash"].astype(str))) if not df_prof_perfil.empty else {}
    cambios_frames.append(diff_hash_map(old_prof_hash, new_prof_hash, "profesores_perfil", run_id))

    new_centros_hash = agg_list_hash(df_prof_centros, "url_abs", "centro")
    # CAMBIO: asignaturas hash por (asignatura + url)
    new_asig_hash = agg_asignaturas_hash(df_prof_asig)

    cambios_frames.append(diff_hash_map(old_centros_hash, new_centros_hash, "profesores_centros", run_id))
    cambios_frames.append(diff_hash_map(old_asig_hash, new_asig_hash, "profesores_asignaturas", run_id))

    # -------------------------
    # 3) PRISMA: construir/actualizar csv/urls.csv desde profesores_perfil
    # -------------------------
    urls_csv_path = csv_dir / "urls.csv"
    prisma_urls_set: Set[str] = set()

    # 3.1) Si NO forzamos rebuild y ya existe urls.csv, lo cargamos primero (para no perder históricos)
    if urls_csv_path.exists() and not bool(args.rebuild_prisma_urls):
        try:
            old_urls_df = pd.read_csv(urls_csv_path)
            if "url" in old_urls_df.columns:
                for u in old_urls_df["url"].fillna("").astype(str).tolist():
                    cu = canonicalize_prisma_url(u)
                    if cu and "/investigador/" in cu:
                        prisma_urls_set.add(cu)
        except Exception:
            pass

    # 3.2) Añadir URLs directas desde perfil_prisma_url (si están presentes)
    if not df_prof_perfil.empty and "perfil_prisma_url" in df_prof_perfil.columns:
        for u in df_prof_perfil["perfil_prisma_url"].fillna("").astype(str).tolist():
            cu = canonicalize_prisma_url(u)
            if cu and "/investigador/" in cu:
                prisma_urls_set.add(cu)

    # 3.3) Fallback: resolver por email usando endpoint /investigador/email/<email>
    if not df_prof_perfil.empty and "email" in df_prof_perfil.columns:
        for email in df_prof_perfil["email"].fillna("").astype(str).tolist():
            resolved = resolve_prisma_by_email(session, email, timeout=timeout)
            if resolved and "/investigador/" in resolved:
                prisma_urls_set.add(resolved)
            time.sleep(args.sleep)

    # 3.4) Guardar csv/urls.csv
    df_urls = pd.DataFrame({"url": sorted(prisma_urls_set)})
    safe_write_csv(df_urls, urls_csv_path)

    # -------------------------
    # 4) PRISMA: scrape investigadores -> out/investigadores.csv
    # -------------------------
    prisma_urls = df_urls["url"].dropna().astype(str).tolist()

    inv_rows: List[Dict[str, Any]] = []
    for url in prisma_urls:
        try:
            html = fetch_html(session, url, cache_dir, use_cache, timeout)
            row = parse_investigador_prisma(html, url)
            inv_rows.append(row)
            stats.investigadores_ok += 1
        except Exception as e:
            stats.investigadores_err += 1
            ensure_parent(err_path)
            with err_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"where": "investigador_prisma", "url": url, "error": str(e)}, ensure_ascii=False) + "\n")
        time.sleep(args.sleep)

    df_inv = pd.DataFrame(inv_rows)
    safe_write_csv(df_inv, out_dir / "investigadores.csv")

    new_inv_hash = dict(zip(df_inv["url"].astype(str), df_inv["content_hash"].astype(str))) if not df_inv.empty else {}
    cambios_frames.append(diff_hash_map(old_inv_hash, new_inv_hash, "investigadores", run_id))

    # -------------------------
    # 5) runs.csv + cambios.csv
    # -------------------------
    finished_at = now_iso()

    runs_path = out_dir / "runs.csv"
    df_runs_old = read_csv_if_exists(runs_path)
    run_row = pd.DataFrame([{
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "status": "ok",
        "profesores_ok": stats.profesores_ok,
        "profesores_err": stats.profesores_err,
        "investigadores_ok": stats.investigadores_ok,
        "investigadores_err": stats.investigadores_err,
    }])
    safe_write_csv(pd.concat([df_runs_old, run_row], ignore_index=True), runs_path)

    cambios_path = out_dir / "cambios.csv"
    df_cambios_old = read_csv_if_exists(cambios_path)
    _non_empty_cambios = [c for c in cambios_frames if not c.empty]
    df_cambios_new_part = (
        pd.concat(_non_empty_cambios, ignore_index=True)
        if _non_empty_cambios else
        pd.DataFrame(columns=["run_id", "entity", "entity_key", "change_type", "old_hash", "new_hash", "detected_at"])
    )
    safe_write_csv(pd.concat([df_cambios_old, df_cambios_new_part], ignore_index=True), cambios_path)

    print("OK")
    print("Creado/actualizado:", (csv_dir / "urls.csv").resolve())
    print("Salida:", out_dir.resolve())
    print("profesores_ok/err:", stats.profesores_ok, "/", stats.profesores_err)
    print("investigadores_ok/err:", stats.investigadores_ok, "/", stats.investigadores_err)


if __name__ == "__main__":
    main()
