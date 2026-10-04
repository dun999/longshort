"""Shared anatomy and gear builders. Each takes the Kit, joint positions and colours."""
import math
from mathutils import Matrix, Vector
from lib import V, armature, spine_weights

X, Y, Z = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
FWD = V((0, -1, 0))


def basis(xa, ya, za):
    """4x4 rotation whose columns are the given axes."""
    M = Matrix((xa, ya, za)).transposed()
    return M.to_4x4()


def frame(d, ref=FWD):
    """Columns (t, p, d): d = length axis, p ~ ref made perpendicular, t = p x d."""
    d = V(d).normalized()
    p = (V(ref) - d * V(ref).dot(d)).normalized()
    t = p.cross(d).normalized()
    return basis(t, p, d)


def limb(k, a, b, ra, rb, color, bone, n=8, sq=3.0, mid=None, side=X, jitter=0.0, mirror=False, cap=(True, True), weights=None):
    """Tapered faceted segment from joint a to joint b. mid=(t, rx, ry) adds a bulge ring at fraction t."""
    a, b = V(a), V(b)
    path = [(a, *ra)]
    if mid:
        for t, rx, ry in (mid if isinstance(mid[0], (tuple, list)) else [mid]):
            path.append((a.lerp(b, t), rx, ry))
    path.append((b, *rb))
    k.add(*k.loft(path, n=n, sq=sq, side=side, cap=cap), color, bone, jitter=jitter, mirror=mirror, weights=weights)


def hand(k, wrist, d, palm, color, bone, size=1.0, thumb=1, mirror=False, fist=True):
    """Mitten fist: block along d from the wrist, thumb on the +t side (thumb=-1 flips). palm = direction the palm faces."""
    s = size
    d = V(d).normalized()
    M = frame(d, palm)  # columns: t (across knuckles), p (palm normal), d (length)
    t, p = M.col[0].xyz, M.col[1].xyz
    w, th, ln = 0.085 * s, 0.064 * s, (0.09 if fist else 0.11) * s
    c = V(wrist) + d * (ln / 2 + 0.004)
    k.add(*k.box(c, (w, th, ln), chamfer=0.013 * s, M=M), color, bone, mirror=mirror)
    tc = V(wrist) + t * (w * 0.5 * thumb) + p * (th * 0.3) + d * (ln * 0.32)
    k.add(*k.box(tc, (0.03 * s, 0.03 * s, 0.056 * s), chamfer=0.007 * s, M=frame(d * 0.8 + p * 0.35, palm)), color, bone, mirror=mirror)


def boot(k, ankle, toe, color, sole, bone, length=0.28, width=0.12, height=0.12, mirror=False, cuff=None, taper=(0.9, 0.78)):
    """Chunky boot laid along the ankle→toe direction, with a darker sole slab and an optional cuff (top z, radius, colour)."""
    a, t = V(ankle), V(toe)
    f = V((t.x - a.x, t.y - a.y, 0)).normalized()  # forward along the foot
    xs = f.cross(V((0, 0, 1))).normalized()
    M = basis(xs, f, V((0, 0, 1)))
    c = V((a.x, a.y, 0)) + f * (length * 0.26)
    k.add(*k.box(c + V((0, 0, height / 2 + 0.022)), (width, length, height), chamfer=0.02, M=M, taper=taper), color, bone, mirror=mirror, jitter=0.002)
    k.add(*k.box(c + V((0, 0, 0.012)) + f * 0.004, (width + 0.014, length + 0.018, 0.024), chamfer=0.006, M=M), sole, bone, mirror=mirror)
    if cuff:
        top, r, col = cuff
        limb(k, V((a.x, a.y, height * 0.75)), V((a.x, a.y, top)), (r, r * 1.06), (r * 1.04, r * 1.1), col, bone, n=8, sq=3, mirror=mirror)


def sym(J):
    """Fill every missing ...R joint by mirroring its ...L twin."""
    out = dict(J)
    for n, p in J.items():
        if n.endswith('L') and (n[:-1] + 'R') not in J:
            out[n[:-1] + 'R'] = (-p[0], p[1], p[2])
    return out


def m(s, v):
    """Mirror a left-side point/vector for side s ('L' or 'R')."""
    v = V(v)
    return v if s == 'L' else V((-v.x, v.y, v.z))


def rig(name, J, extra=()):
    """Humanoid rig from joints (L side given; R mirrored unless explicitly provided)."""
    def j(n):
        return V(J[n])

    def jr(n):
        if n.endswith('L') and (n[:-1] + 'R') in J:
            return V(J[n[:-1] + 'R'])
        p = V(J[n])
        return V((-p.x, p.y, p.z))

    bones = [
        ('Hips', j('hips'), j('spine'), None),
        ('Spine', j('spine'), j('chest'), 'Hips'),
        ('Spine1', j('chest'), j('upper'), 'Spine'),
        ('Spine2', j('upper'), j('neck'), 'Spine1'),
        ('Neck', j('neck'), j('head'), 'Spine2'),
        ('Head', j('head'), j('headtop'), 'Neck'),
    ]
    for s, get in (('L', j), ('R', jr)):
        bones += [
            ('Shoulder' + s, get('clavL') if s == 'L' else jr('clavL'), get('shoulderL') if s == 'L' else jr('shoulderL'), 'Spine2'),
            ('Arm' + s, get('shoulderL') if s == 'L' else jr('shoulderL'), get('elbowL') if s == 'L' else jr('elbowL'), 'Shoulder' + s),
            ('ForeArm' + s, get('elbowL') if s == 'L' else jr('elbowL'), get('wristL') if s == 'L' else jr('wristL'), 'Arm' + s),
            ('Hand' + s, get('wristL') if s == 'L' else jr('wristL'), get('tipL') if s == 'L' else jr('tipL'), 'ForeArm' + s),
            ('UpLeg' + s, get('hipL') if s == 'L' else jr('hipL'), get('kneeL') if s == 'L' else jr('kneeL'), 'Hips'),
            ('Leg' + s, get('kneeL') if s == 'L' else jr('kneeL'), get('ankleL') if s == 'L' else jr('ankleL'), 'UpLeg' + s),
            ('Foot' + s, get('ankleL') if s == 'L' else jr('ankleL'), get('toeL') if s == 'L' else jr('toeL'), 'Leg' + s),
        ]
    bones += list(extra)
    return armature(name, bones)


def torso_weights(J):
    return spine_weights([
        (J['hips'][2] + 0.04, 'Hips'),
        (J['chest'][2], 'Spine'),
        (J['upper'][2], 'Spine1'),
        (J['neck'][2] - 0.02, 'Spine2'),
    ])


# ─── shared face + outfit pieces for the newer cast ─────────────────────────

def head(k, z0, z1, skin, w=0.104, d=0.11, y=-0.005, jaw=0.92, bone='Head'):
    """Boxy faceted head between z0 (chin) and z1 (crown). Returns the front-face y."""
    k.add(*k.loft([(V((0, y, z0)), w * jaw * 0.94, d * 0.95), (V((0, y, z0 + (z1 - z0) * 0.32)), w * 1.06, d * 1.06), (V((0, y, z1)), w, d)], n=8, sq=4.5), skin, bone)
    return y - d * 1.06


def eyes(k, z, front, eye, brow, x=0.046, size=(0.038, 0.021), brow_z=0.03, bone='Head', skip=None):
    for sx in (1, -1):
        if skip == sx:
            continue
        k.add(*k.box((sx * x, front - 0.002, z), (size[0], 0.012, size[1]), chamfer=0.003), eye, bone)
        k.add(*k.box((sx * x * 1.05, front - 0.004, z + brow_z), (size[0] * 1.35, 0.012, 0.014), chamfer=0.003), brow, bone)


def nose(k, z, front, skin, bone='Head', size=1.0):
    k.add(*k.box((0, front - 0.012 * size, z), (0.03 * size, 0.03 * size, 0.05 * size), chamfer=0.006, taper=(0.6, 0.5)), skin, bone)


def sneaker(k, ankle, toe, upper, sole, bone, stripe=None):
    """Low trainer: a rounded upper on a thick pale sole, optional side stripe (player colour)."""
    boot(k, ankle, toe, upper, sole, bone, length=0.28, width=0.112, height=0.085, taper=(0.86, 0.72))
    a, t = V(ankle), V(toe)
    f = V((t.x - a.x, t.y - a.y, 0)).normalized()
    xs = f.cross(V((0, 0, 1))).normalized()
    c = V((a.x, a.y, 0)) + f * (0.28 * 0.26)
    k.add(*k.box(c + V((0, 0, 0.018)), (0.124, 0.296, 0.036), chamfer=0.012, M=basis(xs, f, V((0, 0, 1)))), sole, bone)
    if stripe:
        for side in (1, -1):
            k.add(*k.box(c + xs * side * 0.057 + V((0, 0, 0.062)), (0.006, 0.13, 0.022), chamfer=0.002, M=basis(xs, f, V((0, 0, 1)))), '#ffffff', bone, mat='Accent')


def tee(k, J, color, tw, hem=0.86, sleeve=None, waist=0.17, chest=0.19, depth=0.125):
    """T-shirt torso (loft) with short sleeves; sleeve colour defaults to the shirt."""
    k.add(*k.loft([
        (V((0, 0.0, hem)), waist * 1.05, depth * 1.02),
        (V((0, 0.0, 1.02)), waist, depth * 0.94),
        (V((0, -0.004, 1.2)), chest * 0.96, depth),
        (V((0, 0.0, 1.34)), chest, depth * 1.02),
        (V((0, 0.0, 1.43)), chest * 0.88, depth * 0.92),
        (V((0, 0.0, 1.48)), 0.075, 0.068),
    ], n=10, sq=3.2), color, 'Spine', weights=tw, jitter=0.003)
    for s in 'LR':
        sh, el = V(J['shoulder' + s]), V(J['elbow' + s])
        k.add(*k.dome(sh, 0.074, 0.078, 0.055, n=8, rings=3), sleeve or color, 'Arm' + s)
        limb(k, sh, sh.lerp(el, 0.45), (0.068, 0.07), (0.064, 0.066), sleeve or color, 'Arm' + s, jitter=0.002)


def bare_arms(k, J, skin, upper=0.055, fore=0.048):
    for s in 'LR':
        sh, el, wr = (V(J[n + s]) for n in ('shoulder', 'elbow', 'wrist'))
        limb(k, sh.lerp(el, 0.3), el, (upper, upper * 1.03), (upper * 0.88, upper * 0.9), skin, 'Arm' + s)
        limb(k, el, wr, (fore, fore * 1.03), (fore * 0.8, fore * 0.82), skin, 'ForeArm' + s, mid=(0.3, fore * 1.05, fore * 1.07))


def legs(k, J, color, knee_r=0.075, hip_r=0.1, ankle_r=0.06, cuff_z=0.12):
    for s in 'LR':
        ank, knee, hip = V(J['ankle' + s]), V(J['knee' + s]), V(J['hip' + s])
        limb(k, ank + V((0, 0, cuff_z - ank.z)), knee, (ankle_r, ankle_r * 1.05), (knee_r, knee_r * 1.05), color, 'Leg' + s, mid=(0.5, knee_r * 1.02, knee_r * 1.07), jitter=0.003)
        limb(k, knee, hip, (knee_r * 1.04, knee_r * 1.1), (hip_r, hip_r * 1.05), color, 'UpLeg' + s, mid=(0.5, hip_r * 0.95, hip_r), jitter=0.003)
    k.add(*k.loft([(V((0, 0, 0.84)), 0.17, 0.115), (V((0, 0, 1.0)), 0.165, 0.112)], n=8, sq=3), color, 'Hips')
