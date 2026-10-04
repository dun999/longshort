"""Pirate: tricorn with gold trim, eye patch and a black beard, long burgundy coat with gold buttons over a
white shirt, a sash in the player's colour with a pistol tucked in it, a baldric, tall cuffed boots and a
cutlass low in the right hand; left fist on the hip. Lounge prop: his treasure chest."""
import math
from lib import Kit, V
from parts import X, Y, Z, basis, boot, eyes, frame, hand, head, legs, limb, nose, rig, sym, torso_weights

J = sym(dict(
    hips=(0, 0, 0.97), spine=(0, 0, 1.08), chest=(0, -0.005, 1.22), upper=(0, 0, 1.36), neck=(0, 0, 1.5), head=(0, -0.005, 1.57), headtop=(0, -0.005, 1.84),
    clavL=(0.04, 0, 1.44), shoulderL=(0.21, 0.01, 1.43), elbowL=(0.35, 0.05, 1.2), wristL=(0.21, -0.01, 1.03), tipL=(0.18, -0.02, 0.97),
    shoulderR=(-0.21, 0.01, 1.43), elbowR=(-0.26, 0.05, 1.16), wristR=(-0.28, -0.08, 0.95), tipR=(-0.285, -0.12, 0.87),
    hipL=(0.1, -0.005, 0.94), kneeL=(0.14, -0.06, 0.52), ankleL=(0.16, -0.03, 0.12), toeL=(0.2, -0.18, 0.03),
    hipR=(-0.1, 0.01, 0.94), kneeR=(-0.12, 0.03, 0.52), ankleR=(-0.14, 0.07, 0.12), toeR=(-0.16, -0.08, 0.03),
))

C = dict(
    coat='#6e2128', coat_dk='#4a1519', gold='#c9a04a', shirt='#e3d8c0', trousers='#3d3530', boot='#3a271b', cuff='#5e3f28',
    sole='#1c1612', skin='#c69068', beard='#1f1712', hat='#1c1a1f', leather='#4b3020', steel='#cfd3d8', wood='#6b4528', eye='#120d0a',
)


def build():
    k = Kit('PirateBody')
    tw = torso_weights(J)

    # ── legs: dark breeches in tall cuffed boots ──
    legs(k, J, C['trousers'], knee_r=0.078, hip_r=0.102)
    for s in 'LR':
        boot(k, J['ankle' + s], J['toe' + s], C['boot'], C['sole'], 'Foot' + s, length=0.29, width=0.12, height=0.11)
        ank, knee = V(J['ankle' + s]), V(J['knee' + s])
        limb(k, ank + V((0, 0, -0.03)), ank.lerp(knee, 0.78), (0.07, 0.074), (0.083, 0.087), C['boot'], 'Leg' + s, jitter=0.003)
        limb(k, ank.lerp(knee, 0.7), ank.lerp(knee, 0.92), (0.092, 0.096), (0.098, 0.102), C['cuff'], 'Leg' + s, jitter=0.004)

    # ── long coat: skirt to the knee (open down the front), body, lapels, buttons ──
    k.add(*k.loft([(V((0, 0.0, 0.98)), 0.19, 0.135), (V((0, 0.005, 0.76)), 0.235, 0.17), (V((0, 0.012, 0.53)), 0.275, 0.205)], n=12, sq=2.8), C['coat'], 'Hips', jitter=0.005)
    k.add(*k.loft([(V((0, -0.137, 0.97)), 0.034, 0.006), (V((0, -0.168, 0.75)), 0.04, 0.006), (V((0, -0.196, 0.535)), 0.046, 0.006)], n=4, sq=2, side=X), C['trousers'], 'Hips')
    k.add(*k.loft([
        (V((0, 0.0, 0.95)), 0.182, 0.13), (V((0, -0.004, 1.2)), 0.195, 0.135), (V((0, 0.0, 1.35)), 0.205, 0.135),
        (V((0, 0.0, 1.44)), 0.18, 0.12), (V((0, 0.0, 1.5)), 0.08, 0.072),
    ], n=10, sq=3.2), C['coat'], 'Spine', weights=tw, jitter=0.003)
    k.add(*k.box((0, -0.133, 1.34), (0.1, 0.014, 0.17), chamfer=0.004, taper=(1.3, 1)), C['shirt'], 'Spine1', weights=tw)
    for sx in (1, -1):
        k.add(*k.box((sx * 0.075, -0.135, 1.3), (0.06, 0.016, 0.26), chamfer=0.004, M=frame(V((sx * 0.35, 0, 1)), V((0, -1, 0)))), C['coat_dk'], 'Spine1', weights=tw)
        for z in (1.0, 1.08, 1.16, 1.24):
            k.add(*k.box((sx * 0.06, -0.137, z), (0.022, 0.012, 0.022), chamfer=0.005), C['gold'], 'Spine', weights=tw)
    # sash in the player's colour, knotted on the left hip with hanging ends; pistol tucked in
    k.add(*k.loft([(V((0, 0, 0.94)), 0.196, 0.142), (V((0, 0, 1.02)), 0.19, 0.138)], n=12, sq=3), '#ffffff', 'Hips', mat='Accent', jitter=0.004)
    k.add(*k.box((0.17, -0.09, 0.97), (0.07, 0.05, 0.07), chamfer=0.015), '#ffffff', 'Hips', mat='Accent')
    for dx, ln in ((0.0, 0.22), (0.035, 0.17)):
        k.add(*k.loft([(V((0.19 + dx, -0.08, 0.95)), 0.03, 0.008), (V((0.21 + dx, -0.07, 0.95 - ln)), 0.025, 0.008)], n=4, sq=2, side=Y), '#ffffff', 'Hips', mat='Accent', jitter=0.004)
    k.add(*k.box((-0.07, -0.15, 1.0), (0.04, 0.03, 0.15), chamfer=0.008, M=frame(V((0.5, 0, 1)), V((0, -1, 0)))), C['wood'], 'Hips')
    k.add(*k.loft([(V((-0.03, -0.155, 1.06)), 0.012, 0.012), (V((0.06, -0.16, 1.1)), 0.012, 0.012)], n=6, sq=2), C['steel'], 'Hips')
    # baldric: right shoulder to left hip
    for sgn in (-1, 1):
        y0 = 0.142 * sgn
        k.add(*k.loft([(V((-0.14, y0 * 0.85, 1.44)), 0.007, 0.03), (V((-0.02, y0 * 1.03, 1.26)), 0.007, 0.03), (V((0.12, y0 * 1.02, 1.06)), 0.007, 0.03), (V((0.19, y0 * 0.95, 0.94)), 0.007, 0.03)], n=4, sq=2, side=Y), C['leather'], 'Spine', weights=tw)
    k.add(*k.box((-0.01, -0.16, 1.24), (0.045, 0.012, 0.045), chamfer=0.006), C['gold'], 'Spine1', weights=tw)

    # ── arms: coat sleeves with big gold-trimmed cuffs ──
    for s in 'LR':
        sh, el, wr, tip = (V(J[n + s]) for n in ('shoulder', 'elbow', 'wrist', 'tip'))
        k.add(*k.dome(sh, 0.078, 0.082, 0.06, n=8, rings=3), C['coat'], 'Arm' + s)
        limb(k, sh, el, (0.066, 0.068), (0.058, 0.06), C['coat'], 'Arm' + s, jitter=0.002)
        limb(k, el, wr, (0.056, 0.058), (0.05, 0.052), C['coat'], 'ForeArm' + s)
        limb(k, el.lerp(wr, 0.66), el.lerp(wr, 0.98), (0.07, 0.074), (0.074, 0.078), C['coat_dk'], 'ForeArm' + s)
        limb(k, el.lerp(wr, 0.97), el.lerp(wr, 1.0), (0.078, 0.082), (0.078, 0.082), C['gold'], 'ForeArm' + s)
    dL = (V(J['tipL']) - V(J['wristL'])).normalized()
    hand(k, J['wristL'], dL, V((0.3, 0.6, 0.2)), C['skin'], 'HandL', size=1.08)
    dR = (V(J['tipR']) - V(J['wristR'])).normalized()
    blade_dir = V((0.04, -0.85, -0.5)).normalized()
    palmR = dR.cross(blade_dir).normalized()
    hand(k, J['wristR'], dR, palmR, C['skin'], 'HandR', size=1.08)
    # cutlass: gold knuckle guard, curved blade
    cR = V(J['wristR']) + dR * 0.05
    side = palmR.cross(blade_dir).normalized()
    k.add(*k.loft([(cR - blade_dir * 0.07, 0.019, 0.019), (cR + blade_dir * 0.06, 0.018, 0.018)], n=6, sq=2), C['leather'], 'HandR')
    k.add(*k.loft([(cR - blade_dir * 0.075 + side * 0.0, 0.01, 0.012), (cR - blade_dir * 0.02 + side * 0.06, 0.01, 0.012), (cR + blade_dir * 0.06 + side * 0.055, 0.01, 0.012), (cR + blade_dir * 0.075, 0.012, 0.012)], n=4, sq=2, side=palmR), C['gold'], 'HandR')
    g = cR + blade_dir * 0.075
    curve = lambda t: g + blade_dir * (0.62 * t) + side * (0.07 * t * t)
    blade = [(curve(0.0), 0.022, 0.006), (curve(0.4), 0.03, 0.006), (curve(0.8), 0.028, 0.005), (curve(1.0), 0.004, 0.003)]
    k.add(*k.loft(blade, n=4, sq=2, side=side), C['steel'], 'HandR')

    # ── head: patch over the left eye, black beard, long hair under a tricorn ──
    front = head(k, 1.565, 1.82, C['skin'])
    eyes(k, 1.692, front, C['eye'], C['beard'], skip=1)
    k.add(*k.box((0.046, front - 0.006, 1.692), (0.05, 0.012, 0.042), chamfer=0.006), C['hat'], 'Head')
    k.add(*k.loft([(V((0.1, -0.06, 1.75)), 0.006, 0.01), (V((0.0, -0.112, 1.74)), 0.006, 0.01), (V((-0.106, -0.05, 1.71)), 0.006, 0.01)], n=4, sq=2, side=Z), C['hat'], 'Head')
    nose(k, 1.655, front, C['skin'], size=1.15)
    k.add(*k.loft([(V((0, -0.095, 1.52)), 0.06, 0.03), (V((0, -0.118, 1.57)), 0.102, 0.034), (V((0, -0.114, 1.64)), 0.108, 0.03)], n=6, sq=3, side=X), C['beard'], 'Head', jitter=0.007)
    k.add(*k.box((0, front - 0.012, 1.627), (0.09, 0.02, 0.022), chamfer=0.006, taper=(0.8, 1)), C['beard'], 'Head')
    k.add(*k.loft([(V((0, 0.08, 1.76)), 0.1, 0.05), (V((0, 0.115, 1.66)), 0.07, 0.035)], n=8, sq=2.6, side=X), C['beard'], 'Head', jitter=0.005)
    k.add(*k.loft([(V((0, 0.12, 1.665)), 0.035, 0.03), (V((0, 0.135, 1.56)), 0.03, 0.026), (V((0, 0.13, 1.48)), 0.012, 0.012)], n=6, sq=2.2, side=X), C['beard'], 'Head', jitter=0.004)
    # tricorn: brim with three points and upturned edges between them, crown, gold trim
    def ring(r0, dr, z0, dz, n=18, ph=-math.pi / 2):
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            c3 = math.cos(3 * (a - ph))
            r = r0 + dr * (c3 * 0.5 + 0.5)
            pts.append(V((math.cos(a) * r, math.sin(a) * r * 0.95 - 0.005, z0 + dz * (1 - (c3 * 0.5 + 0.5)))))
        return pts
    inner, outer = ring(0.125, 0.0, 1.785, 0.0), ring(0.19, 0.075, 1.775, 0.085)
    n = len(inner)
    verts = inner + outer + [p + V((0, 0, -0.018)) for p in outer] + [p + V((0, 0, -0.018)) for p in inner]
    faces = [[i, n + i, n + (i + 1) % n, (i + 1) % n] for i in range(n)]
    faces += [[n + i, 2 * n + i, 2 * n + (i + 1) % n, n + (i + 1) % n] for i in range(n)]
    faces += [[2 * n + i, 3 * n + i, 3 * n + (i + 1) % n, 2 * n + (i + 1) % n] for i in range(n)]
    k.add(verts, [list(reversed(f)) for f in faces], C['hat'], 'Head', jitter=0.003)
    trim = outer + [p + V((0, 0, 0.012)) for p in outer]
    k.add(trim, [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], C['gold'], 'Head')
    k.add(*k.loft([(V((0, 0.0, 1.775)), 0.122, 0.128), (V((0, 0.0, 1.86)), 0.112, 0.116), (V((0, 0.005, 1.905)), 0.08, 0.085)], n=10, sq=2.4, dome=(0, 0.015)), C['hat'], 'Head', jitter=0.004)

    arm = rig('Pirate', J)
    body = k.build(arm)

    # lounge prop: an iron-banded treasure chest brimming with gold, in front of his right foot
    p = Kit('PirateProp')
    cx, cy = -0.17, -0.42
    p.add(*p.box((cx, cy, 0.15), (0.52, 0.34, 0.3), chamfer=0.02), '#7a4a26', 'Prop', jitter=0.004)
    p.add(*p.box((cx, cy - 0.005, 0.36), (0.5, 0.3, 0.1), chamfer=0.04, taper=(0.86, 0.8)), '#8a5a2e', 'Prop', jitter=0.004)
    for x in (-0.18, 0.0, 0.18):
        p.add(*p.box((cx + x, cy, 0.2), (0.04, 0.36, 0.36), chamfer=0.006), '#3a3836', 'Prop')
    p.add(*p.box((cx, cy - 0.175, 0.24), (0.07, 0.02, 0.09), chamfer=0.008), C['gold'], 'Prop')
    for i, (dx, dy, r) in enumerate(((0.12, 0.05, 0.06), (-0.1, 0.02, 0.05), (0.02, -0.06, 0.055), (-0.02, 0.08, 0.045))):
        p.add(*p.dome((cx + dx, cy + dy, 0.4), r, r * 0.9, r * 0.5, n=8, rings=2), '#e3b54a', 'Prop', jitter=0.004, seed=i)
    for i, (x, y) in enumerate(((cx + 0.33, cy - 0.12), (cx - 0.3, cy - 0.2), (cx + 0.2, cy - 0.28))):
        p.add(*p.disc((x, y, 0.006), 0.026, 0.012, n=8), '#e3b54a', 'Prop')
    p.add(*p.box((cx - 0.05, cy + 0.0, 0.43), (0.05, 0.05, 0.05), chamfer=0.01), '#d23a4a', 'Prop')
    return arm, body, [p.build()]
