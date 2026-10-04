"""Keone: plain black tee, dark jeans, white trainers, hands in his pockets, and a purple six-panel Monad cap:
panel seams, eyelets, a top button, a pre-curved bill with a stitch band, the back strap, and the Monad mark
(a rounded diamond with a tilted rounded-square opening) in white on the front panel. A conference lanyard
carries the player's colour."""
import math
from lib import Kit, V
from parts import X, Y, Z, bare_arms, basis, eyes, frame, hand, head, legs, limb, nose, rig, sneaker, sym, tee, torso_weights

J = sym(dict(
    hips=(0, 0, 0.96), spine=(0, 0, 1.07), chest=(0, -0.005, 1.21), upper=(0, 0, 1.34), neck=(0, 0, 1.48), head=(0, -0.005, 1.555), headtop=(0, -0.005, 1.81),
    clavL=(0.04, 0, 1.43), shoulderL=(0.2, 0.01, 1.42), elbowL=(0.255, 0.07, 1.14), wristL=(0.18, -0.045, 0.94), tipL=(0.17, -0.06, 0.87),
    hipL=(0.095, -0.005, 0.93), kneeL=(0.11, -0.04, 0.51), ankleL=(0.12, -0.01, 0.1), toeL=(0.15, -0.17, 0.03),
    hipR=(-0.095, 0.005, 0.93), kneeR=(-0.105, 0.02, 0.51), ankleR=(-0.115, 0.05, 0.1), toeR=(-0.13, -0.11, 0.03),
))
C = dict(skin='#d9a985', hair='#141214', tee='#1b1b1f', jeans='#2b3445', shoe='#e9e7e2', sole='#f6f4ef', cap='#7a63f5', cap_dk='#5b46d6', seam='#5640c9', stitch='#a898ff', under='#2a2353', eyelet='#3b2c95', mark='#fbfaff', eye='#141012', strap='#2d2d33')


def build():
    k = Kit('KeoneBody')
    tw = torso_weights(J)
    legs(k, J, C['jeans'], knee_r=0.074, hip_r=0.1, ankle_r=0.058)
    for s in 'LR':
        sneaker(k, J['ankle' + s], J['toe' + s], C['shoe'], C['sole'], 'Foot' + s, stripe=True)
    tee(k, J, C['tee'], tw, hem=0.93)
    bare_arms(k, J, C['skin'])
    for s in 'LR':
        sx = 1 if s == 'L' else -1
        d = (V(J['tip' + s]) - V(J['wrist' + s])).normalized()
        hand(k, J['wrist' + s], d, V((-sx, 0.3, 0)), C['skin'], 'Hand' + s, size=1.0)
        # pocket mouths the hands disappear into
        k.add(*k.box((sx * 0.155, -0.075, 0.88), (0.075, 0.03, 0.012), chamfer=0.004, M=frame(Z, V((sx * 0.4, -1, 0)))), '#1d2533', 'Hips')
    # lanyard and badge (player colour)
    for sx in (1, -1):
        k.add(*k.loft([(V((sx * 0.06, -0.06, 1.47)), 0.008, 0.004), (V((sx * 0.055, -0.13, 1.4)), 0.008, 0.004), (V((sx * 0.012, -0.138, 1.27)), 0.008, 0.004)], n=4, sq=2, side=Y), C['strap'], 'Spine1', weights=tw)
    k.add(*k.box((0, -0.142, 1.22), (0.07, 0.008, 0.095), chamfer=0.006), '#ffffff', 'Spine1', mat='Accent', weights=tw)
    # head, short black hair, cap with the mark
    front = head(k, 1.55, 1.8, C['skin'])
    eyes(k, 1.675, front, C['eye'], C['hair'])
    nose(k, 1.64, front, C['skin'])
    k.add(*k.box((0, front - 0.004, 1.6), (0.05, 0.012, 0.01), chamfer=0.003), '#8a5a48', 'Head')
    k.add(*k.loft([(V((0, 0.02, 1.62)), 0.112, 0.105), (V((0, 0.03, 1.74)), 0.116, 0.112)], n=10, sq=3), C['hair'], 'Head', jitter=0.004)
    cap(k)
    arm = rig('Keone', J)
    return arm, k.build(arm)


# ─── the cap ────────────────────────────────────────────────────────────────
SQ = 2.6  # crown cross-section: a rounded square, flat front panel between the vertices at 255° and 285°
CROWN = [(1.735, 0.128, 0.132), (1.80, 0.125, 0.128), (1.848, 0.105, 0.109), (1.879, 0.066, 0.07)]  # z, rx, ry (clears the boxy head's corners)
N = 12


def sup(a, rx, ry):
    ca, sa = math.cos(a), math.sin(a)
    return math.copysign(abs(ca) ** (2 / SQ), ca) * rx, math.copysign(abs(sa) ** (2 / SQ), sa) * ry


def crown(i, deg):
    """A vertex of crown ring i (the loft's own parametrisation: 270 deg = front centre)."""
    z, rx, ry = CROWN[i]
    x, y = sup(math.radians(deg), rx, ry)
    return V((x, y, z))


def orient(verts, faces, want):
    """Flip each face so its normal agrees with want(centre)."""
    out = []
    for f in faces:
        ps = [verts[i] for i in f]
        n = V((0, 0, 0))
        for a, b in zip(ps, ps[1:] + ps[:1]):
            n += a.cross(b)
        c = sum(ps, V((0, 0, 0))) / len(ps)
        out.append(f if n.dot(want(c)) >= 0 else list(reversed(f)))
    return verts, out


def facet(i, a0, a1):
    """Flat crown facet between rings i and i+1 and vertex angles a0 to a1: (point at height z, right, up, out)."""
    p00, p01, p10, p11 = crown(i, a0), crown(i, a1), crown(i + 1, a0), crown(i + 1, a1)
    m0, m1 = (p00 + p01) / 2, (p10 + p11) / 2
    right = (p01 - p00).normalized()
    up = (m1 - m0).normalized()
    out = right.cross(up)
    if out.dot(V((m0.x, m0.y, 0))) < 0:
        out = -out
    at = lambda z: m0 + (m1 - m0) * ((z - m0.z) / (m1.z - m0.z))
    return at, right, up, out


def monad_mark(k, c, right, up, out, size, color):
    """The Monad mark as a thin raised plate: a rounded diamond (superellipse p 1.4) with a rounded-square
    opening (p 4.6, 0.48 of the radius) turned 30 degrees."""
    n, rot = 40, math.radians(29.6)
    ring = []
    for j in range(n):
        th = 2 * math.pi * j / n
        ro = (abs(math.cos(th)) ** 1.4 + abs(math.sin(th)) ** 1.4) ** (-1 / 1.4)
        ring.append((math.cos(th) * ro, math.sin(th) * ro))
    for j in range(n):
        th = 2 * math.pi * j / n
        ri = 0.478 * (abs(math.cos(th - rot)) ** 4.6 + abs(math.sin(th - rot)) ** 4.6) ** (-1 / 4.6)
        ring.append((math.cos(th) * ri, math.sin(th) * ri))
    verts = [c + right * u * size + up * v * size + out * off for off in (0.0042, 0.0006) for u, v in ring]
    faces, kind = [], []
    for j in range(n):
        j1 = (j + 1) % n
        faces += [[j, j1, n + j1, n + j], [2 * n + j, 2 * n + j1, 3 * n + j1, 3 * n + j], [j, j1, 2 * n + j1, 2 * n + j], [n + j, n + j1, 3 * n + j1, 3 * n + j]]
    centre = c + out * 0.0024

    def want(p):
        d = p - centre
        h = d.dot(out)
        if abs(h) > 0.0016:
            return out if h > 0 else -out  # front / back
        r = d - out * h
        return r if r.length > 0.62 * size else -r  # outer wall faces out, the opening's wall faces in
    k.add(*orient(verts, faces, want), color, 'Head')


def bill(k):
    """Pre-curved bill: D-shaped, the sides bending down, a stitch band near the edge, dark underside."""
    z, rx, ry = CROWN[0]
    span, m = math.radians(72), 16
    rows = [0, 0.42, 0.74, 0.81, 0.87, 1.0]
    tones = [C['cap'], C['cap'], C['cap'], C['stitch'], C['cap']]
    th = 0.009
    grid = []
    for t in rows:
        line = []
        for i in range(m + 1):
            phi = -span + 2 * span * i / m
            x, y = sup(1.5 * math.pi + phi, rx, ry)
            d = (V((x, y, 0)).normalized() + V((0, -0.6, 0))).normalized()
            reach = 0.122 * math.cos(phi) ** 0.9 + 0.004
            line.append(V((x, y, z + 0.004)) + d * reach * t + V((0, 0, -0.014 * t - 0.032 * math.sin(phi) ** 2 * t ** 1.3)))
        grid.append(line)
    up, down = (lambda p: V((0, 0.25, 1))), (lambda p: V((0, -0.25, -1)))
    for r, tone in enumerate(tones):
        verts = grid[r] + grid[r + 1]
        faces = [[i, i + 1, m + 2 + i, m + 1 + i] for i in range(m)]
        k.add(*orient(verts, faces, up), tone, 'Head')
    low = [[p - V((0, 0, th)) for p in line] for line in grid]
    verts = [p for line in low for p in line]
    w = m + 1
    faces = [[r * w + i, r * w + i + 1, (r + 1) * w + i + 1, (r + 1) * w + i] for r in range(len(rows) - 1) for i in range(m)]
    k.add(*orient(verts, faces, down), C['under'], 'Head')
    # the edge all round the front, and the two side ends
    edge = grid[-1] + low[-1]
    faces = [[i, i + 1, w + i + 1, w + i] for i in range(m)]
    k.add(*orient(edge, faces, lambda p: V((p.x, p.y, 0))), C['cap'], 'Head')
    for i, sx in ((0, -1), (m, 1)):
        side = [line[i] for line in grid] + [line[i] for line in low]
        n = len(rows)
        faces = [[r, r + 1, n + r + 1, n + r] for r in range(n - 1)]
        k.add(*orient(side, faces, lambda p, sx=sx: V((sx, 0, 0))), C['cap'], 'Head')


def cap(k):
    k.add(*k.loft([(V((0, 0, z)), rx, ry) for z, rx, ry in CROWN], n=N, sq=SQ, dome=(0, 0.012)), C['cap'], 'Head')
    top = V((0, 0, CROWN[-1][0] + 0.012))
    # six panels: seams along the vertex lines (the two front ones frame the logo panel), meeting at the button
    for deg in (255, 285, 195, 345, 135, 45):
        pts = [crown(i, deg) for i in range(len(CROWN))]
        path = [(p + V((p.x, p.y, 0)).normalized() * 0.0016, 0.0024, 0.0016) for p in pts] + [(top + V((0, 0, 0.001)), 0.002, 0.0014)]
        k.add(*k.loft(path, n=4, sq=2, side=V((math.cos(math.radians(deg + 90)), math.sin(math.radians(deg + 90)), 0))), C['seam'], 'Head')
    k.add(*k.dome(top - V((0, 0, 0.002)), 0.017, 0.017, 0.01, n=8, rings=2), C['seam'], 'Head')
    # eyelets on the side-front panels
    for a0, a1 in ((225, 255), (285, 315)):
        at, right, up, out = facet(1, a0, a1)
        p = at(1.826) + out * 0.0012
        k.add(*k.disc(p, 0.0062, 0.0022, n=8, M=frame(out)), C['eyelet'], 'Head')
    # the mark on the flat front panel
    at, right, up, out = facet(0, 255, 285)
    monad_mark(k, at(1.772), right, up, out, 0.03, C['mark'])
    bill(k)
    # back: the strap opening above the neck, a strap across it and a small buckle
    at, right, up, out = facet(0, 75, 105)
    base = at(CROWN[0][0]) + out * 0.0009
    arch = [(-0.034, 0.0), (0.034, 0.0)] + [(math.cos(a) * 0.034, 0.012 + math.sin(a) * 0.026) for a in [i * math.pi / 8 for i in range(9)]]
    verts = [base + right * u + up * v for u, v in arch[1:]] + [base + up * 0.012]
    c = len(verts) - 1
    faces = [[i, i + 1, c] for i in range(len(verts) - 2)] + [[len(verts) - 2, 0, c]]
    k.add(*orient(verts, faces, lambda p: out), C['hair'], 'Head')
    k.add(*k.box(base + up * 0.011 + out * 0.0018, (0.078, 0.0036, 0.0105), chamfer=0.0012, M=basis(right, out, up)), C['cap_dk'], 'Head')
    k.add(*k.box(base + up * 0.011 + right * 0.014 + out * 0.0038, (0.012, 0.003, 0.013), chamfer=0.001, M=basis(right, out, up)), '#c9c8d2', 'Head')
