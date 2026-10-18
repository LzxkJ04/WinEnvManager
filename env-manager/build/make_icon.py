# -*- coding: utf-8 -*-
"""
生成 WinEnv管家 全套图标（标准库，无 Pillow）。

造型：超椭圆圆角方块 + 品牌蓝对角渐变 + 圆角终端符号 >_
同一几何用于窗口/任务栏、侧栏 logo、安装包、安装向导，以及托盘深浅两版。
"""
import math
import os
import shutil
import struct
import zlib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BASE)
S = 256
SS = 4
N = S * SS

# 设计坐标（256 画布）。尖角用折线描边的斜接，两端圆头，下划线是独立胶囊。
CHEVRON = ((66.0, 58.0), (140.0, 116.0), (66.0, 174.0))
CHEVRON_HALF = 18.0
BAR = ((166.0, 168.0), (218.0, 168.0))
BAR_HALF = 15.5
SQUIRCLE_PAD = 7.0
SQUIRCLE_POWER = 4.4

PALETTES = {
    # 窗口、任务栏、logo、安装包
    'brand': {
        'c0': (126, 184, 255),
        'c1': (22, 93, 255),
        'c2': (10, 52, 184),
        'fg': (255, 255, 255),
        'sheen': 0.22,
        'rim': (255, 255, 255),
        'rim_amt': 0.42,
    },
    # 浅色任务栏：深底白符号，避免融进白色托盘
    'light': {
        'c0': (78, 90, 112),
        'c1': (32, 39, 54),
        'c2': (18, 22, 32),
        'fg': (255, 255, 255),
        'sheen': 0.10,
        'rim': (150, 186, 255),
        'rim_amt': 0.55,
    },
    # 深色任务栏：浅底品牌蓝符号
    'dark': {
        'c0': (255, 255, 255),
        'c1': (232, 239, 250),
        'c2': (198, 210, 230),
        'fg': (16, 84, 232),
        'sheen': 0.0,
        'rim': (22, 93, 255),
        'rim_amt': 0.28,
    },
}


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def mix(c0, c1, t):
    return (
        lerp(c0[0], c1[0], t),
        lerp(c0[1], c1[1], t),
        lerp(c0[2], c1[2], t),
    )


def _norm(dx, dy):
    length = math.hypot(dx, dy) or 1.0
    return dx / length, dy / length


def _intersect(ax, ay, bx, by, cx, cy, dx, dy):
    rx, ry = bx - ax, by - ay
    sx, sy = dx - cx, dy - cy
    cross = rx * sy - ry * sx
    if abs(cross) < 1e-8:
        return ((bx + cx) * 0.5, (by + cy) * 0.5)
    t = ((cx - ax) * sy - (cy - ay) * sx) / cross
    return (ax + t * rx, ay + t * ry)


def _clamp_from(joint, center, limit):
    dx, dy = joint[0] - center[0], joint[1] - center[1]
    length = math.hypot(dx, dy)
    if length > limit and length > 0:
        scale = limit / length
        return (center[0] + dx * scale, center[1] + dy * scale)
    return joint


def chevron_polygon(p0, p1, p2, half):
    u1x, u1y = _norm(p1[0] - p0[0], p1[1] - p0[1])
    u2x, u2y = _norm(p2[0] - p1[0], p2[1] - p1[1])
    n1x, n1y = -u1y, u1x
    n2x, n2y = -u2y, u2x
    left = _intersect(
        p0[0] + n1x * half, p0[1] + n1y * half,
        p1[0] + n1x * half, p1[1] + n1y * half,
        p1[0] + n2x * half, p1[1] + n2y * half,
        p2[0] + n2x * half, p2[1] + n2y * half,
    )
    right = _intersect(
        p0[0] - n1x * half, p0[1] - n1y * half,
        p1[0] - n1x * half, p1[1] - n1y * half,
        p1[0] - n2x * half, p1[1] - n2y * half,
        p2[0] - n2x * half, p2[1] - n2y * half,
    )
    # 斜接过长会在 16px 上变成刺，收成短平头
    left = _clamp_from(left, p1, half * 2.35)
    right = _clamp_from(right, p1, half * 2.35)
    return [
        (p0[0] + n1x * half, p0[1] + n1y * half),
        left,
        (p2[0] + n2x * half, p2[1] + n2y * half),
        (p2[0] - n2x * half, p2[1] - n2y * half),
        right,
        (p0[0] - n1x * half, p0[1] - n1y * half),
    ]


def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def dist_to_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    l2 = vx * vx + vy * vy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / l2))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return math.hypot(dx, dy)


POLY = chevron_polygon(CHEVRON[0], CHEVRON[1], CHEVRON[2], CHEVRON_HALF)


def on_glyph(x, y):
    """x/y 为 256 设计坐标。"""
    if point_in_poly(x, y, POLY):
        return True
    if math.hypot(x - CHEVRON[0][0], y - CHEVRON[0][1]) <= CHEVRON_HALF:
        return True
    if math.hypot(x - CHEVRON[2][0], y - CHEVRON[2][1]) <= CHEVRON_HALF:
        return True
    if dist_to_segment(x, y, BAR[0][0], BAR[0][1], BAR[1][0], BAR[1][1]) <= BAR_HALF:
        return True
    return False


def build_masks(n):
    """返回 (inside, edge, glyph)，均为 n*n 字节。edge 为到边缘的像素距离。"""
    inside = bytearray(n * n)
    edge = bytearray(n * n)
    glyph = bytearray(n * n)
    k = 256.0 / n
    pad = SQUIRCLE_PAD * (n / 256.0)
    radius = n * 0.5 - pad
    power = SQUIRCLE_POWER
    for y in range(n):
        py = y + 0.5
        row = y * n
        ny = (py - n * 0.5) / radius
        ay = abs(ny)
        for x in range(n):
            px = x + 0.5
            nx = (px - n * 0.5) / radius
            p = abs(nx) ** power + ay ** power
            if p <= 1.0:
                i = row + x
                inside[i] = 1
                radial = 0.0 if p <= 0 else p ** (1.0 / power)
                dist = (1.0 - radial) * radius
                edge[i] = 255 if dist >= 255 else int(dist)
            if on_glyph(px * k, py * k):
                glyph[row + x] = 1
    return inside, edge, glyph


def render(n, palette, masks=None):
    if masks is None:
        masks = build_masks(n)
    inside, edge, glyph = masks
    pal = PALETTES[palette]
    buf = bytearray(n * n * 4)
    rim_w = 5.5 * (n / 256.0)
    sheen = pal['sheen']
    for y in range(n):
        row = y * n
        py = (y + 0.5) / n
        for x in range(n):
            i = row + x
            if not inside[i]:
                continue
            px = (x + 0.5) / n
            t = px * 0.38 + py * 0.62
            if t < 0.46:
                bg = mix(pal['c0'], pal['c1'], t / 0.46)
            else:
                bg = mix(pal['c1'], pal['c2'], (t - 0.46) / 0.54)
            r, g, b = bg
            if sheen:
                dx = px - 0.30
                dy = py - 0.18
                d = math.hypot(dx * 1.05, dy)
                hl = max(0.0, 1.0 - d / 0.62)
                hl = hl * hl * sheen
                if hl:
                    r = lerp(r, 255, hl)
                    g = lerp(g, 255, hl)
                    b = lerp(b, 255, hl)
            dist = edge[i]
            if dist < rim_w:
                amt = (1.0 - dist / rim_w) * pal['rim_amt']
                # 下半圈收一点，避免整圈发白
                amt *= 1.0 - py * 0.35
                r = lerp(r, pal['rim'][0], amt)
                g = lerp(g, pal['rim'][1], amt)
                b = lerp(b, pal['rim'][2], amt)
            if glyph[i]:
                r, g, b = pal['fg']
            o = i * 4
            buf[o] = r
            buf[o + 1] = g
            buf[o + 2] = b
            buf[o + 3] = 255
    return buf


def downsample(src, src_n, dst_n, factor):
    out = bytearray(dst_n * dst_n * 4)
    area = factor * factor
    for y in range(dst_n):
        for x in range(dst_n):
            ar = ag = ab = aa = 0
            for dy in range(factor):
                base = (y * factor + dy) * src_n * 4
                for dx in range(factor):
                    i = base + (x * factor + dx) * 4
                    a = src[i + 3]
                    ar += src[i] * a
                    ag += src[i + 1] * a
                    ab += src[i + 2] * a
                    aa += a
            o = (y * dst_n + x) * 4
            if aa == 0:
                continue
            out[o] = ar // aa
            out[o + 1] = ag // aa
            out[o + 2] = ab // aa
            out[o + 3] = aa // area
    return out


def png_encode(w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', comp) +
            chunk(b'IEND', b''))


def build_ico(images):
    count = len(images)
    header = struct.pack('<HHH', 0, 1, count)
    offset = 6 + 16 * count
    dirs = b''
    data = b''
    for size, png in images:
        dim = 0 if size >= 256 else size
        dirs += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        data += png
    return header + dirs + data


def master_and_pngs(palette, masks, sizes):
    big = render(N, palette, masks)
    master = downsample(big, N, S, SS)
    pngs = [(S, png_encode(S, S, master))]
    for size in sizes:
        if size == S:
            continue
        scale = S // size
        small = downsample(master, S, size, scale)
        pngs.append((size, png_encode(size, size, small)))
    return master, pngs


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as handle:
        handle.write(data)
    print('written', path, len(data), 'bytes')


def main():
    print('raster %dx%d ...' % (N, N))
    masks = build_masks(N)
    app_sizes = (128, 64, 48, 32, 24, 16)
    tray_sizes = (48, 32, 24, 16)

    _, brand_pngs = master_and_pngs('brand', masks, app_sizes)
    brand_ico = build_ico(brand_pngs)
    write_bytes(os.path.join(BASE, 'build', 'icon.ico'), brand_ico)
    write_bytes(os.path.join(BASE, 'public', 'icon.ico'), brand_ico)
    write_bytes(os.path.join(BASE, 'public', 'icon.png'), brand_pngs[0][1])

    for key, filename in (('light', 'icon-light'), ('dark', 'icon-dark')):
        _, pngs = master_and_pngs(key, masks, tray_sizes)
        write_bytes(os.path.join(BASE, 'public', filename + '.ico'), build_ico(pngs))
        write_bytes(os.path.join(BASE, 'public', filename + '.png'), pngs[0][1])

    brand_png = os.path.join(BASE, 'public', 'icon.png')
    brand_ico_path = os.path.join(BASE, 'build', 'icon.ico')
    copies = [
        os.path.join(ROOT, 'installer-web', 'pkg', 'WinEnvManager.ico'),
        os.path.join(ROOT, 'bootstrapper', 'src-tauri', 'icons', 'icon.ico'),
        os.path.join(ROOT, 'winenv-tauri', 'src-tauri', 'icons', 'icon.ico'),
    ]
    png_copies = [
        os.path.join(ROOT, 'bootstrapper', 'src-tauri', 'ui', 'icon.png'),
        os.path.join(ROOT, 'winenv-tauri', 'public', 'icon.png'),
    ]
    for dest in copies:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(brand_ico_path, dest)
        print('copied', dest)
    for dest in png_copies:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(brand_png, dest)
        print('copied', dest)

    # 已构建目录同步，未重新打包前本地运行也能看到新图标
    for folder, names in (
        (os.path.join(BASE, 'dist'), ('icon.ico', 'icon.png', 'icon-light.ico', 'icon-dark.ico', 'icon-light.png', 'icon-dark.png')),
        (os.path.join(ROOT, 'winenv-tauri', 'dist'), ('icon.png',)),
    ):
        if not os.path.isdir(folder):
            continue
        for name in names:
            src = os.path.join(BASE, 'public', name)
            if os.path.isfile(src):
                shutil.copyfile(src, os.path.join(folder, name))
                print('copied', os.path.join(folder, name))


if __name__ == '__main__':
    main()
