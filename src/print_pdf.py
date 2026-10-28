"""Monta folhas A4 com PNGs em tamanho físico, sem redimensionar para caber."""
import json
import math
import os
import sys
from pathlib import Path

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen import canvas
except ImportError:
    sys.exit("Instale as dependências do PDF: python -m pip install -r requirements.txt")


# Tipografia da identificação nos PDFs de descrições e de regiões inferiores.
LABEL_FONT = "Helvetica"
LABEL_FONT_SIZE = 7  # pontos; mesmo tamanho para nome, separador e arquétipo
LABEL_LINE_HEIGHT = 8
LABEL_GAP = 3  # pontos entre a identificação e a imagem
LABEL_SEPARATOR = " | "


def prepare_item(item):
    prepared = dict(item)
    parts = []
    label = item.get("label") or {}
    for field in ("name", "archetype"):
        value = label.get(field)
        text = " ".join(str(value).split()) if value is not None else ""
        if text:
            parts.append(text)
    prepared["_label"] = LABEL_SEPARATOR.join(parts)
    prepared["_label_height"] = LABEL_LINE_HEIGHT + LABEL_GAP if parts else 0
    return prepared


def layout(items, margin, gap, columns=None):
    page_w, page_h = A4
    area_w, area_h = page_w - 2 * margin, page_h - 2 * margin
    col_w = max(item["width"] for item in items) * mm
    available = math.floor((area_w + gap + 1e-7) / (col_w + gap))
    if columns is not None and available < columns:
        raise ValueError(f"A margem e o espaçamento não permitem {columns} coluna(s) em A4")
    columns = columns or available
    if columns < 1:
        raise ValueError("A carta não cabe na largura útil da página A4")
    pages, rows, used_h = [], [], 0
    for start in range(0, len(items), columns):
        row = items[start:start + columns]
        # Uma faixa comum mantém as caixas da mesma linha alinhadas, mesmo sem arquétipo.
        height = max(item["height"] for item in row) * mm + max(item.get("_label_height", 0) for item in row)
        if height > area_h + 1e-7:
            raise ValueError("A carta não cabe na altura útil da página A4")
        if rows and used_h + gap + height > area_h + 1e-7:
            pages.append(rows)
            rows, used_h = [], 0
        used_h += height + (gap if rows else 0)
        rows.append((row, height))
    if rows:
        pages.append(rows)
    return pages, columns, col_w


def create_pdf(job, margin, gap):
    prepared = [prepare_item(item) for item in job["items"] if item["quantity"] > 0]
    items = [item for item in prepared for _ in range(item["quantity"])]
    if not items:
        return None
    pages, columns, col_w = layout(items, margin, gap, job.get("columns"))
    destination = Path(job["output"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".pdf.tmp")
    try:
        doc = canvas.Canvas(str(temporary), pagesize=A4, pageCompression=1)
        doc.setTitle(job["title"])
        doc.setCreator("Servants of Nadir - card-generator")
        for rows in pages:
            grid_h = sum(height for _, height in rows) + gap * (len(rows) - 1)
            used_cols = max(len(row) for row, _ in rows)
            grid_w = used_cols * col_w + gap * (used_cols - 1)
            origin_x = (A4[0] - grid_w) / 2
            top = (A4[1] + grid_h) / 2
            for row, row_h in rows:
                label_h = max(item["_label_height"] for item in row)
                image_area_h = row_h - label_h
                for column, item in enumerate(row):
                    width, height = item["width"] * mm, item["height"] * mm
                    image_w = item.get("imageWidth", item["width"]) * mm
                    image_h = item.get("imageHeight", item["height"]) * mm
                    offset_x = item.get("offsetX", 0) * mm
                    offset_y = item.get("offsetY", 0) * mm
                    x = origin_x + column * (col_w + gap) + (col_w - width) / 2
                    y = top - row_h + (image_area_h - height) / 2
                    if item["_label"]:
                        label = item["_label"]
                        text_width = stringWidth(label, LABEL_FONT, LABEL_FONT_SIZE)
                        # Identificações longas ficam completas em uma única linha.
                        font_size = LABEL_FONT_SIZE * min(1, width / text_width) if text_width else LABEL_FONT_SIZE
                        doc.saveState()
                        doc.setFont(LABEL_FONT, font_size)
                        doc.drawCentredString(x + width / 2, top - LABEL_FONT_SIZE, label)
                        doc.restoreState()
                    doc.saveState()
                    if image_w != width or image_h != height or offset_x or offset_y:
                        clipping = doc.beginPath()
                        clipping.rect(x, y, width, height)
                        doc.clipPath(clipping, stroke=0, fill=0)
                    doc.drawImage(item["path"], x - offset_x, y - offset_y,
                                  width=image_w, height=image_h, mask="auto")
                    doc.restoreState()
                top -= row_h + gap
            doc.showPage()
        doc.save()
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(destination), "pages": len(pages), "copies": len(items),
            "columns": columns, "rows": [len(rows) for rows in pages]}


def main():
    manifest = json.load(sys.stdin)
    margin = manifest.get("margin", 5) * mm
    gap = manifest.get("gap", 1)
    if not math.isfinite(margin) or not math.isfinite(gap) or margin < 0 or gap < 0:
        raise ValueError("Margem e espaçamento do PDF devem ser números não negativos")
    results = [create_pdf(job, margin, gap) for job in manifest["jobs"]]
    print(json.dumps([result for result in results if result], ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit(f"Falha ao gerar PDF: {error}")
