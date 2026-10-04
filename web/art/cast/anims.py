"""Clips per character, all looping: idle (3 s), lounge (a 4 s off-duty loop for the landing roster, may lower the
hips and set props down), cheer (a 2.13 s victory dance) and sulk (a 3 s defeat). Cheer and sulk play in the
arena for a winner and a knocked-out player, and are rendered for the result cards and the share card.
Lounge, cheer and sulk keys sit on odd frames (1, 3, 5 ...) so a 15 fps render lands on every key. Lounge loops
move heads and limbs, not the whole torso: the landing's animated WebPs only store what changes between frames.
In idle the hips never move: motion lives in the spine, head and arms. Cheer and sulk bend the
knees with knees(), which drops the hips by exactly what keeps the feet flat where they stand.
Rotations are in character space (Blender: X left, -Y forward, Z up): +X tips forward, -X swings a hanging
limb forward/up, Z turns."""
import math

from lib import aim, clip, place, shift, turn

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def knees(arm, deg, hop=0.0, toes=0.0):
    """Both thighs forward by `deg` and the shins back to match, so the feet stay flat where they stand and the
    hips drop. hop lifts the whole body off the floor; toes points the feet down (in the air)."""
    l1, l2 = arm.data.bones['UpLegL'].length, arm.data.bones['LegL'].length
    a = math.radians(deg)
    b = math.asin(min(1.0, l1 * math.sin(a) / l2))
    shift(arm, 'Hips', (0, 0, hop - l1 * (1 - math.cos(a)) - l2 * (1 - math.cos(b))))
    for s in 'LR':
        turn(arm, 'UpLeg' + s, X, -deg)
        turn(arm, 'Leg' + s, X, deg + math.degrees(b))
        turn(arm, 'Foot' + s, X, toes - math.degrees(b))


def pose(*steps):
    """Steps: (bone, axis, deg) turns; (bone, 'aim', dir[, roll]); (bone, 'shift', offset); (bone, 'place', loc, ydir[, xhint]);
    ('*', 'knees', deg[, hop, toes])."""
    def f(a):
        for st in steps:
            if st[1] == 'knees':
                knees(a, *st[2:])
            elif st[1] == 'aim':
                aim(a, st[0], st[2], st[3] if len(st) > 3 else 0.0)
            elif st[1] == 'shift':
                shift(a, st[0], st[2])
            elif st[1] == 'place':
                place(a, st[0], st[2], st[3], *(st[4:] or []))
            else:
                turn(a, *st)
    return f


def mirror(steps):
    """The same steps on the other side: L and R bones swapped, directions and Y/Z turns reflected."""
    def flip(name):
        return name[:-1] + {'L': 'R', 'R': 'L'}[name[-1]] if name[-1] in 'LR' else name
    out = []
    for st in steps:
        if st[1] == 'aim':
            out.append((flip(st[0]), 'aim', (-st[2][0], st[2][1], st[2][2]), *(-r for r in st[3:])))
        elif st[1] in (X, Y, Z):
            out.append((flip(st[0]), st[1], st[2] if st[1] == X else -st[2]))
        else:
            raise ValueError(f'mirror: {st}')
    return out


REST = pose()
BREATHE = [('Spine1', X, -2.2), ('Spine2', X, -1.2), ('ShoulderL', Y, -1.5), ('ShoulderR', Y, 1.5)]


def loop(arm, keys):
    """The lounge clip: keys of (frame, steps); the last frame repeats the first so the loop closes."""
    clip(arm, 'lounge', [(f, pose(*st)) for f, st in keys] + [(121, pose(*keys[0][1]))])


def idle(arm, first, second):
    """Breathing in place, with a look one way (first) and then the other (second)."""
    clip(arm, 'idle', [(1, REST), (31, pose(*BREATHE, *first)), (61, pose(('Spine1', X, -1), *second)), (91, REST)])


def cheer(arm, lo, hi, top=None, nod=(6, -14), lean=5, extra=()):
    """The victory dance, 8 beats of 8 frames: bounce, bounce (arms pumping lo → hi), a crouch, a jump (arms at
    `top`), a landing. lo, hi and top are arm steps; nod is the head down on the beat and back on the off-beat."""
    def beat(bend, arms, head, side=0, hop=0.0, toes=0.0):
        return [('*', 'knees', bend, hop, toes), ('Spine1', Y, side), ('Spine1', Z, side * 1.2), ('Spine1', X, -3), *extra, *arms, ('Head', X, head)]
    keys = [(1, beat(28, lo, nod[0], lean)), (9, beat(4, hi, nod[1])), (17, beat(28, lo, nod[0], -lean)), (25, beat(4, hi, nod[1])),
            (33, beat(38, lo, nod[0] + 4)), (41, beat(0, top or hi, nod[1] - 4, hop=0.16, toes=26)), (49, beat(34, lo, nod[0])), (57, beat(6, hi, nod[1]))]
    clip(arm, 'cheer', [(f, pose(*st)) for f, st in keys] + [(65, pose(*keys[0][1]))])


def sulk(arm, arms, sigh=None, bend=6, extra=(), kick=False, droop=1.0):
    """Defeat, 3 s: shoulders dropped, head hanging, a slow shake of the head; then a sigh (chest and chin lift,
    arms at `sigh`) and a deeper slump. kick scuffs the right boot at the floor during the shake."""
    def slump(spine=15, head=14, shake=0, arms_=arms, scuff=0):
        spine, head = spine * droop, head * droop
        legs = [('UpLegR', X, -scuff), ('LegR', X, scuff * 1.4), ('FootR', X, -scuff * 0.3)] if scuff else []
        return [('*', 'knees', bend), *legs, ('Spine1', X, spine), ('Spine2', X, spine * 0.4), ('ShoulderL', Y, 8), ('ShoulderR', Y, -8), *extra, *arms_,
                ('Neck', X, head * 0.9), ('Head', X, head), ('Head', Z, shake)]
    k = 14 if kick else 0
    keys = [(1, slump()), (13, slump(shake=15, scuff=k)), (21, slump(shake=4)), (29, slump(shake=-15, scuff=k)), (41, slump(shake=8)), (51, slump(spine=13, head=12)),
            (63, slump(spine=5, head=-6, arms_=sigh or arms)), (77, slump(spine=19, head=19))]
    clip(arm, 'sulk', [(f, pose(*st)) for f, st in keys] + [(91, pose(*keys[0][1]))])


def sit(height):
    """Sitting on something `height` metres up: hips down, thighs forward, shins down."""
    return [('Hips', 'shift', (0, 0.06, height - 0.97)), ('UpLegL', 'aim', (0.18, -1, 0.02)), ('UpLegR', 'aim', (-0.18, -1, 0.02)),
            ('LegL', 'aim', (0.06, -0.12, -1)), ('LegR', 'aim', (-0.06, -0.12, -1)), ('FootL', 'aim', (0.1, -1, -0.2)), ('FootR', 'aim', (-0.1, -1, -0.2))]


def gladiator(arm):
    idle(arm, [('Head', Z, 7), ('ArmL', X, -2.5), ('ArmR', X, 3)], [('Head', Z, -5), ('Head', X, 3), ('ArmL', X, -1)])
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
    # result screen: sword punched at the sky, shield up; in defeat the sword drags, tip on the sand
    sword_lo = [('ArmR', 'aim', (-1, -0.3, 0.15)), ('ForeArmR', 'aim', (-0.05, -0.3, 1))]
    sword_hi = [('ArmR', 'aim', (-0.25, -0.12, 1)), ('ForeArmR', 'aim', (-0.15, -0.1, 1)), ('Sword', 'aim', (-0.2, -0.3, 1))]
    shield_lo = [('ArmL', 'aim', (0.45, -0.55, -0.7)), ('ForeArmL', 'aim', (-0.2, -1, 0.25))]
    shield_hi = [('ArmL', 'aim', (0.8, -0.3, 0.5)), ('ForeArmL', 'aim', (0.3, -0.4, 0.85))]
    cheer(arm, lo=[*sword_lo, *shield_lo], hi=[*sword_hi, *shield_lo], top=[*sword_hi, *shield_hi], nod=(4, -16))
    sulk(arm, [('ArmR', 'aim', (-0.12, -0.08, -1)), ('ForeArmR', 'aim', (-0.05, -0.45, -1)), ('ArmL', 'aim', (0.14, -0.12, -1)), ('ForeArmL', 'aim', (0.1, -0.7, -0.7))])


def sniper(arm):
    idle(arm, [('Head', Z, 14), ('Head', X, -2)], [('Head', Z, -12)])
    # rifle held across the body, scanning down the range, a glance back, a shrug to settle the rifle
    def watch(head, spine=6, *extra):
        return [('Spine1', Z, spine), ('Spine1', X, -2), *extra, ('Head', Z, head[0]), ('Head', X, head[1])]
    loop(arm, [(1, watch((22, -3))), (25, watch((34, -5), 9)), (49, watch((30, -1), 8)), (69, watch((2, -2), 3)),
               (79, watch((4, -2), 3, ('ShoulderL', Y, -6), ('ShoulderR', Y, 6))), (87, watch((6, -2), 3)), (103, watch((14, -3), 5))])
    # result screen: the rifle pumped overhead, left fist with it; in defeat it hangs muzzle-down and he scuffs the dirt
    # the rifle stays raised flat over his hat (any higher and it swings end-on behind him); the left fist pumps
    rifle_lo = [('ArmR', 'aim', (-1, -0.3, 0.15)), ('ForeArmR', 'aim', (-0.05, -0.3, 1))]
    rifle_hi = [('ArmR', 'aim', (-0.95, -0.3, 0.4)), ('ForeArmR', 'aim', (-0.05, -0.3, 1))]
    fist_lo = [('ArmL', 'aim', (0.4, -0.5, -0.75)), ('ForeArmL', 'aim', (-0.25, -1, 0.35))]
    fist_hi = [('ArmL', 'aim', (0.55, -0.15, 0.55)), ('ForeArmL', 'aim', (0.15, -0.2, 1))]
    cheer(arm, lo=[*rifle_lo, *fist_lo], hi=[*rifle_hi, *fist_hi], top=[*rifle_hi, *fist_hi])
    sulk(arm, [('ArmR', 'aim', (-0.1, -0.05, -1)), ('ForeArmR', 'aim', (-0.05, -0.2, -1)), ('ArmL', 'aim', (0.12, -0.1, -1)), ('ForeArmL', 'aim', (0.05, -0.3, -1))], kick=True)


def pathfinder(arm):
    clip(arm, 'idle', [
        (1, REST),
        (24, pose(*BREATHE, ('Head', Z, -8), ('ForeArmL', X, -6), ('ForeArmR', X, -4))),
        (54, pose(('Spine1', X, -1), ('Head', Z, 9), ('Head', X, -3), ('ForeArmL', X, -2), ('ForeArmR', X, -7))),
        (91, REST),
    ])
    # low ready crouch, daggers out, rocking from side to side and checking over a shoulder
    def crouch(sway=0, lean=12, head=(-10, 0), arms=(-20, -10), *extra):
        return [('Hips', 'shift', (0, 0.03, -0.12)), ('UpLegL', X, -28), ('LegL', X, 30), ('UpLegR', X, -8), ('LegR', X, 26),
                ('Spine1', X, lean), ('Spine1', Z, sway), *extra, ('Head', X, head[0]), ('Head', Z, head[1] - sway),
                ('ArmL', X, arms[0]), ('ArmR', X, arms[1])]
    loop(arm, [(1, crouch()), (21, crouch(6, 15, (-12, 0), (-28, -6))), (41, crouch(0, 12, (-10, 0), (-20, -14))),
               (61, crouch(-6, 15, (-12, 0), (-16, -22))), (79, crouch(-2, 11, (-6, 34), (-18, -12))), (95, crouch(-2, 11, (-6, 30), (-20, -12))), (109, crouch(0, 12))])
    # result screen: daggers punched up one hand after the other, both up for the jump; in defeat, arms limp, a scuff
    up = [('ArmL', 'aim', (0.3, -0.12, 1)), ('ForeArmL', 'aim', (0.15, -0.1, 1))]
    low = [('ArmL', 'aim', (0.9, -0.35, -0.05)), ('ForeArmL', 'aim', (0.05, -0.35, 1))]
    cheer(arm, lo=[*up, *mirror(low)], hi=[*low, *mirror(up)], top=[('ArmL', 'aim', (0.6, -0.1, 0.85)), ('ForeArmL', 'aim', (0.5, -0.1, 0.9)), *mirror([('ArmL', 'aim', (0.6, -0.1, 0.85)), ('ForeArmL', 'aim', (0.5, -0.1, 0.9))])])
    hang = [('ArmL', 'aim', (0.14, -0.1, -1)), ('ForeArmL', 'aim', (0.06, -0.3, -1))]
    sulk(arm, [*hang, *mirror(hang)], kick=True, droop=1.15)


def pirate(arm):
    idle(arm, [('Head', Z, 9), ('Head', X, -3), ('ArmR', X, 3)], [('Head', Z, -7), ('ForeArmR', X, -4)])
    # one boot up on his treasure chest, leaning on the raised knee; a look round, then a laugh, head back
    def boot(lean=4, head=(-14, -8), *extra):
        return [('UpLegR', 'aim', (-0.04, -0.82, -0.3)), ('LegR', 'aim', (-0.03, -0.12, -1)), ('FootR', 'aim', (0, -1, -0.05)),
                ('Spine1', X, 12), ('Spine2', X, lean), *extra, ('Head', X, head[0]), ('Head', Z, head[1]),
                ('ArmR', 'aim', (-0.1, -0.55, -0.82)), ('ForeArmR', 'aim', (0.35, -1, -0.1))]
    loop(arm, [(1, boot()), (25, boot(4, (-10, 6))), (47, boot(4, (-12, 2))),
               (61, boot(-3, (-28, -4))), (67, boot(2, (-21, -4))), (73, boot(-3, (-28, -4))), (79, boot(2, (-21, -4))), (85, boot(-2, (-26, -4))),
               (99, boot(4, (-15, -10)))])
    # result screen: cutlass waved over his hat, laughing, left fist kept on his hip; in defeat a hand over his eyes
    cheer(arm, lo=[('ArmR', 'aim', (-0.6, -0.2, 0.8)), ('ForeArmR', 'aim', (-0.75, -0.2, 0.65))], hi=[('ArmR', 'aim', (-0.25, -0.15, 1)), ('ForeArmR', 'aim', (0.3, -0.15, 1)), ('HandR', 'aim', (0.5, -0.25, 1))],
          top=[('ArmR', 'aim', (-0.3, -0.1, 1)), ('ForeArmR', 'aim', (-0.1, -0.1, 1)), ('HandR', 'aim', (-0.05, -0.25, 1))], nod=(0, -22))
    sulk(arm, [('ArmL', 'aim', (-0.25, -0.85, -0.45)), ('ForeArmL', 'aim', (-0.3, 0.1, 1)), ('ArmR', 'aim', (-0.12, -0.08, -1)), ('ForeArmR', 'aim', (-0.05, -0.35, -1))])


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
    # result screen: wings beating over its head, hopping; in defeat, head sunk, wings hanging
    flap = [('ArmL', Y, 28), ('ArmR', Y, -28)]
    cheer(arm, lo=[*spread, *flap], hi=spread, top=[*spread, ('ArmL', Y, -14), ('ArmR', Y, 14)], nod=(10, -8), lean=4)
    sulk(arm, [('ArmL', X, -20), ('ArmR', X, -20), ('ArmL', Z, 12), ('ArmR', Z, -12)], extra=[('Neck', X, 16)])


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
    idle(arm, [('Head', Z, 10), ('Head', X, -2)], [('Head', Z, -8), ('Spine1', Z, 3)])
    # arms folded, chin up, waiting for a fight: looks round, taps a foot, nods
    def folded(head=(-6, 8), sway=0, *extra):
        return [('Spine1', Z, sway), *extra, ('ArmL', 'aim', (0.18, -0.35, -0.92)), ('ForeArmL', 'aim', (-1, -0.35, 0.18)), ('ArmR', 'aim', (-0.18, -0.38, -0.91)), ('ForeArmR', 'aim', (1, -0.45, 0.24)),
                ('Head', X, head[0]), ('Head', Z, head[1])]
    tap = ('FootR', X, -16)
    loop(arm, [(1, folded()), (25, folded((-4, 20), 3)), (47, folded((-9, 2), 1)),
               (61, folded((-8, 4), 0, tap)), (67, folded((-8, 4), 0)), (73, folded((-8, 4), 0, tap)), (79, folded((-8, 4), 0)), (85, folded((-8, 4), 0, tap)), (91, folded((-8, 4), 0)),
               (101, folded((2, 6), -2)), (111, folded((-6, 8), -1))])
    # result screen: right fist pumping, both arms up for the jump; hands on his head in defeat
    up = [('ArmR', 'aim', (-0.3, -0.12, 1)), ('ForeArmR', 'aim', (-0.2, -0.1, 1))]
    cheer(arm,
          lo=[('ArmR', 'aim', (-1, -0.3, 0.1)), ('ForeArmR', 'aim', (-0.05, -0.3, 1)), ('ArmL', 'aim', (0.35, -0.45, -0.8)), ('ForeArmL', 'aim', (-0.25, -1, 0.3))],
          hi=[*up, ('ArmL', 'aim', (0.45, -0.4, -0.7)), ('ForeArmL', 'aim', (0.0, -1, 0.55))],
          top=[*up, *mirror(up)])
    head = [('ArmL', 'aim', (0.5, -0.22, 0.84)), ('ForeArmL', 'aim', (-0.88, 0.02, 0.47))]
    sulk(arm, [*head, *mirror(head)], droop=0.7)


def make(name, arm):
    globals()[name](arm)
