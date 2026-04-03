"""Velo Components Viewer — API Flask."""
import os
import sqlite3
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, send_file, abort
from flask_cors import CORS

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

# Config
DB_PATH = os.environ.get("VELO_DB", r"C:\Users\jeand\lbc-velo-components\velobase.db")
IMAGES_ROOT = Path(os.environ.get("VELO_IMAGES", r"C:\Users\jeand\lbc-velo-components\data\images\velobase"))

# Disraeli DB — try env var, then known locations
_DISRAELI_CANDIDATES = [
    os.environ.get("DISRAELI_DB", ""),
    r"C:\Users\jeand\lbc-velo-components\disraeli.db",
    r"C:\Users\jeand\lbc-velo-components\.claude\worktrees\determined-mclean\disraeli.db",
]
DISRAELI_DB_PATH = next((p for p in _DISRAELI_CANDIDATES if p and os.path.exists(p)), None)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def get_disraeli_db():
    if not DISRAELI_DB_PATH:
        abort(503, description="disraeli.db introuvable")
    conn = sqlite3.connect(DISRAELI_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# ---------- Static frontend ----------

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ---------- Images ----------

IMAGES_ALT = Path(os.environ.get("VELO_IMAGES_ALT", r"C:\Users\jeand\lbc-velo-components\data\images"))


@app.route("/images/<path:filepath>")
def serve_image(filepath):
    # Normalize path separators
    filepath = filepath.replace("/", os.sep).replace("\\", os.sep)
    # Try velobase dir first, then root images dir (old paths like shimano/, campagnolo/)
    for base in [IMAGES_ROOT, IMAGES_ALT]:
        full = base / filepath
        if full.is_file():
            return send_file(full)
    abort(404)


def image_url_from_db(local_path):
    """Convert DB local_path to a URL."""
    if not local_path:
        return None
    # Normalize backslashes
    p = local_path.replace("\\", "/")
    # Strip any data/images/ prefix — handles both old (data/images/shimano/)
    # and new (data/images/velobase/) paths
    if "data/images/" in p:
        p = p[p.index("data/images/") + len("data/images/"):]
    return "/images/" + p


# ---------- API ----------

@app.route("/api/sections")
def api_sections():
    conn = get_db()
    rows = conn.execute(
        "SELECT section, COUNT(*) as count FROM items GROUP BY section ORDER BY count DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/groups")
def api_groups():
    conn = get_db()
    section = request.args.get("section")
    brand = request.args.get("brand")
    conditions = ["group_name IS NOT NULL AND group_name != ''"]
    params = []
    if section:
        conditions.append("section = ?")
        params.append(section)
    if brand:
        conditions.append("brand = ?")
        params.append(brand)
    where = "WHERE " + " AND ".join(conditions)
    rows = conn.execute(
        f"SELECT group_name, COUNT(*) as count FROM items {where} GROUP BY group_name ORDER BY count DESC",
        params,
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/categories")
def api_categories():
    conn = get_db()
    section = request.args.get("section")
    conditions = ["category IS NOT NULL AND category != ''"]
    params = []
    if section:
        conditions.append("section = ?")
        params.append(section)
    where = "WHERE " + " AND ".join(conditions)
    rows = conn.execute(
        f"SELECT category, COUNT(*) as count FROM items {where} GROUP BY category ORDER BY count DESC",
        params,
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/brands")
def api_brands():
    conn = get_db()
    section = request.args.get("section")
    if section:
        rows = conn.execute(
            "SELECT brand, COUNT(*) as count FROM items WHERE section=? AND brand != '' AND brand IS NOT NULL GROUP BY brand ORDER BY count DESC",
            (section,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT brand, COUNT(*) as count FROM items WHERE brand != '' AND brand IS NOT NULL GROUP BY brand ORDER BY count DESC"
        ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/items")
def api_items():
    conn = get_db()
    page = int(request.args.get("page", 1))
    per_page = min(int(request.args.get("per_page", 48)), 200)
    offset = (page - 1) * per_page

    conditions = []
    params = []

    section = request.args.get("section")
    if section:
        conditions.append("i.section = ?")
        params.append(section)

    brand = request.args.get("brand")
    if brand:
        conditions.append("i.brand = ?")
        params.append(brand)

    q = request.args.get("q")
    if q:
        # Multi-word search: each word must match at least one field
        words = q.strip().split()
        for word in words:
            conditions.append(
                "(i.name LIKE ? OR i.brand LIKE ? OR i.model LIKE ? "
                "OR i.group_name LIKE ? OR i.category LIKE ? OR i.years_raw LIKE ?)"
            )
            params.extend([f"%{word}%"] * 6)

    group_name = request.args.get("group")
    if group_name:
        conditions.append("i.group_name = ?")
        params.append(group_name)

    year_min = request.args.get("year_min")
    if year_min:
        conditions.append("i.year_start >= ?")
        params.append(int(year_min))

    year_max = request.args.get("year_max")
    if year_max:
        conditions.append("(i.year_start <= ? OR i.year_start IS NULL)")
        params.append(int(year_max))

    category = request.args.get("category")
    if category:
        conditions.append("i.category = ?")
        params.append(category)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    count = conn.execute(
        f"SELECT COUNT(*) FROM items i {where}", params
    ).fetchone()[0]

    rows = conn.execute(
        f"""SELECT i.*, img.local_path as image_path
            FROM items i
            LEFT JOIN images img ON img.item_id = i.id AND img.is_primary = 1
            {where}
            ORDER BY (CASE WHEN img.local_path IS NOT NULL THEN 0 ELSE 1 END),
                     i.group_name, i.year_start, i.brand, i.name
            LIMIT ? OFFSET ?""",
        params + [per_page, offset],
    ).fetchall()

    items = []
    for r in rows:
        d = dict(r)
        d["image_url"] = image_url_from_db(d.get("image_path"))
        d.pop("image_path", None)
        items.append(d)

    conn.close()
    return jsonify({
        "items": items,
        "total": count,
        "page": page,
        "per_page": per_page,
        "pages": (count + per_page - 1) // per_page,
    })


@app.route("/api/items/<item_id>")
def api_item_detail(item_id):
    conn = get_db()
    item = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if not item:
        conn.close()
        abort(404)

    d = dict(item)

    images = conn.execute(
        "SELECT url, local_path, is_primary FROM images WHERE item_id = ? ORDER BY is_primary DESC",
        (item_id,),
    ).fetchall()
    d["images"] = []
    for img in images:
        img_d = dict(img)
        img_d["local_url"] = image_url_from_db(img_d.get("local_path"))
        d["images"].append(img_d)

    exclude = {"Category", "Country", "Weight", "Years", "Brand", "Model", "Name", "Added By", "Updated By"}
    specs = conn.execute(
        "SELECT key, value FROM specs WHERE item_id = ?", (item_id,)
    ).fetchall()
    d["specs"] = {s["key"]: s["value"] for s in specs if s["key"] not in exclude}

    # Related catalogs: same brand, year overlap
    if d.get("brand") and d["brand"].strip():
        year_start = d.get("year_start")
        year_end = d.get("year_end") or year_start
        cat_params = [d["brand"]]
        cat_cond = "brand = ?"
        if year_start:
            cat_cond += " AND (year_raw IS NULL OR year_raw = '' OR CAST(year_raw AS INTEGER) BETWEEN ? AND ?)"
            y_lo = max(1900, (year_start or 1900) - 5)
            y_hi = min(2030, (year_end or year_start or 2030) + 5)
            cat_params.extend([y_lo, y_hi])
        cats = conn.execute(
            f"SELECT id, title, brand, year_raw, download_url FROM catalogs WHERE {cat_cond} ORDER BY year_raw, title",
            cat_params,
        ).fetchall()
        d["related_catalogs"] = [dict(c) for c in cats]
    else:
        d["related_catalogs"] = []

    conn.close()
    return jsonify(d)


@app.route("/api/stats")
def api_stats():
    conn = get_db()
    sections = conn.execute(
        "SELECT section, COUNT(*) as count FROM items GROUP BY section ORDER BY count DESC"
    ).fetchall()
    top_brands = conn.execute(
        "SELECT brand, COUNT(*) as count FROM items WHERE brand != '' AND brand IS NOT NULL GROUP BY brand ORDER BY count DESC LIMIT 20"
    ).fetchall()
    total_images = conn.execute("SELECT COUNT(*) FROM images").fetchone()[0]
    total_downloaded = conn.execute(
        "SELECT COUNT(*) FROM images WHERE local_path IS NOT NULL"
    ).fetchone()[0]
    total_catalogs = conn.execute("SELECT COUNT(*) FROM catalogs").fetchone()[0]

    years = conn.execute(
        """SELECT year_start as year, COUNT(*) as count
           FROM items WHERE year_start IS NOT NULL
           GROUP BY year_start ORDER BY year_start"""
    ).fetchall()

    conn.close()
    return jsonify({
        "sections": [dict(r) for r in sections],
        "top_brands": [dict(r) for r in top_brands],
        "total_items": sum(r["count"] for r in sections),
        "total_images": total_images,
        "total_downloaded": total_downloaded,
        "total_catalogs": total_catalogs,
        "years": [dict(r) for r in years],
    })


@app.route("/api/catalogs")
def api_catalogs():
    conn = get_db()
    q = request.args.get("q")
    brand = request.args.get("brand")
    conditions = []
    params = []
    if q:
        conditions.append("(title LIKE ? OR brand LIKE ?)")
        params.extend([f"%{q}%"] * 2)
    if brand:
        conditions.append("brand = ?")
        params.append(brand)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = conn.execute(
        f"SELECT * FROM catalogs {where} ORDER BY brand, title", params
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------- Links ----------

@app.route("/api/links", methods=["GET"])
def api_links_list():
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    conn.commit()
    rows = conn.execute("SELECT * FROM links ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/links", methods=["POST"])
def api_links_create():
    data = request.get_json()
    if not data or not data.get("url"):
        return jsonify({"error": "url required"}), 400
    conn = get_db()
    conn.execute("""CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    conn.execute(
        "INSERT INTO links (url, title, notes) VALUES (?, ?, ?)",
        (data["url"], data.get("title", ""), data.get("notes", "")),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True}), 201


@app.route("/api/links/<int:link_id>", methods=["DELETE"])
def api_links_delete(link_id):
    conn = get_db()
    conn.execute("DELETE FROM links WHERE id = ?", (link_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- Disraeli Gears ----------

@app.route("/api/disraeli/stats")
def api_disraeli_stats():
    conn = get_disraeli_db()
    total_derailleurs = conn.execute("SELECT COUNT(*) FROM derailleurs").fetchone()[0]
    total_brands = conn.execute("SELECT COUNT(*) FROM brands").fetchone()[0]
    total_images = conn.execute("SELECT COUNT(*) FROM derailleur_images").fetchone()[0]
    total_documents = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    conn.close()
    return jsonify({
        "total_derailleurs": total_derailleurs,
        "total_brands": total_brands,
        "total_images": total_images,
        "total_documents": total_documents,
    })


@app.route("/api/disraeli/brands")
def api_disraeli_brands():
    conn = get_disraeli_db()
    rows = conn.execute(
        """SELECT b.id, b.name, COUNT(d.id) as count
           FROM brands b
           LEFT JOIN derailleurs d ON d.brand_id = b.id
           GROUP BY b.id, b.name
           HAVING count > 0
           ORDER BY count DESC, b.name"""
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/disraeli/derailleurs")
def api_disraeli_derailleurs():
    conn = get_disraeli_db()
    brand = request.args.get("brand")
    brand_id = request.args.get("brand_id")
    conditions = []
    params = []
    if brand_id:
        conditions.append("d.brand_id = ?")
        params.append(int(brand_id))
    elif brand:
        conditions.append("b.name = ?")
        params.append(brand)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = conn.execute(
        f"""SELECT d.id, d.title, d.model, d.year_text, b.name as brand_name,
                   img.url as primary_image
            FROM derailleurs d
            JOIN brands b ON b.id = d.brand_id
            LEFT JOIN derailleur_images img ON img.derailleur_id = d.id AND img.is_primary = 1
            {where}
            ORDER BY b.name, d.year_text, d.title""",
        params,
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/disraeli/derailleurs/<int:derailleur_id>")
def api_disraeli_derailleur_detail(derailleur_id):
    conn = get_disraeli_db()
    row = conn.execute(
        """SELECT d.*, b.name as brand_name
           FROM derailleurs d
           JOIN brands b ON b.id = d.brand_id
           WHERE d.id = ?""",
        (derailleur_id,),
    ).fetchone()
    if not row:
        conn.close()
        abort(404)
    d = dict(row)

    images = conn.execute(
        "SELECT url, local_path, is_primary FROM derailleur_images WHERE derailleur_id = ? ORDER BY is_primary DESC",
        (derailleur_id,),
    ).fetchall()
    d["images"] = [dict(i) for i in images]

    docs = conn.execute(
        """SELECT doc.id, doc.title, doc.year_text, doc.doc_type, doc.url, doc.category
           FROM documents doc
           JOIN derailleur_documents dd ON dd.document_id = doc.id
           WHERE dd.derailleur_id = ?
           ORDER BY doc.year_text, doc.title""",
        (derailleur_id,),
    ).fetchall()
    d["documents"] = [dict(doc) for doc in docs]

    conn.close()
    return jsonify(d)


@app.route("/api/disraeli/documents")
def api_disraeli_documents():
    conn = get_disraeli_db()
    brand = request.args.get("brand")
    brand_id = request.args.get("brand_id")
    conditions = []
    params = []
    if brand_id:
        conditions.append("doc.brand_id = ?")
        params.append(int(brand_id))
    elif brand:
        conditions.append("b.name = ?")
        params.append(brand)
    where = ("JOIN brands b ON b.id = doc.brand_id WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = conn.execute(
        f"SELECT doc.* FROM documents doc {where} ORDER BY doc.year_text, doc.title",
        params,
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
