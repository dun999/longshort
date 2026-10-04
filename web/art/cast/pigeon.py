"""Pigeon: a chubby city pigeon about as tall as a child, standing up to fight. Grey egg body, iridescent
green and purple neck, orange side eyes, a dark beak with a pale cere, barred folded wings (the arm bones),
pink legs, and a little bandana in the player's colour. Lounge prop: bread on a fruit crate, and crumbs."""
from lib import Kit, V, camo
from parts import X, Y, Z, frame, limb, rig, sym

S = 1.25  # a pigeon about chest-high to the others: big enough to read in the arena
J0 = sym(dict(
    hips=(0, 0.06, 0.55), spine=(0, -0.02, 0.62), chest=(0, -0.1, 0.7), upper=(0, -0.16, 0.8), neck=(0, -0.19, 0.88), head=(0, -0.22, 1.0), headtop=(0, -0.24, 1.14),
    clavL=(0.06, -0.1, 0.78), shoulderL=(0.17, -0.09, 0.76), elbowL=(0.2, 0.07, 0.7), wristL=(0.19, 0.23, 0.62), tipL=(0.16, 0.37, 0.55),
    hipL=(0.075, 0.02, 0.42), kneeL=(0.085, 0.0, 0.3), ankleL=(0.085, -0.01, 0.07), toeL=(0.09, -0.15, 0.02),
))
J = {n: tuple(c * S for c in p) for n, p in J0.items()}

C = dict(body='#8d929c', belly='#a3a7b0', wing='#b2b6be', bar='#4d5059', tip='#5c6069', tail='#5a5e67', band='#2c2e33',
         head='#7d8592', beak='#2f2a28', cere='#e8e2d8', eye='#e07a2a', pupil='#141012', leg='#c9787a')
NECK = camo(['#3f7a5c', '#5a4f8a', '#4c6f6a', '#6a4f8a'], scale=26, seed=2)


def build():
    k = Kit('PigeonBody')
    # body: an egg tilted up toward the chest, tail low at the back
    k.add(*k.loft([
        (V((0, 0.34, 0.52)), 0.1, 0.07), (V((0, 0.2, 0.54)), 0.2, 0.17), (V((0, 0.04, 0.585)), 0.25, 0.235),
        (V((0, -0.1, 0.665)), 0.23, 0.235), (V((0, -0.17, 0.77)), 0.16, 0.165), (V((0, -0.19, 0.84)), 0.11, 0.11),
    ], n=12, sq=2.3, side=X, dome=(0.02, 0)), C['body'], 'Hips', jitter=0.006)
    k.add(*k.loft([(V((0, -0.05, 0.46)), 0.16, 0.1), (V((0, -0.17, 0.6)), 0.15, 0.1)], n=8, sq=2.2, side=X), C['belly'], 'Hips', jitter=0.004)
    # neck (iridescent) and head
    k.add(*k.loft([(V((0, -0.155, 0.76)), 0.135, 0.13), (V((0, -0.2, 0.88)), 0.1, 0.1), (V((0, -0.215, 0.97)), 0.084, 0.086)], n=10, sq=2.4, side=X), NECK, 'Neck', jitter=0.004)
    k.add(*k.loft([(V((0, -0.215, 0.965)), 0.078, 0.084), (V((0, -0.228, 1.04)), 0.09, 0.096), (V((0, -0.236, 1.11)), 0.066, 0.072)], n=10, sq=2.6, dome=(0, 0.02)), C['head'], 'Head', jitter=0.003)
    k.add(*k.loft([(V((0, -0.31, 1.035)), 0.022, 0.018), (V((0, -0.385, 1.025)), 0.004, 0.004)], n=6, sq=2, side=X, cap=(True, True)), C['beak'], 'Head')
    k.add(*k.box((0, -0.312, 1.052), (0.034, 0.03, 0.018), chamfer=0.006), C['cere'], 'Head')
    for sx in (1, -1):
        k.add(*k.disc((sx * 0.083, -0.255, 1.06), 0.022, 0.012, n=8, M=frame(V((sx, -0.25, 0)), Z)), C['eye'], 'Head')
        k.add(*k.disc((sx * 0.09, -0.257, 1.06), 0.011, 0.006, n=6, M=frame(V((sx, -0.25, 0)), Z)), C['pupil'], 'Head')
    # bandana (player colour): knot round the neck and a point on the chest
    k.add(*k.loft([(V((0, -0.15, 0.775)), 0.14, 0.138), (V((0, -0.165, 0.82)), 0.128, 0.126)], n=10, sq=2.4, side=X), '#ffffff', 'Neck', mat='Accent', jitter=0.004)
    k.add(*k.loft([(V((0, -0.3, 0.8)), 0.085, 0.014), (V((0, -0.338, 0.7)), 0.014, 0.01)], n=4, sq=2, side=X), '#ffffff', 'Spine2', mat='Accent')
    # folded wings with two dark bars and dark primaries
    for s in 'LR':
        sh, el, wr, tip = (V(J0[n + s]) for n in ('shoulder', 'elbow', 'wrist', 'tip'))
        out = V((1 if s == 'L' else -1, 0, 0))
        limb(k, sh, el, (0.035, 0.12), (0.032, 0.14), C['wing'], 'Arm' + s, n=6, sq=2.6, side=out, jitter=0.004)
        limb(k, el, wr, (0.032, 0.14), (0.028, 0.1), C['wing'], 'ForeArm' + s, n=6, sq=2.6, side=out, jitter=0.004)
        limb(k, wr, tip, (0.026, 0.1), (0.012, 0.03), C['tip'], 'Hand' + s, n=6, sq=2.6, side=out, jitter=0.003)
        for t in (0.25, 0.65):
            c = el.lerp(wr, t) + out * 0.03
            k.add(*k.box(c, (0.01, 0.035, 0.2), chamfer=0.004, M=frame(V((0, 0.15, 1)), out)), C['bar'], 'ForeArm' + s)
    # tail fan with a dark band at the end
    k.add(*k.loft([(V((0, 0.3, 0.53)), 0.06, 0.02), (V((0, 0.44, 0.48)), 0.12, 0.018), (V((0, 0.5, 0.46)), 0.13, 0.016)], n=4, sq=2, side=X), C['tail'], 'Hips', jitter=0.004)
    k.add(*k.loft([(V((0, 0.5, 0.46)), 0.13, 0.017), (V((0, 0.55, 0.445)), 0.12, 0.015)], n=4, sq=2, side=X), C['band'], 'Hips')
    # legs and three-toed feet
    for s in 'LR':
        hip, knee, ank, toe = (V(J0[n + s]) for n in ('hip', 'knee', 'ankle', 'toe'))
        limb(k, hip, knee, (0.04, 0.04), (0.03, 0.03), C['body'], 'UpLeg' + s, n=6)
        limb(k, knee, ank, (0.022, 0.022), (0.018, 0.018), C['leg'], 'Leg' + s, n=6)
        for dx in (-0.035, 0.0, 0.035):
            k.add(*k.loft([(ank + V((0, 0, -0.04)), 0.012, 0.01), (V((ank.x + dx * 1.6, ank.y - 0.12, 0.012)), 0.008, 0.008)], n=4, sq=2), C['leg'], 'Foot' + s)
        k.add(*k.loft([(ank + V((0, 0, -0.04)), 0.01, 0.01), (V((ank.x, ank.y + 0.07, 0.012)), 0.007, 0.007)], n=4, sq=2), C['leg'], 'Foot' + s)

    k.scale(S)
    arm = rig('Pigeon', J)
    body = k.build(arm)

    # lounge prop: a fruit crate with a bitten slice of bread on top, right under the pecking beak (anims.PECK),
    # crumbs on the crate and on the ground (final coordinates, not scaled)
    p = Kit('PigeonProp')
    cx, cy, top = 0.02, -0.79, 0.405
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.add(*p.box((cx + sx * 0.165, cy + sy * 0.13, top / 2), (0.035, 0.035, top), chamfer=0.006), '#7a5530', 'Prop')
    for z in (0.06, 0.2, 0.34):
        for sy in (-1, 1):
            p.add(*p.box((cx, cy + sy * 0.145, z), (0.36, 0.014, 0.08), chamfer=0.004), '#b98a52', 'Prop', jitter=0.003, seed=int(z * 100))
        for sx in (-1, 1):
            p.add(*p.box((cx + sx * 0.18, cy, z), (0.014, 0.27, 0.08), chamfer=0.004), '#a77a45', 'Prop', jitter=0.003, seed=int(z * 100) + 1)
    p.add(*p.box((cx, cy, top - 0.008), (0.36, 0.3, 0.016), chamfer=0.004), '#c49660', 'Prop')
    p.add(*p.box((cx + 0.01, cy, top + 0.022), (0.22, 0.19, 0.04), chamfer=0.016), '#e8cf93', 'Prop', jitter=0.003)
    p.add(*p.loft([(V((cx + 0.01, cy + 0.105, top + 0.022)), 0.112, 0.024), (V((cx + 0.01, cy - 0.105, top + 0.022)), 0.112, 0.024)], n=6, sq=3, side=X, cap=(False, False)), '#a8692e', 'Prop')
    p.add(*p.disc((cx + 0.1, cy - 0.07, top + 0.024), 0.05, 0.046, n=7), '#c49660', 'Prop')  # the bite, crate-coloured
    for i, (x, y, z) in enumerate(((-0.12, 0.1, top + 0.008), (0.13, 0.11, top + 0.008), (-0.09, -0.11, top + 0.008),
                                   (-0.22, 0.3, 0.01), (0.25, 0.24, 0.01), (0.06, -0.24, 0.01), (-0.27, -0.12, 0.01))):
        p.add(*p.box((cx + x, cy + y, z), (0.03, 0.024, 0.02), chamfer=0.007), '#e3c98c', 'Prop', jitter=0.004, seed=i)
    return arm, body, [p.build()]
