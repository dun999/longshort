"""Pathfinder: a desert runner. Deep hood over a scarfed face (the scarf takes the player's
colour), goggles up on the hood, a pointed shoulder poncho, wrapped forearms and shins, twin daggers
held in reverse grip, weight on the back foot."""
from lib import Kit, V
from parts import X, Y, Z, boot, frame, hand, limb, m, rig, sym, torso_weights

J = sym(dict(
    hips=(0, 0, 0.95), spine=(0, 0, 1.06), chest=(0, -0.005, 1.2), upper=(0, 0, 1.33), neck=(0, 0, 1.47), head=(0, -0.005, 1.545), headtop=(0, -0.005, 1.8),
    clavL=(0.04, 0, 1.42), shoulderL=(0.2, 0.01, 1.415), elbowL=(0.255, 0.05, 1.14), wristL=(0.275, -0.085, 0.94), tipL=(0.28, -0.135, 0.865),
    shoulderR=(-0.2, 0.01, 1.415), elbowR=(-0.25, 0.075, 1.15), wristR=(-0.27, -0.035, 0.935), tipR=(-0.275, -0.075, 0.855),
    hipL=(0.095, -0.01, 0.92), kneeL=(0.13, -0.075, 0.51), ankleL=(0.15, -0.06, 0.11), toeL=(0.19, -0.2, 0.03),
    hipR=(-0.095, 0.01, 0.92), kneeR=(-0.125, 0.035, 0.5), ankleR=(-0.145, 0.085, 0.11), toeR=(-0.165, -0.06, 0.03),
))

C = dict(
    skin='#b98462', cloak='#5c4838', cloak_in='#2a1f17', tunic='#3d5658', trousers='#6b5d47', wrap='#d4c4a0',
    leather='#70492d', dark='#3d2a1e', boot='#56402e', sole='#231c18', steel='#cfd3d8', brass='#b8904c',
    lens='#e8a548', frame='#2c2724', eye='#191310', brow='#3a281c',
)


def build():
    k = Kit('PathfinderBody')
    tw = torso_weights(J)

    # ── legs ──
    for s in 'LR':
        boot(k, J['ankle' + s], J['toe' + s], C['boot'], C['sole'], 'Foot' + s, length=0.28, width=0.118, height=0.11)
        ank = V(J['ankle' + s])
        knee = V(J['knee' + s])
        low = ank.lerp(knee, 0.68)
        limb(k, ank + V((0, 0, 0.0)), low, (0.06, 0.064), (0.068, 0.072), C['wrap'], 'Leg' + s, mid=(0.5, 0.07, 0.074), jitter=0.003)
        limb(k, low - V((0, 0, 0.02)), knee, (0.074, 0.078), (0.079, 0.083), C['trousers'], 'Leg' + s, mid=(0.3, 0.082, 0.086), jitter=0.003)
        limb(k, knee, J['hip' + s], (0.08, 0.084), (0.104, 0.108), C['trousers'], 'UpLeg' + s, mid=(0.55, 0.098, 0.1), jitter=0.004)
    k.add(*k.loft([(V((0, 0, 0.84)), 0.178, 0.122), (V((0, 0, 1.0)), 0.17, 0.115)], n=8, sq=3), C['trousers'], 'Hips')

    # ── tunic, belt, harness, satchel ──
    k.add(*k.loft([
        (V((0, 0.0, 0.79)), 0.215, 0.15),
        (V((0, 0.0, 0.9)), 0.185, 0.13),
        (V((0, 0.0, 1.02)), 0.168, 0.118),
        (V((0, -0.004, 1.18)), 0.182, 0.128),
        (V((0, 0.0, 1.33)), 0.198, 0.13),
        (V((0, 0.0, 1.42)), 0.172, 0.116),
        (V((0, 0.0, 1.47)), 0.08, 0.07),
    ], n=10, sq=3.2), C['tunic'], 'Spine', weights=tw, jitter=0.003)
    k.add(*k.loft([(V((0, 0, 0.925)), 0.192, 0.134), (V((0, 0, 0.98)), 0.182, 0.127)], n=10, sq=3.2), C['dark'], 'Hips')
    k.add(*k.box((0, -0.132, 0.953), (0.052, 0.016, 0.052), chamfer=0.007), C['brass'], 'Hips')
    for x in (0.105, -0.12):
        k.add(*k.box((x, -0.12, 0.915), (0.066, 0.042, 0.072), chamfer=0.011), C['leather'], 'Hips', jitter=0.002)
    k.add(*k.box((-0.2, 0.025, 0.85), (0.072, 0.17, 0.14), chamfer=0.016, taper=(1, 0.9)), C['leather'], 'Hips', jitter=0.003)
    k.add(*k.box((-0.238, 0.025, 0.895), (0.012, 0.175, 0.075), chamfer=0.004), C['dark'], 'Hips')
    for sgn in (-1, 1):
        y0 = 0.14 * sgn
        path = [(V((0.14, y0 * 0.82, 1.43)), 0.006, 0.026), (V((0.06, y0 * 1.02, 1.3)), 0.006, 0.026), (V((-0.06, y0 * 1.03, 1.12)), 0.006, 0.026), (V((-0.17, y0 * 0.99, 0.95)), 0.006, 0.026)]
        k.add(*k.loft(path, n=4, sq=2, side=Y), C['leather'], 'Spine', weights=tw)

    # ── arms ──
    for s in 'LR':
        sx = 1 if s == 'L' else -1
        sh, el, wr, tip = (V(J[n + s]) for n in ('shoulder', 'elbow', 'wrist', 'tip'))
        k.add(*k.dome(sh, 0.078, 0.082, 0.06, n=8, rings=3), C['tunic'], 'Arm' + s)
        limb(k, sh, el, (0.066, 0.068), (0.057, 0.06), C['tunic'], 'Arm' + s, jitter=0.002)
        limb(k, el, wr, (0.054, 0.056), (0.045, 0.047), C['wrap'], 'ForeArm' + s, mid=(0.3, 0.056, 0.058), jitter=0.003)
        limb(k, el.lerp(wr, 0.42), el.lerp(wr, 0.9), (0.06, 0.062), (0.054, 0.056), C['leather'], 'ForeArm' + s, jitter=0.002)
        d = (tip - wr).normalized()
        palm = V((-sx, 0, 0))
        hand(k, wr, d, palm, C['dark'], 'Hand' + s, size=1.12)
        # reverse-grip dagger: the blade leaves the little-finger side of the fist
        M = frame(d, palm)
        t = M.col[0].xyz
        c = wr + d * 0.055
        k.add(*k.box(c + t * 0.066, (0.024, 0.034, 0.034), chamfer=0.007, M=M), C['brass'], 'Hand' + s)
        g = c - t * 0.06
        k.add(*k.box(g, (0.016, 0.024, 0.085), chamfer=0.004, M=frame(d, t)), C['brass'], 'Hand' + s)
        blade = [(g - t * 0.008, 0.026, 0.006), (g - t * 0.085 + d * 0.012, 0.032, 0.006), (g - t * 0.16 + d * 0.034, 0.024, 0.005), (g - t * 0.215 + d * 0.068, 0.003, 0.002)]
        k.add(*k.loft(blade, n=4, sq=2, side=d), C['steel'], 'Hand' + s)

    # ── head ──
    k.add(*k.loft([(V((0, -0.005, 1.545)), 0.098, 0.104), (V((0, -0.005, 1.63)), 0.112, 0.118), (V((0, -0.005, 1.8)), 0.108, 0.114)], n=8, sq=4.5), C['skin'], 'Head')
    for x in (0.046, -0.046):
        k.add(*k.box((x, -0.121, 1.678), (0.038, 0.012, 0.021), chamfer=0.003), C['eye'], 'Head')
        k.add(*k.box((x * 1.06, -0.123, 1.708), (0.052, 0.012, 0.015), chamfer=0.003), C['brow'], 'Head')
    # scarf over nose and mouth (player colour), two tails down the back
    k.add(*k.loft([(V((0, -0.01, 1.465)), 0.118, 0.112), (V((0, -0.012, 1.53)), 0.136, 0.14), (V((0, -0.014, 1.6)), 0.13, 0.14), (V((0, -0.012, 1.648)), 0.122, 0.132)], n=10, sq=3.2), '#ffffff', 'Head', mat='Accent', jitter=0.004)
    for x, ln in ((0.035, 0.36), (-0.04, 0.28)):
        k.add(*k.loft([(V((x, 0.13, 1.54)), 0.045, 0.012), (V((x * 1.4, 0.215, 1.4)), 0.042, 0.012), (V((x * 1.9, 0.225, 1.54 - ln)), 0.03, 0.01)], n=4, sq=2, side=X), '#ffffff', 'Spine2', mat='Accent', jitter=0.004)
    # hood: an open-fronted shell with a dark lining, the face set back inside it, peaked at the back
    hood = [((0, -0.152, 1.69), 0.15, 0.176), ((0, -0.06, 1.7), 0.164, 0.192), ((0, 0.07, 1.705), 0.156, 0.186), ((0, 0.15, 1.77), 0.11, 0.14), ((0, 0.2, 1.9), 0.04, 0.05)]
    k.add(*k.loft([(V(c), rx, rz) for c, rx, rz in hood], n=12, sq=2.4, side=X, cap=(False, True), dome=(0, 0.03)), C['cloak'], 'Head', jitter=0.004)
    k.add(*k.loft([(V(c), rx * 0.9, rz * 0.9) for c, rx, rz in hood[:4]], n=12, sq=2.4, side=X, cap=(False, True)), C['cloak_in'], 'Head', flip=True)
    k.add(*k.loft([(V((0, -0.152, 1.69)), 0.152, 0.178), (V((0, -0.168, 1.69)), 0.142, 0.168)], n=12, sq=2.4, side=X, cap=(False, False)), C['cloak'], 'Head')
    # goggles pushed up on the hood
    for x in (0.05, -0.05):
        k.add(*k.disc((x, -0.155, 1.855), 0.036, 0.034, n=8, M=frame(V((0, -1, 0.5)), Z)), C['frame'], 'Head')
        k.add(*k.disc((x, -0.172, 1.863), 0.027, 0.008, n=8, M=frame(V((0, -1, 0.5)), Z)), C['lens'], 'Head')
    k.add(*k.box((0, -0.16, 1.858), (0.04, 0.02, 0.018), chamfer=0.004), C['frame'], 'Head')
    for x in (0.128, -0.128):
        k.add(*k.box((x, -0.04, 1.81), (0.018, 0.22, 0.02), chamfer=0.004), C['frame'], 'Head')
    # shoulder poncho, pointed front and back
    hem = lambda q: V((q.x, q.y, q.z - 0.11 * (abs(q.y) / 0.2) ** 2)) if q.z < 1.32 else q
    k.add(*k.loft([
        (V((0, 0.02, 1.53)), 0.12, 0.12),
        (V((0, 0.015, 1.46)), 0.25, 0.172),
        (V((0, 0.01, 1.38)), 0.3, 0.198),
        (V((0, 0.01, 1.3)), 0.312, 0.205),
    ], n=12, sq=2.3), C['cloak'], 'Spine2', jitter=0.006, deform=hem)

    arm = rig('Pathfinder', J)
    body = k.build(arm)
    return arm, body
