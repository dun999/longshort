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
