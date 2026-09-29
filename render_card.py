#!/usr/bin/env python3
"""
card_forge  —  JSON -> template -> PNG

Uso:
  python render_card.py cards/nicole.json          # uma carta
  python render_card.py cards/                     # todas as cartas da pasta
  python render_card.py cards/ -o output --back    # também copia o verso

Layout: template.json | Dados: cards/*.json | Fontes/ícones/arte: assets/
"""
import argparse, json, math, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
SS = 4  # fator de supersampling p/ formas suaves

# ───────────────────────── helpers ─────────────────────────
def hex2rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def load_font(cands, size):
    for c in cands:
        p = Path(c) if Path(c).is_absolute() else ROOT / c
        if p.exists():
            return ImageFont.truetype(str(p), size)
    raise FileNotFoundError(f"Nenhuma fonte encontrada em: {cands}")

def vgrad(w, h, stops):
    """gradiente vertical; stops = [(t, (r,g,b)), ...]"""
    t = np.linspace(0, 1, h)
    ts = [s[0] for s in stops]
    chans = [np.interp(t, ts, [s[1][i] for s in stops]) for i in range(3)]
    arr = np.stack(chans, -1)[:, None, :].repeat(w, 1)
    return Image.fromarray(arr.astype(np.uint8), "RGB")

GOLD = [(0, (255, 240, 185)), (0.5, (214, 158, 60)), (1, (255, 226, 150))]
IRIS = [(0, (255, 140, 215)), (0.5, (255, 255, 255)), (1, (110, 225, 245))]

def text_layer(text, font, fill, stroke=None, stroke_w=0):
    """Renderiza texto -> RGBA justo no traço. fill = (r,g,b) ou lista de stops (gradiente)."""
    pad = stroke_w + 4
    l, t, r, b = font.getbbox(text, stroke_width=stroke_w)
    w, h = r - l + 2 * pad, b - t + 2 * pad
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((pad - l, pad - t), text, font=font, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if stroke_w:
        sm = Image.new("L", (w, h), 0)
        ImageDraw.Draw(sm).text((pad - l, pad - t), text, font=font, fill=255,
                                stroke_width=stroke_w, stroke_fill=255)
        out.paste(Image.new("RGBA", (w, h), (*stroke, 255)), (0, 0), sm)
    src = vgrad(w, h, fill) if isinstance(fill, list) else Image.new("RGB", (w, h), fill)
    out.paste(src, (0, 0), mask)
    return out

def paste(img, layer, x, y):
    img.alpha_composite(layer, (int(x), int(y)))

def paste_center(img, layer, cx, cy):
    paste(img, layer, cx - layer.width / 2, cy - layer.height / 2)

def smooth(pts, it=3):
    """Chaikin: arredonda polígono fechado."""
    for _ in range(it):
        new = []
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            new += [(0.75*p[0]+0.25*q[0], 0.75*p[1]+0.25*q[1]),
                    (0.25*p[0]+0.75*q[0], 0.25*p[1]+0.75*q[1])]
        pts = new
    return pts

# ───────────────────────── ícones (procedurais) ─────────────────────────
def _icon_mask(name, S):
    """Máscara L do ícone em S×S (desenhada em SS× e reduzida)."""
    B = S * SS
    m = Image.new("L", (B, B), 0); d = ImageDraw.Draw(m)
    P = lambda pts: [(x * B, y * B) for x, y in pts]
    if name == "crown":
        d.polygon(P(smooth([(0, .88), (0, .25), (.26, .55), (.5, .12), (.74, .55), (1, .25), (1, .88)], 1)), fill=255)
        d.rounded_rectangle((0, .74*B, B, .95*B), radius=B*.04, fill=255)
        for cx, cy in [(0, .2), (.5, .07), (1, .2)]:
            d.ellipse(((cx-.075)*B, (cy-.075)*B, (cx+.075)*B, (cy+.075)*B), fill=255)
    elif name == "heart":
        pts = [(16*math.sin(t)**3,
                -(13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t)))
               for t in np.linspace(0, 2*math.pi, 200)]
        pts = [((x+17)/34, (y+17)/34*.98+.02) for x, y in pts]
        d.polygon(P(pts), fill=255)
    elif name == "flame":
        d.polygon(P(smooth([(.5, 0), (.62, .2), (.8, .4), (.88, .6), (.82, .8), (.66, .95), (.5, 1),
                            (.34, .95), (.18, .8), (.12, .6), (.22, .42), (.36, .55), (.4, .3)], 3)), fill=255)
        d.polygon(P(smooth([(.5, .78), (.42, .68), (.5, .56), (.58, .68)], 3)), fill=0)  # miolo vazado
    elif name == "drop":
        d.polygon(P(smooth([(.5, 0), (.74, .4), (.86, .65), (.76, .9), (.5, 1), (.24, .9), (.14, .65), (.26, .4)], 3)), fill=255)
    elif name == "bolt":
        d.polygon(P([(.62, 0), (.18, .56), (.46, .56), (.34, 1), (.84, .4), (.55, .4)]), fill=255)
    elif name == "diamond":
        d.polygon(P([(.5, 0), (.92, .5), (.5, 1), (.08, .5)]), fill=255)
    elif name == "leaf":
        d.polygon(P(smooth([(.5, 0), (.88, .35), (.82, .8), (.5, 1), (.18, .8), (.12, .35)], 3)), fill=255)
        d.line(P([(.5, .95), (.5, .3)]), fill=0, width=int(B*.035))
    elif name == "snow":
        for a in range(3):
            ang = a * math.pi / 3
            dx, dy = math.cos(ang) * .48, math.sin(ang) * .48
            d.line(P([(.5-dx, .5-dy), (.5+dx, .5+dy)]), fill=255, width=int(B*.09))
        d.ellipse((.4*B, .4*B, .6*B, .6*B), fill=255)
    elif name == "wind":
        for k, (r, a0, a1) in enumerate([(.42, 200, 470), (.28, 230, 480), (.14, 250, 500)]):
            d.arc((.5*B-r*B, .5*B-r*B, .5*B+r*B, .5*B+r*B), a0, a1, fill=255, width=int(B*.09))
    else:
        d.ellipse((.1*B, .1*B, .9*B, .9*B), fill=255)
    return m.resize((S, S), Image.LANCZOS)

def make_icon(name, S, fill):
    custom = ROOT / "assets/icons" / f"{name}.png"
    if custom.exists():  # sobrescreva qualquer ícone com seu PNG
        return Image.open(custom).convert("RGBA").resize((S, S), Image.LANCZOS)
    mask = _icon_mask(name, S)
    src = vgrad(S, S, fill) if isinstance(fill, list) else Image.new("RGB", (S, S), fill)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0)); out.paste(src, (0, 0), mask)
    return out

# ───────────────────────── camadas ─────────────────────────
def layer_art(card, tpl, W, H):
    a = card.get("art", {})
    src = Image.open(ROOT / a["file"]).convert("RGB")
    fx, fy = a.get("focus", tpl["art"]["default_focus"])
    k = max(W / src.width, H / src.height) * a.get("scale", tpl["art"]["default_scale"])
    nw, nh = round(src.width * k), round(src.height * k)
    src = src.resize((nw, nh), Image.LANCZOS)
    x0 = min(0, max(W - nw, W / 2 - fx * nw))   # foco no centro, sem deixar buracos
    y0 = min(0, max(H - nh, H / 2 - fy * nh))
    base = Image.new("RGB", (W, H)); base.paste(src, (round(x0), round(y0)))
    return base

def apply_foil(img, strength):
    W, H = img.size
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = xx * .55 + yy * .85
    ph = d / 34.0
    rgb = np.stack([.5+.5*np.sin(ph), .5+.5*np.sin(ph+2.09), .5+.5*np.sin(ph+4.19)], -1)
    wash = (.5 + .5*np.sin(d / 420.0))[..., None]
    ov = rgb * (.5 + .5*wash)
    base = np.asarray(img, np.float32) / 255
    out = 1 - (1 - base) * (1 - ov * strength)     # screen
    out = out * .9 + .1 * (1 - (1-out)**2)          # leve lavado claro
    return Image.fromarray((out.clip(0, 1) * 255).astype(np.uint8))

def draw_frame(img, tpl):
    f = tpl["frame"]; d = ImageDraw.Draw(img)
    for x1, y1, x2, y2 in f["lines"]:
        d.line((x1, y1, x2, y2), fill=(*hex2rgb(f["color"]), 235), width=f["width"])

def draw_panel(img, box, fill_rgb, alpha, border, bw):
    x1, y1, x2, y2 = box
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    d.rounded_rectangle(box, radius=6, fill=(*fill_rgb, alpha), outline=(*hex2rgb(border), 255), width=bw)
    img.alpha_composite(ov)

def draw_badge(img, cx, cy, r, theme):
    B = 2 * r + 8; c = B / 2
    yy, xx = np.mgrid[0:B, 0:B].astype(np.float32)
    dist = np.sqrt((xx - c + .32*r)**2 + (yy - c + .32*r)**2) / (1.35*r)
    t = np.clip(dist, 0, 1)[..., None]
    L, D = np.array(hex2rgb(theme["light"]), np.float32), np.array(hex2rgb(theme["dark"]), np.float32)
    fill = Image.fromarray((L * (1-t) + D * t).astype(np.uint8), "RGB")

    def circ(rad):
        m = Image.new("L", (B*SS, B*SS), 0)
        ImageDraw.Draw(m).ellipse(((c-rad)*SS, (c-rad)*SS, (c+rad)*SS, (c+rad)*SS), fill=255)
        return m.resize((B, B), Image.LANCZOS)

    out = Image.new("RGBA", (B, B), (0, 0, 0, 0))
    ring = vgrad(B, B, [(0, (250, 230, 170)), (.45, (176, 128, 52)), (1, (240, 210, 140))])
    out.paste(ring, (0, 0), circ(r))
    out.paste(Image.new("RGB", (B, B), (60, 30, 20)), (0, 0), circ(r - 8))
    out.paste(fill, (0, 0), circ(r - 11))
    # ticks douradas no anel
    td = ImageDraw.Draw(out)
    for i in range(72):
        a = i * math.pi / 36
        td.line((c + (r-7)*math.cos(a), c + (r-7)*math.sin(a), c + r*math.cos(a), c + r*math.sin(a)),
                fill=(120, 80, 30, 150), width=1)
    # brilho superior
    gl = Image.new("L", (B, B), 0)
    ImageDraw.Draw(gl).ellipse((c-.72*r, c-.92*r, c+.72*r, c-.05*r), fill=70)
    gl = gl.filter(ImageFilter.GaussianBlur(r*.1))
    out.paste(Image.new("RGB", (B, B), (255, 255, 255)), (0, 0), Image.composite(gl, Image.new("L", (B, B), 0), circ(r-12)))
    paste_center(img, out, cx, cy)

def fit_font(kind, text, size, max_w, tpl, min_size=20):
    while size > min_size:
        f = load_font(tpl["fonts"][kind], size)
        if f.getlength(text) <= max_w: return f
        size -= 4
    return load_font(tpl["fonts"][kind], min_size)

def wrap(text, font, max_w):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if font.getlength(t) <= max_w or not cur: cur = t
        else: lines.append(cur); cur = w
    return lines + ([cur] if cur else [])

def draw_effects(img, effects, tpl):
    tb = tpl["text_box"]; x1, y1, x2, y2 = tb["box"]
    px, py = tb["padding"]; iw, ih = (x2-x1) - 2*px, (y2-y1) - 2*py
    size = tb["max_size"]
    while True:
        font = load_font(tpl["fonts"]["body"], size); lh = size * tb["line_height"]
        paras = [wrap(e, font, iw) for e in effects]
        total = sum(len(p) * lh for p in paras) + tb["paragraph_gap"] * max(0, len(paras) - 1)
        if total <= ih or size <= tb["min_size"]: break
        size -= 1
    d = ImageDraw.Draw(img); y = y1 + py; col = hex2rgb(tb["color"])
    for i, lines in enumerate(paras):
        for ln in lines:
            d.text((x1 + px, y), ln, font=font, fill=col); y += lh
        if i < len(paras) - 1:
            sy = y + tb["paragraph_gap"] / 2 - lh * .08
            d.line((x1 + px, sy, x1 + px + iw * .78, sy), fill=(*hex2rgb(tb["separator"]), 255), width=3)
            y += tb["paragraph_gap"]
    if size <= tb["min_size"] and total > ih:
        print(f"  ⚠ texto não cabe na caixa (fonte mínima {size}px) — encurte os efeitos", file=sys.stderr)

def draw_stat(img, tpl, key, value, theme):
    s = tpl["stats"]; cfg = s[key]
    draw_panel(img, cfg["box"], hex2rgb(theme["panel"]), s["panel_alpha"], cfg["border"], s["border_width"])
    x1, y1, x2, y2 = cfg["box"]; cx, cy = (x1+x2)/2, (y1+y2)/2
    avail = (x2 - x1) - 60
    ns, isz = s["number_size"], s["icon_size"]
    while True:  # auto-ajuste: encolhe número+ícone até caber na caixa
        num = text_layer(str(value), load_font(tpl["fonts"]["number"], ns),
                         (255, 255, 255), stroke=(60, 30, 30), stroke_w=4)
        if num.width + s["gap"] + isz <= avail or ns <= 60: break
        ns -= 6; isz = max(60, isz - 5)
    ic = make_icon(cfg["icon"], isz, GOLD)
    gx = cx - (num.width + s["gap"] + ic.width) / 2
    paste(img, num, gx, cy - num.height/2)
    paste(img, ic, gx + num.width + s["gap"], cy - ic.height/2)

# ───────────────────────── render ─────────────────────────
def render(card, tpl):
    W, H = tpl["card"]["width"], tpl["card"]["height"]
    theme = tpl["elements"][card["element"]]

    art = layer_art(card, tpl, W, H)
    foil = card.get("foil", tpl["foil"]["enabled"])
    if foil: art = apply_foil(art, card.get("foil_strength", tpl["foil"]["strength"]))
    img = art.convert("RGBA")

    draw_frame(img, tpl)

    # badges
    cb, eb = tpl["cost_badge"], tpl["element_badge"]
    draw_badge(img, *cb["center"], cb["radius"], theme)
    paste_center(img, text_layer(str(card["cost"]), load_font(tpl["fonts"]["number"], cb["number_size"]),
                                 IRIS, stroke=(120, 60, 170), stroke_w=3), cb["center"][0], cb["center"][1] - 4)
    draw_badge(img, *eb["center"], eb["radius"], theme)
    paste_center(img, make_icon(theme["icon"], eb["icon_size"], (255, 255, 255)), *eb["center"])

    # nome
    n = tpl["name"]
    font = fit_font("name", card["name"], n["size"], n["max_width"], tpl)
    paste(img, text_layer(card["name"], font, GOLD, stroke=(110, 70, 20), stroke_w=3), *n["pos"])

    # stats + texto
    draw_stat(img, tpl, "atk", card["atk"], theme)
    draw_stat(img, tpl, "hp", card["hp"], theme)
    t = tpl["text_box"]
    draw_panel(img, t["box"], hex2rgb(theme["panel"]), t["panel_alpha"], t["border"], t["border_width"])
    draw_effects(img, card.get("effects", []), tpl)

    # cantos arredondados
    R = tpl["card"]["corner_radius"]
    m = Image.new("L", (W*2, H*2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W*2-1, H*2-1), radius=R*2, fill=255)
    img.putalpha(m.resize((W, H), Image.LANCZOS))
    return img

def main():
    ap = argparse.ArgumentParser(description="JSON -> PNG card renderer")
    ap.add_argument("target", help="cards/x.json ou pasta com JSONs")
    ap.add_argument("-t", "--template", default=str(ROOT / "template.json"))
    ap.add_argument("-o", "--out", default=str(ROOT / "output"))
    ap.add_argument("--back", action="store_true", help="copia o verso da carta p/ a pasta de saída")
    a = ap.parse_args()

    tpl = json.load(open(a.template, encoding="utf-8"))
    tgt = Path(a.target)
    files = sorted(tgt.glob("*.json")) if tgt.is_dir() else [tgt]
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for f in files:
        card = json.load(open(f, encoding="utf-8"))
        dest = out / f"{f.stem}.png"
        render(card, tpl).save(dest)
        print(f"✔ {f.name} -> {dest}")
    if a.back:
        shutil.copy(ROOT / tpl["card"]["back"], out / "_back.png"); print("✔ verso copiado")

if __name__ == "__main__":
    main()
