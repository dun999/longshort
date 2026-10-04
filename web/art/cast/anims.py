"""Clips per class, all looping: idle (3 s), win (1.3 s), out (2 s). The hips never move (no IK on the feet):
motion lives in the spine, head and arms. Rotations are in character space (Blender: X left, -Y forward, Z up):
+X tips forward, -X raises a hanging arm forward/up, Z turns."""
from lib import aim, clip, turn

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)


def make(name, arm):
    def pose(*steps):
        """Steps: (bone, axis, deg) turns, or (bone, 'aim', direction[, roll]) aims."""
        def f(a):
            for st in steps:
                if st[1] == 'aim':
                    aim(a, st[0], st[2], st[3] if len(st) > 3 else 0.0)
                else:
                    turn(a, *st)
        return f

    rest = pose()
    breathe = [('Spine1', X, -2.2), ('Spine2', X, -1.2), ('ShoulderL', Y, -1.5), ('ShoulderR', Y, 1.5)]

    if name == 'tank':
        clip(arm, 'idle', [
            (1, rest),
            (31, pose(*breathe, ('Head', Z, 7), ('ArmL', X, -2.5), ('ArmR', X, 3))),
            (61, pose(('Spine1', X, -1), ('Head', Z, -5), ('Head', X, 3), ('ArmL', X, -1))),
            (91, rest),
        ])
        up = [('Spine1', X, -6), ('Head', X, -12), ('ArmR', X, -150), ('ArmR', Y, 18), ('ForeArmR', X, -25), ('ArmL', Y, -14)]
        clip(arm, 'win', [(1, pose(*up)), (20, pose(*up, ('ArmR', X, -14), ('Spine1', X, -3))), (40, pose(*up))])
        down = [('Spine1', X, 14), ('Neck', X, 16), ('Head', X, 12), ('ArmL', X, 22), ('ArmL', Y, 10), ('ArmR', X, 18)]
        clip(arm, 'out', [(1, pose(*down)), (31, pose(*down, ('Spine1', X, 2))), (61, pose(*down))])
    elif name == 'sniper':
        clip(arm, 'idle', [
            (1, rest),
            (31, pose(*breathe, ('Head', Z, 14), ('Head', X, -2))),
            (61, pose(('Spine1', X, -1), ('Head', Z, -12))),
            (91, rest),
        ])
        up = [('Spine1', X, -5), ('Head', X, -14), ('ArmR', 'aim', (-0.45, -0.1, 1)), ('ForeArmR', 'aim', (-0.15, -0.15, 1)), ('ArmL', 'aim', (0.55, -0.15, 0.55)), ('ForeArmL', 'aim', (0.15, -0.2, 1))]
        clip(arm, 'win', [(1, pose(*up)), (20, pose(*up, ('ArmR', Y, 10), ('ArmL', Y, -12))), (40, pose(*up))])
        down = [('Spine1', X, 14), ('Neck', X, 18), ('Head', X, 10), ('ArmR', X, 16), ('ArmL', X, 18)]
        clip(arm, 'out', [(1, pose(*down)), (31, pose(*down, ('Spine1', X, 2))), (61, pose(*down))])
    else:  # scout
        clip(arm, 'idle', [
            (1, rest),
            (24, pose(*breathe, ('Head', Z, -8), ('ForeArmL', X, -6), ('ForeArmR', X, -4))),
            (54, pose(('Spine1', X, -1), ('Head', Z, 9), ('Head', X, -3), ('ForeArmL', X, -2), ('ForeArmR', X, -7))),
            (91, rest),
        ])
        up = [('Spine1', X, -6), ('Head', X, -14), ('ArmL', Y, -150), ('ArmR', Y, 150), ('ForeArmL', Y, -20), ('ForeArmR', Y, 20)]
        clip(arm, 'win', [(1, pose(*up)), (20, pose(*up, ('ArmL', Y, 12), ('ArmR', Y, -12))), (40, pose(*up))])
        down = [('Spine1', X, 15), ('Neck', X, 18), ('Head', X, 10), ('ArmL', X, 12), ('ArmR', X, 12)]
        clip(arm, 'out', [(1, pose(*down)), (31, pose(*down, ('Spine1', X, 2))), (61, pose(*down))])
