"""Clips per character, all looping: idle (3 s), win (1.3 s), out (2 s), and lounge (a 4 s off-duty loop for the
landing roster, may lower the hips and set props down).
Lounge keys sit on odd frames (1, 3, 5 ...) so a 15 fps render lands on every key. Lounge loops move heads and
limbs, not the whole torso: the landing's animated WebPs only store what changes between frames.
Outside lounge the hips never move (no IK on the feet): motion lives in the spine, head and arms.
Rotations are in character space (Blender: X left, -Y forward, Z up): +X tips forward, -X swings a hanging
limb forward/up, Z turns."""
import math

from lib import aim, clip, place, shift, turn

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def pose(*steps):
    """Steps: (bone, axis, deg) turns; (bone, 'aim', dir[, roll]); (bone, 'shift', offset); (bone, 'place', loc, ydir[, xhint])."""
    def f(a):
        for st in steps:
            if st[1] == 'aim':
                aim(a, st[0], st[2], st[3] if len(st) > 3 else 0.0)
            elif st[1] == 'shift':
                shift(a, st[0], st[2])
            elif st[1] == 'place':
                place(a, st[0], st[2], st[3], *(st[4:] or []))
            else:
                turn(a, *st)
    return f


REST = pose()
BREATHE = [('Spine1', X, -2.2), ('Spine2', X, -1.2), ('ShoulderL', Y, -1.5), ('ShoulderR', Y, 1.5)]


def loop(arm, keys):
    """The lounge clip: keys of (frame, steps); the last frame repeats the first so the loop closes."""
    clip(arm, 'lounge', [(f, pose(*st)) for f, st in keys] + [(121, pose(*keys[0][1]))])


def standard(arm, idle, win, out):
    clip(arm, 'idle', [(1, REST), (31, pose(*BREATHE, *idle[0])), (61, pose(('Spine1', X, -1), *idle[1])), (91, REST)])
    clip(arm, 'win', [(1, pose(*win)), (20, pose(*win, ('Spine1', X, -3))), (40, pose(*win))])
    clip(arm, 'out', [(1, pose(*out)), (31, pose(*out, ('Spine1', X, 2))), (61, pose(*out))])


def sit(height):
    """Sitting on something `height` metres up: hips down, thighs forward, shins down."""
    return [('Hips', 'shift', (0, 0.06, height - 0.97)), ('UpLegL', 'aim', (0.18, -1, 0.02)), ('UpLegR', 'aim', (-0.18, -1, 0.02)),
            ('LegL', 'aim', (0.06, -0.12, -1)), ('LegR', 'aim', (-0.06, -0.12, -1)), ('FootL', 'aim', (0.1, -1, -0.2)), ('FootR', 'aim', (-0.1, -1, -0.2))]


def gladiator(arm):
    standard(
        arm,
        idle=[[('Head', Z, 7), ('ArmL', X, -2.5), ('ArmR', X, 3)], [('Head', Z, -5), ('Head', X, 3), ('ArmL', X, -1)]],
        win=[('Spine1', X, -6), ('Head', X, -12), ('ArmR', X, -150), ('ArmR', Y, 18), ('ForeArmR', X, -25), ('ArmL', Y, -14)],
        out=[('Spine1', X, 14), ('Neck', X, 16), ('Head', X, 12), ('ArmL', X, 22), ('ArmL', Y, 10), ('ArmR', X, 18)],
    )
    # resting on a rock between bouts: sword planted tip-down at his right, shield leaning at his left;
    # he breathes, looks off to one side, then back the other way
    def sitting(*extra, head=(-6, 10), hand=-0.25):
        return [*sit(0.5), ('Spine1', X, 10), *extra,
                ('ArmL', 'aim', (0.25, -0.45, -0.85)), ('ForeArmL', 'aim', (-0.15, -1, -0.25)),
                ('ArmR', 'aim', (-0.25, -0.45, -0.85)), ('ForeArmR', 'aim', (0.15, -1, hand)),
                ('Sword', 'place', (-0.52, -0.08, 0.6), (0.06, 0.05, -1)),
                ('Shield', 'place', (0.6, 0.1, 0.4), (0.55, -0.75, 0.3), (0, 0, 1)),
                ('Head', X, head[0]), ('Head', Z, head[1])]
    # looks off one way, drums his fingers on his knee, glances back the other way
    loop(arm, [(1, sitting()), (29, sitting(head=(-9, 28))), (45, sitting(head=(-8, 25))),
               (55, sitting(head=(-8, 22), hand=0.05)), (61, sitting(head=(-8, 21))), (67, sitting(head=(-8, 20), hand=0.05)), (73, sitting(head=(-7, 18))),
               (89, sitting(head=(-2, -8))), (105, sitting(head=(-4, 0)))])


def sniper(arm):
    standard(
        arm,
        idle=[[('Head', Z, 14), ('Head', X, -2)], [('Head', Z, -12)]],
        win=[('Spine1', X, -5), ('Head', X, -14), ('ArmR', 'aim', (-0.45, -0.1, 1)), ('ForeArmR', 'aim', (-0.15, -0.15, 1)), ('ArmL', 'aim', (0.55, -0.15, 0.55)), ('ForeArmL', 'aim', (0.15, -0.2, 1))],
        out=[('Spine1', X, 14), ('Neck', X, 18), ('Head', X, 10), ('ArmR', X, 16), ('ArmL', X, 18)],
    )
    # rifle held across the body, scanning down the range, a glance back, a shrug to settle the rifle
    def watch(head, spine=6, *extra):
        return [('Spine1', Z, spine), ('Spine1', X, -2), *extra, ('Head', Z, head[0]), ('Head', X, head[1])]
    loop(arm, [(1, watch((22, -3))), (25, watch((34, -5), 9)), (49, watch((30, -1), 8)), (69, watch((2, -2), 3)),
               (79, watch((4, -2), 3, ('ShoulderL', Y, -6), ('ShoulderR', Y, 6))), (87, watch((6, -2), 3)), (103, watch((14, -3), 5))])


def pathfinder(arm):
    clip(arm, 'idle', [
        (1, REST),
        (24, pose(*BREATHE, ('Head', Z, -8), ('ForeArmL', X, -6), ('ForeArmR', X, -4))),
        (54, pose(('Spine1', X, -1), ('Head', Z, 9), ('Head', X, -3), ('ForeArmL', X, -2), ('ForeArmR', X, -7))),
        (91, REST),
    ])
    win = [('Spine1', X, -6), ('Head', X, -14), ('ArmL', Y, -150), ('ArmR', Y, 150), ('ForeArmL', Y, -20), ('ForeArmR', Y, 20)]
    clip(arm, 'win', [(1, pose(*win)), (20, pose(*win, ('ArmL', Y, 12), ('ArmR', Y, -12))), (40, pose(*win))])
    out = [('Spine1', X, 15), ('Neck', X, 18), ('Head', X, 10), ('ArmL', X, 12), ('ArmR', X, 12)]
    clip(arm, 'out', [(1, pose(*out)), (31, pose(*out, ('Spine1', X, 2))), (61, pose(*out))])
    # low ready crouch, daggers out, rocking from side to side and checking over a shoulder
    def crouch(sway=0, lean=12, head=(-10, 0), arms=(-20, -10), *extra):
        return [('Hips', 'shift', (0, 0.03, -0.12)), ('UpLegL', X, -28), ('LegL', X, 30), ('UpLegR', X, -8), ('LegR', X, 26),
                ('Spine1', X, lean), ('Spine1', Z, sway), *extra, ('Head', X, head[0]), ('Head', Z, head[1] - sway),
                ('ArmL', X, arms[0]), ('ArmR', X, arms[1])]
    loop(arm, [(1, crouch()), (21, crouch(6, 15, (-12, 0), (-28, -6))), (41, crouch(0, 12, (-10, 0), (-20, -14))),
               (61, crouch(-6, 15, (-12, 0), (-16, -22))), (79, crouch(-2, 11, (-6, 34), (-18, -12))), (95, crouch(-2, 11, (-6, 30), (-20, -12))), (109, crouch(0, 12))])


def pirate(arm):
    standard(
        arm,
        idle=[[('Head', Z, 9), ('Head', X, -3), ('ArmR', X, 3)], [('Head', Z, -7), ('ForeArmR', X, -4)]],
        win=[('Spine1', X, -6), ('Head', X, -14), ('ArmR', 'aim', (-0.4, -0.15, 1)), ('ForeArmR', 'aim', (-0.1, -0.25, 1))],
        out=[('Spine1', X, 15), ('Neck', X, 16), ('Head', X, 12), ('ArmR', X, 16), ('ArmL', Y, 10)],
    )
    # one boot up on his treasure chest, leaning on the raised knee; a look round, then a laugh, head back
    def boot(lean=4, head=(-14, -8), *extra):
        return [('UpLegR', 'aim', (-0.04, -0.82, -0.3)), ('LegR', 'aim', (-0.03, -0.12, -1)), ('FootR', 'aim', (0, -1, -0.05)),
                ('Spine1', X, 12), ('Spine2', X, lean), *extra, ('Head', X, head[0]), ('Head', Z, head[1]),
                ('ArmR', 'aim', (-0.1, -0.55, -0.82)), ('ForeArmR', 'aim', (0.35, -1, -0.1))]
    loop(arm, [(1, boot()), (25, boot(4, (-10, 6))), (47, boot(4, (-12, 2))),
               (61, boot(-3, (-28, -4))), (67, boot(2, (-21, -4))), (73, boot(-3, (-28, -4))), (79, boot(2, (-21, -4))), (85, boot(-2, (-26, -4))),
               (99, boot(4, (-15, -10)))])


def pigeon(arm):
    clip(arm, 'idle', [
        (1, REST),
        (16, pose(('Neck', X, 10), ('Head', X, -6))),
        (31, pose(('Neck', X, -4), ('Head', Z, 22))),
        (52, pose(('Neck', X, 10), ('Head', X, -6), ('Head', Z, -14))),
        (70, pose(('Neck', X, -4), ('Head', Z, -20))),
        (91, REST),
    ])
    spread = [('Neck', X, -10), ('Head', X, -12), ('ArmL', 'aim', (0.9, 0.05, 0.45)), ('ForeArmL', 'aim', (0.95, 0.1, 0.5)), ('HandL', 'aim', (0.9, 0.2, 0.3)),
              ('ArmR', 'aim', (-0.9, 0.05, 0.45)), ('ForeArmR', 'aim', (-0.95, 0.1, 0.5)), ('HandR', 'aim', (-0.9, 0.2, 0.3))]
    clip(arm, 'win', [(1, pose(*spread)), (10, pose(*spread, ('ArmL', Y, 25), ('ArmR', Y, -25))), (20, pose(*spread)), (30, pose(*spread, ('ArmL', Y, 25), ('ArmR', Y, -25))), (40, pose(*spread))])
    down = [('Neck', X, 38), ('Head', X, 22), ('Hips', X, 8), ('ArmL', Y, 12), ('ArmR', Y, -12)]
    clip(arm, 'out', [(1, pose(*down)), (31, pose(*down, ('Neck', X, 4))), (61, pose(*down))])
    # lunch: two pecks at the bread, head up to swallow, a look round with one eye, a head bob, two more pecks
    def up(*extra):
        return [*pigeon_tilt(6), ('Neck', X, -4), ('Head', X, -4), *extra]
    lift = [*pigeon_tilt(PECK[0] * 0.6), ('Neck', 'aim', (0, -0.8, 0.05)), ('Head', 'aim', (0, -0.75, 0.65))]
    peck = PECK_POSE
    ruffle = [('ArmL', Y, 9), ('ArmR', Y, -9)]
    loop(arm, [(1, peck), (5, lift), (9, peck), (13, lift), (19, up(('Head', X, -16))), (23, up(('Neck', X, 7), ('Head', X, -9))), (27, up(('Head', X, -14))), (31, up()),
               (43, up(('Head', Z, 32), ('Head', Y, 14), *ruffle)), (55, up(('Head', Z, 28), ('Head', Y, 12))), (65, up(('Head', Z, -26), ('Head', Y, -12))),
               (75, up(('Neck', X, 14), ('Head', X, -12))), (79, up(('Neck', X, -7), ('Head', X, 4))), (83, up(('Neck', X, 14), ('Head', X, -12))), (87, lift),
               (91, peck), (95, lift), (99, peck), (103, lift), (109, up(('Head', X, -14))), (115, lift)])


def pigeon_tilt(deg):
    """Tip the pigeon's body forward about its hip joints, legs kept upright, so the feet stay planted
    (turning the Hips bone alone pivots at the belly and swings the legs back off the ground)."""
    from pigeon import J
    a = math.radians(deg)
    oy, oz = J['hipL'][1] - J['hips'][1], J['hipL'][2] - J['hips'][2]
    ry, rz = oy * math.cos(a) - oz * math.sin(a), oy * math.sin(a) + oz * math.cos(a)
    return [('Hips', X, deg), ('Hips', 'shift', (0, oy - ry, oz - rz)), ('UpLegL', X, -deg), ('UpLegR', X, -deg)]


# hips tilt, neck aim, head aim (the head bone runs up through the crown, so "top of the head forward" points the
# beak down). pigeon.py puts the bread on its crate where this leaves the beak tip.
PECK = (46, (0, -0.75, -0.65), (0, -0.9, 0.2))
PECK_POSE = [*pigeon_tilt(PECK[0]), ('Neck', 'aim', PECK[1]), ('Head', 'aim', PECK[2])]


def keone(arm):
    standard(
        arm,
        idle=[[('Head', Z, 10), ('Head', X, -2)], [('Head', Z, -8), ('Spine1', Z, 3)]],
        win=[('Spine1', X, -5), ('Head', X, -12), ('ArmR', 'aim', (-0.3, -0.15, 1)), ('ForeArmR', 'aim', (-0.05, -0.2, 1))],
        out=[('Spine1', X, 14), ('Neck', X, 18), ('Head', X, 12)],
    )
    # arms folded, chin up, waiting for a fight: looks round, taps a foot, nods
    def folded(head=(-6, 8), sway=0, *extra):
        return [('Spine1', Z, sway), *extra, ('ArmL', 'aim', (0.18, -0.35, -0.92)), ('ForeArmL', 'aim', (-1, -0.35, 0.18)), ('ArmR', 'aim', (-0.18, -0.38, -0.91)), ('ForeArmR', 'aim', (1, -0.45, 0.24)),
                ('Head', X, head[0]), ('Head', Z, head[1])]
    tap = ('FootR', X, -16)
    loop(arm, [(1, folded()), (25, folded((-4, 20), 3)), (47, folded((-9, 2), 1)),
               (61, folded((-8, 4), 0, tap)), (67, folded((-8, 4), 0)), (73, folded((-8, 4), 0, tap)), (79, folded((-8, 4), 0)), (85, folded((-8, 4), 0, tap)), (91, folded((-8, 4), 0)),
               (101, folded((2, 6), -2)), (111, folded((-6, 8), -1))])


def make(name, arm):
    globals()[name](arm)
