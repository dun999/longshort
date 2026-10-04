"""Tank — the Bulwark: a hoplite shield-bearer. Barrel chest in a bronze cuirass, Corinthian helmet with a
crest, a great round shield on the left arm (crest and shield face take the player's colour), short sword
low in the right hand, leather pteruges, bronze greaves, wide planted stance."""
import math
from lib import Kit, V, spine_weights
from parts import X, Y, Z, basis, boot, frame, hand, limb, rig, sym, torso_weights

J = sym(dict(
    hips=(0, 0, 0.99), spine=(0, 0, 1.1), chest=(0, -0.005, 1.26), upper=(0, 0, 1.41), neck=(0, 0, 1.56), head=(0, -0.01, 1.62), headtop=(0, -0.01, 1.9),
    clavL=(0.05, 0, 1.5), shoulderL=(0.29, 0.01, 1.47), elbowL=(0.34, -0.02, 1.18), wristL=(0.17, -0.22, 1.1), tipL=(0.1, -0.27, 1.08),
    shoulderR=(-0.29, 0.01, 1.47), elbowR=(-0.35, 0.04, 1.19), wristR=(-0.37, -0.07, 0.96), tipR=(-0.375, -0.12, 0.87),
    hipL=(0.125, -0.01, 0.96), kneeL=(0.18, -0.08, 0.53), ankleL=(0.21, -0.05, 0.13), toeL=(0.26, -0.21, 0.03),
    hipR=(-0.125, 0.02, 0.96), kneeR=(-0.17, 0.04, 0.53), ankleR=(-0.2, 0.09, 0.13), toeR=(-0.23, -0.07, 0.03),
))

C = dict(
    skin='#a66f4c', beard='#3a2518', bronze='#a47b3c', bronze_dk='#6c4f25', bronze_hi='#c09650', greave='#8a6631', cape='#7a3229', cape_in='#3a1712', leather='#5c3b24', leather_dk='#3d2717',
    linen='#d6c9ab', boot='#4a3425', sole='#201915', steel='#cdd1d6', slit='#120d0a', wood='#6b4a2c',
)


def build():
    k = Kit('TankBody')
    tw = torso_weights(J)

    # ── legs: bare thighs under the skirt, bronze greaves, heavy boots ──
    for s in 'LR':
        boot(k, J['ankle' + s], J['toe' + s], C['boot'], C['sole'], 'Foot' + s, length=0.31, width=0.14, height=0.13)
        ank, knee, hip = V(J['ankle' + s]), V(J['knee' + s]), V(J['hip' + s])
        limb(k, ank + V((0, 0, 0.04)), knee, (0.07, 0.074), (0.085, 0.09), C['skin'], 'Leg' + s, mid=(0.55, 0.095, 0.1))
        limb(k, ank + V((0, 0, 0.07)), knee + V((0, 0, 0.02)), (0.078, 0.084), (0.094, 0.1), C['greave'], 'Leg' + s, mid=(0.55, 0.104, 0.11), jitter=0.002)
        k.add(*k.box(knee + V((0, -0.06, 0.0)), (0.12, 0.07, 0.1), chamfer=0.02), C['bronze_dk'], 'Leg' + s)
        limb(k, knee, hip, (0.09, 0.095), (0.125, 0.13), C['skin'], 'UpLeg' + s, mid=(0.5, 0.12, 0.125))
    # linen skirt under the cuirass, leather strips over it
    k.add(*k.loft([(V((0, 0.0, 0.8)), 0.27, 0.19), (V((0, 0, 0.92)), 0.25, 0.175), (V((0, 0, 1.02)), 0.235, 0.165)], n=12, sq=2.8), C['linen'], 'Hips', jitter=0.004)
    for i in range(14):
        a = 2 * math.pi * i / 14 + math.pi / 14
        ca, sa = math.cos(a), math.sin(a)
        c = V((ca * 0.265, sa * 0.188, 0.88))
        n = V((ca / 0.265, sa / 0.188, 0)).normalized()
        k.add(*k.box(c, (0.07, 0.016, 0.17), chamfer=0.005, M=frame(Z, -n), taper=(1.05, 1)), C['leather'], 'Hips', jitter=0.003)
        k.add(*k.box(c + n * 0.01 - V((0, 0, 0.07)), (0.04, 0.008, 0.018), chamfer=0.002, M=frame(Z, -n)), C['bronze'], 'Hips')

    # ── torso: bronze muscle cuirass on a barrel chest ──
    k.add(*k.loft([
        (V((0, 0.0, 0.97)), 0.25, 0.17),
        (V((0, -0.005, 1.08)), 0.255, 0.18),
        (V((0, -0.012, 1.24)), 0.29, 0.205),
        (V((0, -0.01, 1.38)), 0.31, 0.205),
        (V((0, 0.0, 1.47)), 0.29, 0.19),
        (V((0, 0.0, 1.53)), 0.19, 0.14),
        (V((0, 0.0, 1.57)), 0.1, 0.09),
    ], n=12, sq=3.0), C['bronze'], 'Spine', weights=tw, jitter=0.003)
    # sculpted chest: pec plates and a sternum ridge
    for x in (0.115, -0.115):
        k.add(*k.box((x, -0.21, 1.36), (0.18, 0.03, 0.13), chamfer=0.02, taper=(1, 0.9)), C['bronze_hi'], 'Spine1', weights=tw)
    k.add(*k.box((0, -0.207, 1.16), (0.03, 0.02, 0.22), chamfer=0.006), C['bronze_dk'], 'Spine', weights=tw)
    k.add(*k.loft([(V((0, 0, 0.965)), 0.262, 0.18), (V((0, 0, 1.03)), 0.256, 0.18)], n=12, sq=3), C['leather_dk'], 'Hips')
    k.add(*k.box((0, -0.186, 0.998), (0.07, 0.02, 0.06), chamfer=0.008), C['bronze_hi'], 'Hips')
    # cape from the shoulders, hanging behind the knees
    capew = spine_weights([(0.75, 'Hips'), (1.05, 'Spine'), (1.3, 'Spine1'), (1.5, 'Spine2')])
    cape = [(V((0, 0.2, 1.52)), 0.2, 0.03), (V((0, 0.228, 1.38)), 0.3, 0.04), (V((0, 0.25, 1.05)), 0.33, 0.042), (V((0, 0.29, 0.66)), 0.36, 0.04)]
    wave = lambda q: V((q.x, q.y + 0.025 * math.sin(q.x * 22), q.z + (0.05 * math.sin(q.x * 9 + 1) if q.z < 0.7 else 0)))
    k.add(*k.loft(cape, n=10, sq=3.2), C['cape'], 'Spine2', weights=capew, jitter=0.008, deform=wave)
    # neck
    limb(k, (0, 0.0, 1.5), (0, -0.01, 1.64), (0.085, 0.08), (0.08, 0.078), C['skin'], 'Neck', n=8)

    # ── arms: bare and thick, leather bracers, layered pauldrons ──
    for s in 'LR':
        sx = 1 if s == 'L' else -1
        sh, el, wr, tip = (V(J[n + s]) for n in ('shoulder', 'elbow', 'wrist', 'tip'))
        limb(k, sh, el, (0.09, 0.094), (0.074, 0.078), C['skin'], 'Arm' + s, mid=(0.4, 0.096, 0.1), jitter=0.002)
        limb(k, el, wr, (0.072, 0.076), (0.06, 0.063), C['skin'], 'ForeArm' + s, mid=(0.25, 0.08, 0.083))
        limb(k, el.lerp(wr, 0.38), el.lerp(wr, 0.95), (0.082, 0.086), (0.07, 0.074), C['leather'], 'ForeArm' + s, jitter=0.002)
        for j, (dz, r) in enumerate(((0.035, 0.165), (-0.04, 0.15), (-0.1, 0.13))):
            k.add(*k.dome(sh + V((sx * 0.02, 0, dz)), r, r * 0.95, 0.09 if j == 0 else 0.07, n=10, rings=3, flat=0.01), C['bronze'] if j == 0 else C['leather'], 'Arm' + s, jitter=0.003)
    # left fist grips the shield; right fist holds the sword low and forward
    dL = (V(J['tipL']) - V(J['wristL'])).normalized()
    hand(k, J['wristL'], dL, V((0, 0, 1)), C['leather_dk'], 'HandL', size=1.32)
    dR = (V(J['tipR']) - V(J['wristR'])).normalized()
    sword = V((0.05, -0.9, -0.42)).normalized()
    palmR = dR.cross(sword).normalized()
    hand(k, J['wristR'], dR, palmR, C['leather_dk'], 'HandR', size=1.32)
    cR = V(J['wristR']) + dR * 0.06
    k.add(*k.loft([(cR - sword * 0.075, 0.022, 0.022), (cR + sword * 0.075, 0.02, 0.02)], n=6, sq=2), C['leather_dk'], 'HandR')
    k.add(*k.box(cR - sword * 0.09, (0.04, 0.04, 0.035), chamfer=0.01, M=frame(sword, palmR)), C['bronze_hi'], 'HandR')
    g = cR + sword * 0.085
    side = palmR.cross(sword).normalized()
    k.add(*k.box(g, (0.17, 0.035, 0.03), chamfer=0.008, M=basis(side, sword.cross(side), sword)), C['bronze'], 'HandR')
    blade = [(g + sword * 0.02, 0.04, 0.009), (g + sword * 0.22, 0.056, 0.01), (g + sword * 0.4, 0.04, 0.009), (g + sword * 0.5, 0.003, 0.003)]
    k.add(*k.loft(blade, n=4, sq=2, side=side), C['steel'], 'HandR')

    # ── shield on the left forearm (face = player colour) ──
    n = V((0.32, -1, 0.05)).normalized()
    sc = V(J['elbowL']).lerp(V(J['wristL']), 0.5) + n * 0.09 + V((0.02, 0, -0.01))
    M = frame(n, Z)
    k.add(*k.disc(sc, 0.44, 0.05, n=16, M=M), C['bronze'], 'ForeArmL', jitter=0.002)
    k.add(*k.dome(sc + n * 0.02, 0.405, 0.405, 0.07, n=16, rings=3, M=M), '#ffffff', 'ForeArmL', mat='Accent', jitter=0.003)
    k.add(*k.dome(sc + n * 0.075, 0.2, 0.2, 0.035, n=16, rings=2, M=M), C['bronze_dk'], 'ForeArmL')
    k.add(*k.dome(sc + n * 0.095, 0.17, 0.17, 0.04, n=16, rings=2, M=M), '#ffffff', 'ForeArmL', mat='Accent')
    k.add(*k.dome(sc + n * 0.115, 0.07, 0.07, 0.06, n=10, rings=3, M=M), C['bronze_hi'], 'ForeArmL')
    for i in range(12):
        a = 2 * math.pi * i / 12
        p = sc + (M.col[0].xyz * math.cos(a) + M.col[1].xyz * math.sin(a)) * 0.415 + n * 0.035
        k.add(*k.box(p, (0.025, 0.025, 0.02), chamfer=0.006, M=M), C['bronze_hi'], 'ForeArmL')

    # ── head: beard below a Corinthian helmet with a crest ──
    k.add(*k.loft([(V((0, -0.11, 1.55)), 0.075, 0.03), (V((0, -0.125, 1.6)), 0.1, 0.035), (V((0, -0.118, 1.66)), 0.105, 0.03)], n=6, sq=3, side=X), C['beard'], 'Head', jitter=0.006)
    helm = [((0, 0.0, 1.6), 0.122, 0.13), ((0, -0.005, 1.7), 0.133, 0.143), ((0, 0.0, 1.82), 0.13, 0.14), ((0, 0.005, 1.92), 0.1, 0.11)]
    k.add(*k.loft([(V(c), rx, ry) for c, rx, ry in helm], n=10, sq=3.2, dome=(0, 0.03)), C['bronze'], 'Head', jitter=0.003)
    # T-slit: eye band and a mouth gap, dark and set into the face
    k.add(*k.box((0, -0.143, 1.745), (0.17, 0.012, 0.032), chamfer=0.003), C['slit'], 'Head')
    k.add(*k.box((0, -0.143, 1.665), (0.04, 0.012, 0.13), chamfer=0.003), C['slit'], 'Head')
    k.add(*k.box((0, -0.15, 1.79), (0.2, 0.02, 0.03), chamfer=0.006), C['bronze_hi'], 'Head')  # brow ridge
    k.add(*k.box((0, -0.15, 1.72), (0.028, 0.02, 0.07), chamfer=0.005), C['bronze_hi'], 'Head')  # nasal
    for x in (0.075, -0.075):
        k.add(*k.box((x, -0.14, 1.64), (0.07, 0.025, 0.13), chamfer=0.01, taper=(1.1, 1)), C['bronze'], 'Head')  # cheek guards
    # crest: a fan of player colour from brow to nape on a bronze saddle
    k.add(*k.box((0, 0.0, 1.938), (0.035, 0.24, 0.03), chamfer=0.006), C['bronze_dk'], 'Head')
    arc = [(V((0, -0.15 + 0.32 * t, 1.955 + 0.11 * math.sin(math.pi * t) - 0.06 * t)), 0.022, 0.06 + 0.03 * math.sin(math.pi * t)) for t in (0, 0.25, 0.5, 0.75, 1)]
    crest = [(c + V((0, 0, h * 0.5)), rx, h) for c, rx, h in arc]
    k.add(*k.loft(crest, n=6, sq=2.2, side=X), '#ffffff', 'Head', mat='Accent', jitter=0.004)
    k.add(*k.loft([(V((0, 0.17, 1.96)), 0.02, 0.06), (V((0, 0.24, 1.8)), 0.018, 0.05), (V((0, 0.25, 1.62)), 0.008, 0.03)], n=6, sq=2.2, side=X), '#ffffff', 'Head', mat='Accent', jitter=0.004)

    arm = rig('Tank', J)
    body = k.build(arm)
    return arm, body
