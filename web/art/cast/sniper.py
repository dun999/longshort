"""Sniper — the Hunter: a jungle marksman. Droopy boonie hat with leaf tufts, painted face, bandana at the
throat (player colour), low-poly camo, chest rig and a bandolier, and a long scoped bolt-action rifle carried
across the body at port arms."""
import math
import random
from lib import Kit, V, camo
from parts import FWD, X, Y, Z, basis, boot, frame, hand, limb, rig, sym, torso_weights

# the rifle: butt B, axis R (butt→muzzle), U = top of the rifle (in the frontal plane), W = its right side
B = V((-0.25, -0.17, 0.84))
R = V((0.52, -0.06, 0.85)).normalized()
U = V((-0.85, 0.0, 0.52))
U = (U - R * U.dot(R)).normalized()
W = R.cross(U).normalized()
RM = basis(W, U, R)


def rp(a, du=0.0, dw=0.0):
    return B + R * a + U * du + W * dw


F_R = rp(0.36, -0.075)  # right fist on the pistol grip
F_L = rp(0.72, -0.04)  # left fist under the forestock
GRIP = (-U * 0.92 - R * 0.38).normalized()  # pistol-grip axis, pointing down from the rifle

J = sym(dict(
    hips=(0, 0, 0.98), spine=(0, 0, 1.09), chest=(0, -0.005, 1.23), upper=(0, 0, 1.36), neck=(0, 0, 1.5), head=(0, -0.005, 1.575), headtop=(0, -0.005, 1.83),
    clavL=(0.04, 0, 1.43), shoulderL=(0.19, 0.01, 1.425), elbowL=(0.25, -0.06, 1.19),
    shoulderR=(-0.19, 0.01, 1.425), elbowR=(-0.25, 0.0, 1.14),
    hipL=(0.09, -0.005, 0.95), kneeL=(0.118, -0.065, 0.52), ankleL=(0.135, -0.035, 0.11), toeL=(0.17, -0.18, 0.03),
    hipR=(-0.09, 0.01, 0.95), kneeR=(-0.11, 0.03, 0.52), ankleR=(-0.125, 0.075, 0.11), toeR=(-0.145, -0.075, 0.03),
))


def _fist(F, t, elbow):
    """Wrist + knuckle direction for a fist centred at F whose grip runs along t (thumb toward +t)."""
    fwd = F - V(elbow)
    d = (fwd - t * fwd.dot(t)).normalized()
    return F - d * 0.052, d, d.cross(t).normalized()


wR, dR, palmR = _fist(F_R, -GRIP, J['elbowR'])
wL, dL, palmL = _fist(F_L, R, J['elbowL'])
J.update(wristR=tuple(wR), tipR=tuple(wR + dR * 0.1), wristL=tuple(wL), tipL=tuple(wL + dL * 0.1))

C = dict(
    skin='#7d4e33', paint='#26301d', eye='#120d0a', brow='#1e140e', hat='#5d6941', hatband='#363c27',
    vest='#57563a', pouch='#48472f', strap='#3a3626', boot='#403d2d', sole='#1b1916', wood='#7b4a29', wood_dk='#55331d',
    metal='#2a2b2f', metal_hi='#45474d', brass='#c69c46', lens='#9fd0e8', cuff='#4f5a36', glove='#2b2620',
)
SHIRT = camo(['#4a5936', '#5f6b40', '#394430', '#6c6843'], scale=9, seed=1)
PANTS = camo(['#6b6646', '#55573a', '#7a6f4c', '#45452f'], scale=8, seed=4)
LEAVES = ['#4f7a33', '#3c6027', '#6a8a39', '#577c2c']


def leaves(k, center, n, spread, bone, seed):
    rnd = random.Random(seed)
    for i in range(n):
        off = V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 1))) * spread
        d = V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.2, 1.2))).normalized()
        k.add(*k.box(V(center) + off, (0.05, 0.006, 0.11), chamfer=0.0, M=frame(d, V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.3))), taper=(0.25, 1)), LEAVES[i % len(LEAVES)], bone)


def build():
    k = Kit('SniperBody')
    tw = torso_weights(J)

    # ── legs: camo cargo trousers, knee pads, jungle boots ──
    for s in 'LR':
        boot(k, J['ankle' + s], J['toe' + s], C['boot'], C['sole'], 'Foot' + s, length=0.28, width=0.115, height=0.12, cuff=(0.24, 0.064, C['boot']))
        ank, knee, hip = V(J['ankle' + s]), V(J['knee' + s]), V(J['hip' + s])
        limb(k, ank + V((0, 0, 0.16)), knee, (0.066, 0.07), (0.075, 0.08), PANTS, 'Leg' + s, mid=(0.5, 0.078, 0.082), jitter=0.003)
        k.add(*k.box(knee + V((0, -0.06, -0.01)), (0.11, 0.05, 0.11), chamfer=0.018), C['strap'], 'Leg' + s)
        limb(k, knee, hip, (0.078, 0.083), (0.1, 0.105), PANTS, 'UpLeg' + s, mid=(0.5, 0.095, 0.1), jitter=0.003)
        sx = 1 if s == 'L' else -1
        k.add(*k.box(knee.lerp(hip, 0.5) + V((sx * 0.085, -0.01, 0)), (0.04, 0.1, 0.11), chamfer=0.012), PANTS, 'UpLeg' + s, jitter=0.002)
    k.add(*k.loft([(V((0, 0, 0.86)), 0.17, 0.115), (V((0, 0, 1.0)), 0.165, 0.112)], n=8, sq=3), PANTS, 'Hips')

    # ── torso: camo shirt, belt, chest rig, bandolier ──
    k.add(*k.loft([
        (V((0, 0.0, 0.94)), 0.17, 0.118),
        (V((0, 0.0, 1.05)), 0.165, 0.115),
        (V((0, -0.004, 1.2)), 0.18, 0.124),
        (V((0, 0.0, 1.34)), 0.195, 0.126),
        (V((0, 0.0, 1.43)), 0.17, 0.114),
        (V((0, 0.0, 1.49)), 0.075, 0.068),
    ], n=10, sq=3.2), SHIRT, 'Spine', weights=tw, jitter=0.003)
    k.add(*k.loft([(V((0, 0, 0.95)), 0.178, 0.124), (V((0, 0, 1.0)), 0.172, 0.12)], n=10, sq=3.2), C['strap'], 'Hips')
    k.add(*k.box((0, -0.123, 0.975), (0.05, 0.014, 0.04), chamfer=0.006), C['metal_hi'], 'Hips')
    # chest rig: a plate carrier front with three mag pouches, shoulder straps
    k.add(*k.loft([(V((0, -0.006, 1.06)), 0.172, 0.126), (V((0, -0.008, 1.34)), 0.2, 0.134)], n=10, sq=3.4), C['vest'], 'Spine1', weights=tw, jitter=0.003)
    for x in (-0.07, 0.0, 0.07):
        k.add(*k.box((x, -0.145, 1.13), (0.058, 0.035, 0.1), chamfer=0.01), C['pouch'], 'Spine', weights=tw, jitter=0.002)
        k.add(*k.box((x, -0.164, 1.17), (0.06, 0.012, 0.03), chamfer=0.004), C['strap'], 'Spine', weights=tw)
    for x in (0.1, -0.1):
        k.add(*k.loft([(V((x, -0.12, 1.34)), 0.032, 0.008), (V((x * 1.1, -0.05, 1.47)), 0.032, 0.008), (V((x * 1.1, 0.07, 1.46)), 0.032, 0.008), (V((x, 0.13, 1.32)), 0.032, 0.008)], n=4, sq=2, side=X), C['strap'], 'Spine2')
    # bandolier: right shoulder to left hip, brass rounds across the front
    band = [(V((-0.15, -0.115, 1.44)), 0.008, 0.03), (V((-0.05, -0.153, 1.29)), 0.008, 0.03), (V((0.08, -0.152, 1.11)), 0.008, 0.03), (V((0.175, -0.125, 0.97)), 0.008, 0.03)]
    k.add(*k.loft(band, n=4, sq=2, side=Y), C['strap'], 'Spine', weights=tw)
    back = [(V((-0.15, 0.11, 1.44)), 0.008, 0.03), (V((0.0, 0.135, 1.22)), 0.008, 0.03), (V((0.175, 0.12, 0.97)), 0.008, 0.03)]
    k.add(*k.loft(back, n=4, sq=2, side=Y), C['strap'], 'Spine', weights=tw)
    for i in range(7):
        t = 0.12 + i * 0.12
        a, b2 = band[int(t * 3)][0], band[min(3, int(t * 3) + 1)][0]
        p = a.lerp(b2, t * 3 - int(t * 3)) + V((0, -0.016, 0))
        k.add(*k.box(p, (0.016, 0.02, 0.05), chamfer=0.004, M=frame(V((0.5, 0, 0.85)), FWD)), C['brass'], 'Spine', weights=tw)

    # ── arms: rolled sleeves, bare forearms, fingerless gloves ──
    for s in 'LR':
        sh, el, wr = (V(J[n + s]) for n in ('shoulder', 'elbow', 'wrist'))
        k.add(*k.dome(sh, 0.074, 0.078, 0.055, n=8, rings=3), SHIRT, 'Arm' + s)
        limb(k, sh, el, (0.063, 0.066), (0.058, 0.06), SHIRT, 'Arm' + s, jitter=0.002)
        limb(k, el + (sh - el).normalized() * 0.02, el - (el - wr).normalized() * 0.04 + (el - sh).normalized() * 0.0, (0.066, 0.068), (0.064, 0.066), C['cuff'], 'Arm' + s)
        limb(k, el, wr, (0.05, 0.052), (0.04, 0.042), C['skin'], 'ForeArm' + s, mid=(0.3, 0.052, 0.054))
    hand(k, J['wristR'], dR, palmR, C['glove'], 'HandR', size=1.1)
    hand(k, J['wristL'], dL, palmL, C['glove'], 'HandL', size=1.1)

    # ── rifle (on the right hand) ──
    def rbox(a0, a1, h, w, du=0.0, dw=0.0, col=C['metal'], chamfer=0.006, taper=(1, 1)):
        k.add(*k.box(rp((a0 + a1) / 2, du, dw), (w, h, a1 - a0), chamfer=chamfer, M=RM, taper=taper), col, 'HandR')

    def rtube(a0, a1, r0, r1, du=0.0, col=C['metal'], n=8):
        k.add(*k.loft([(rp(a0, du), r0, r0), (rp(a1, du), r1, r1)], n=n, sq=2, side=W), col, 'HandR')

    rbox(0.0, 0.02, 0.13, 0.05, -0.01, col=C['metal'])  # butt pad
    rbox(0.02, 0.3, 0.12, 0.046, -0.012, col=C['wood'], taper=(1, 0.62))  # stock (tapers to the wrist)
    rbox(0.07, 0.25, 0.03, 0.044, 0.05, col=C['wood_dk'])  # cheek rest
    k.add(*k.box(F_R - dR * 0.0 + GRIP * 0.0, (0.04, 0.05, 0.1), chamfer=0.01, M=basis(W, GRIP.cross(W), GRIP)), C['wood_dk'], 'HandR')  # pistol grip
    rbox(0.3, 0.56, 0.065, 0.046, 0.0, col=C['metal'])  # receiver
    rbox(0.37, 0.45, 0.03, 0.014, -0.045, col=C['metal_hi'])  # trigger guard
    k.add(*k.loft([(rp(0.52, 0.02, 0.02), 0.008, 0.008), (rp(0.5, 0.0, 0.08), 0.008, 0.008)], n=6, sq=2, side=R), C['metal_hi'], 'HandR')  # bolt
    k.add(*k.dome(rp(0.5, 0.0, 0.085), 0.016, 0.016, 0.016, n=6, rings=2, M=basis(R, U, W)), C['metal_hi'], 'HandR')
    rbox(0.56, 0.9, 0.058, 0.048, -0.008, col=C['wood'], taper=(0.9, 0.9))  # forestock
    rtube(0.5, 1.24, 0.016, 0.014, 0.005)  # barrel
    rtube(1.22, 1.31, 0.024, 0.024, 0.005, col=C['metal_hi'])  # muzzle brake
    rtube(0.34, 0.39, 0.028, 0.026, 0.075)  # scope eyepiece
    rtube(0.39, 0.62, 0.021, 0.021, 0.075)  # scope tube
    rtube(0.62, 0.71, 0.026, 0.033, 0.075)  # objective bell
    k.add(*k.disc(rp(0.712, 0.075), 0.027, 0.006, n=8, M=basis(W, U, R)), C['lens'], 'HandR')
    rbox(0.43, 0.46, 0.05, 0.022, 0.045, col=C['metal_hi'])  # mounts
    rbox(0.57, 0.6, 0.05, 0.022, 0.045, col=C['metal_hi'])
    rbox(0.66, 0.68, 0.035, 0.03, 0.075, dw=0.03, col=C['metal_hi'])  # turret
    sling = [(rp(0.14, -0.07), 0.005, 0.018), (rp(0.4, -0.16), 0.005, 0.018), (rp(0.65, -0.13), 0.005, 0.018), (rp(0.84, -0.05), 0.005, 0.018)]
    k.add(*k.loft(sling, n=4, sq=2, side=W), C['strap'], 'HandR')

    # ── head: painted face, bandana, boonie hat with leaves ──
    k.add(*k.loft([(V((0, -0.005, 1.575)), 0.096, 0.102), (V((0, -0.005, 1.65)), 0.108, 0.114), (V((0, -0.005, 1.83)), 0.104, 0.11)], n=8, sq=4.5), C['skin'], 'Head')
    k.add(*k.box((0, -0.122, 1.655), (0.03, 0.03, 0.05), chamfer=0.006, taper=(0.6, 0.5)), C['skin'], 'Head')  # nose
    for x in (0.046, -0.046):
        k.add(*k.box((x, -0.117, 1.7), (0.04, 0.012, 0.02), chamfer=0.003), C['eye'], 'Head')
        k.add(*k.box((x * 1.05, -0.119, 1.728), (0.05, 0.012, 0.013), chamfer=0.003), C['brow'], 'Head')
        k.add(*k.box((x * 1.25, -0.112, 1.635), (0.05, 0.012, 0.02), chamfer=0.003, M=frame(V((0.3 * (1 if x > 0 else -1), 0, 1)), FWD)), C['paint'], 'Head')  # cheek stripe
    k.add(*k.box((0, -0.117, 1.765), (0.16, 0.012, 0.018), chamfer=0.003), C['paint'], 'Head')  # brow stripe
    k.add(*k.box((0, -0.11, 1.598), (0.06, 0.012, 0.012), chamfer=0.003), C['eye'], 'Head')  # mouth
    k.add(*k.loft([(V((0, -0.0, 1.47)), 0.1, 0.098), (V((0, -0.004, 1.55)), 0.112, 0.112)], n=10, sq=3), '#ffffff', 'Neck', mat='Accent', jitter=0.004)
    k.add(*k.loft([(V((0, -0.11, 1.53)), 0.075, 0.012), (V((0, -0.125, 1.44)), 0.02, 0.01)], n=4, sq=2, side=X), '#ffffff', 'Neck', mat='Accent')
    k.add(*k.loft([(V((0, 0.0, 1.78)), 0.126, 0.13), (V((0, 0.0, 1.85)), 0.122, 0.126), (V((0, 0.0, 1.885)), 0.1, 0.104)], n=10, sq=2.4, dome=(0, 0.018)), C['hat'], 'Head', jitter=0.005)
    k.add(*k.loft([(V((0, 0.0, 1.79)), 0.127, 0.131), (V((0, 0.0, 1.82)), 0.126, 0.13)], n=10, sq=2.6), C['hatband'], 'Head')
    droop = lambda q: V((q.x, q.y, q.z - 0.085 * max(0.0, (math.hypot(q.x, q.y) - 0.12) / 0.13) ** 1.4 + 0.03 * max(0.0, -q.y - 0.1) / 0.15))
    k.add(*k.disc((0, 0.0, 1.792), 0.245, 0.014, n=16), C['hat'], 'Head', deform=droop, jitter=0.004)
    leaves(k, (0.07, 0.03, 1.86), 6, 0.06, 'Head', 3)
    leaves(k, (0.22, 0.02, 1.47), 7, 0.06, 'ArmL', 5)
    leaves(k, (0.0, 0.14, 1.36), 6, 0.08, 'Spine2', 7)

    arm = rig('Sniper', J)
    body = k.build(arm)
    return arm, body

