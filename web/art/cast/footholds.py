"""Per-class footholds. Each is built with its top surface at z = 0 and its base at z = -H (the game lifts
the group by H). Tank: a stone plinth with a bronze band. Sniper: a cut jungle stump on its roots, moss and
ferns. Scout: a layered sandstone outcrop with a cairn and a pennant in the player's colour."""
import math
import random
from lib import Kit, V
from parts import Z, basis, frame

H = 0.3


def _poly(k, z0, z1, r0, r1, n, color, seed, wob=0.06, sq=2.0, jitter=0.01, bone='Base'):
    """Irregular n-gon slab between z0 and z1 (radius r0 at the bottom, r1 at the top)."""
    rnd = random.Random(seed)
    ks = [1 + rnd.uniform(-wob, wob) for _ in range(n)]
    verts = []
    for z, r in ((z0, r0), (z1, r1)):
        for i in range(n):
            a = 2 * math.pi * i / n + seed
            verts.append(V((math.cos(a) * r * ks[i], math.sin(a) * r * ks[i], z)))
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)] + [list(reversed(range(n))), [n + i for i in range(n)]]
    k.add(verts, faces, color, bone, jitter=jitter, seed=seed)


def tank(k):
    stone, dark, hi, bronze = '#86817a', '#625e58', '#a29c92', '#a47b3c'
    rnd = random.Random(2)
    # eight chunky drum blocks with gaps, a darker plinth course below
    _poly(k, -H, -H + 0.08, 0.8, 0.78, 8, dark, 1, wob=0.0, jitter=0.006)
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        c = V((math.cos(a) * 0.52, math.sin(a) * 0.52, -H + 0.08 + 0.095))
        tang = V((-math.sin(a), math.cos(a), 0))
        k.add(*k.box(c, (0.39, 0.38, 0.19 + rnd.uniform(-0.01, 0.01)), chamfer=0.025, M=basis(tang, V((math.cos(a), math.sin(a), 0)), Z), taper=(0.97, 0.95)), stone if i % 2 else hi, 'Base', jitter=0.007, seed=i)
    _poly(k, -H + 0.27, -0.02, 0.69, 0.68, 8, bronze, 3, wob=0.0, jitter=0.0)
    # top slabs: a centre stone ringed by four
    _poly(k, -0.05, 0.0, 0.3, 0.29, 8, hi, 4, wob=0.04, jitter=0.004)
    for i in range(4):
        a = 2 * math.pi * i / 4 + math.pi / 4
        c = V((math.cos(a) * 0.48, math.sin(a) * 0.48, -0.025))
        k.add(*k.box(c, (0.42, 0.3, 0.05), chamfer=0.012, M=basis(V((-math.sin(a), math.cos(a), 0)), V((math.cos(a), math.sin(a), 0)), Z)), stone, 'Base', jitter=0.004, seed=10 + i)
    # fallen chips at the foot
    for i, a in enumerate((0.6, 2.4, 4.1)):
        k.add(*k.box((math.cos(a) * 0.86, math.sin(a) * 0.86, -H + 0.04), (0.1, 0.08, 0.07), chamfer=0.02, M=frame(V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 1)), V((1, 0, 0)))), dark, 'Base', jitter=0.01, seed=20 + i)


def sniper(k):
    bark, bark_dk, wood, ring, moss, moss2 = '#5a3c27', '#432c1d', '#b08756', '#8f6b42', '#4f7230', '#3d5c25'
    ferns = ['#4f7a33', '#3c6027', '#6a8a39']
    rnd = random.Random(5)
    # trunk: flared at the ground, bark ridges from jitter
    _poly(k, -H, -0.18, 0.56, 0.47, 14, bark_dk, 1, wob=0.08, jitter=0.012)
    _poly(k, -0.18, -0.03, 0.47, 0.44, 14, bark, 2, wob=0.07, jitter=0.012)
    _poly(k, -0.03, 0.0, 0.44, 0.42, 14, wood, 3, wob=0.05, jitter=0.0)
    _poly(k, 0.0, 0.004, 0.3, 0.3, 12, ring, 4, wob=0.05, jitter=0.0)
    _poly(k, 0.004, 0.008, 0.16, 0.16, 10, wood, 5, wob=0.05, jitter=0.0)
    # roots
    for i in range(6):
        a = 2 * math.pi * i / 6 + rnd.uniform(-0.3, 0.3)
        d = V((math.cos(a), math.sin(a), 0))
        path = [(d * 0.42 + V((0, 0, -0.12)), 0.08, 0.06), (d * 0.62 + V((0, 0, -0.24)), 0.055, 0.04), (d * 0.8 + V((0, 0, -H + 0.01)), 0.02, 0.015)]
        k.add(*k.loft(path, n=6, sq=2.5, side=Z), bark_dk, 'Base', jitter=0.01, seed=i)
    # moss over the rim and down one side
    for i in range(7):
        a = 2.2 + i * 0.32
        k.add(*k.box((math.cos(a) * 0.42, math.sin(a) * 0.42, -0.02 - (i % 3) * 0.04), (0.14, 0.05, 0.08), chamfer=0.02, M=basis(V((-math.sin(a), math.cos(a), 0)), V((math.cos(a), math.sin(a), 0)), Z)), moss if i % 2 else moss2, 'Base', jitter=0.01, seed=30 + i)
    # fern fronds at the foot
    for i in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        base = V((math.cos(a) * 0.55, math.sin(a) * 0.55, -H))
        out = V((math.cos(a), math.sin(a), 0))
        tip = base + out * 0.22 + V((0, 0, 0.2 + rnd.uniform(0, 0.08)))
        mid = base.lerp(tip, 0.5) + V((0, 0, 0.06))
        k.add(*k.loft([(base, 0.012, 0.003), (mid, 0.045, 0.004), (tip, 0.004, 0.003)], n=4, sq=2, side=V((-out.y, out.x, 0))), ferns[i % 3], 'Base', seed=40 + i)
    # a cluster of mushrooms on a root
    for i, (x, y, h, r) in enumerate(((0.58, -0.36, 0.07, 0.035), (0.63, -0.3, 0.05, 0.026))):
        k.add(*k.disc((x, y, -H + h / 2), 0.01, h, n=6), '#d9ceb4', 'Base')
        k.add(*k.dome((x, y, -H + h), r, r, r * 0.6, n=8, rings=2), '#b5532e', 'Base')


def scout(k):
    sand, rust, pale, dark = '#c39a62', '#a6683e', '#d9bb8b', '#7c5232'
    rnd = random.Random(9)
    _poly(k, -H, -0.2, 0.74, 0.7, 9, rust, 1, wob=0.1, jitter=0.012)
    _poly(k, -0.2, -0.12, 0.66, 0.6, 9, sand, 2, wob=0.1, jitter=0.012)
    _poly(k, -0.12, -0.05, 0.6, 0.55, 8, pale, 3, wob=0.09, jitter=0.01)
    _poly(k, -0.05, 0.0, 0.52, 0.5, 8, sand, 4, wob=0.08, jitter=0.004)
    # a broken shelf jutting out front-left
    k.add(*k.box((0.42, -0.42, -0.2), (0.34, 0.26, 0.12), chamfer=0.03, M=frame(V((0.1, 0.05, 1)), V((1, 0.6, 0)))), rust, 'Base', jitter=0.012, seed=5)
    # cairn at the back-left
    for i, (z, r) in enumerate(((0.035, 0.085), (0.1, 0.065), (0.15, 0.045))):
        k.add(*k.box((0.3, 0.26, z), (r * 2, r * 1.7, r * 0.95), chamfer=r * 0.35, M=frame(V((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 1)), V((1, rnd.uniform(-1, 1), 0)))), pale if i % 2 else dark, 'Base', jitter=0.006, seed=50 + i)
    # pennant on a pole at the back-right, flag in the player's colour
    pole = V((-0.36, 0.28, 0.0))
    k.add(*k.disc(pole + V((0, 0, 0.42)), 0.012, 0.84, n=6), '#5b4632', 'Base')
    k.add(*k.dome(pole + V((0, 0, 0.84)), 0.022, 0.022, 0.03, n=6, rings=2), '#b8904c', 'Base')
    flag = [V((0, 0, 0.8)), V((0, 0, 0.6)), V((-0.33, 0.06, 0.73)), V((-0.33, 0.06, 0.69))]
    fv = [pole + V((0.0, 0.0, 0.0)) + p for p in flag]
    k.add(fv + [v + V((0, 0.008, 0)) for v in fv], [[0, 2, 3, 1], [4, 5, 7, 6], [0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3]], '#ffffff', 'Base', mat='Accent', jitter=0.004)
    # dry grass tufts
    for i in range(10):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.6, 0.78)
        base = V((math.cos(a) * r, math.sin(a) * r, -H))
        for j in range(3):
            tip = base + V((rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), rnd.uniform(0.1, 0.17)))
            k.add(*k.loft([(base, 0.008, 0.002), (tip, 0.001, 0.001)], n=3, sq=2, side=V((1, 0, 0))), '#c9b26a' if j % 2 else '#a8914f', 'Base', seed=60 + i * 3 + j)


def make(name):
    k = Kit(name.capitalize() + 'Base')
    {'tank': tank, 'sniper': sniper, 'scout': scout}[name](k)
    return k.build()
