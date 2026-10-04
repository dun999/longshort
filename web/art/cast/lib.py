"""
Low-poly character kit for Blender (headless). Everything is built from code so the cast can be
regenerated: faceted lofts and chamfered blocks, one colour per face (a float colour attribute),
one deform bone per part (rigid skinning, blended only along the spine), an "Accent" material
for the faces that take the player's colour at runtime.

Axes: Blender Z up, the character faces -Y, +X is the character's left. glTF export turns -Y
into +Z, so in three.js the character faces the default camera.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector

V = Vector


def lin(h):
    """#rrggbb (sRGB) to a linear RGBA tuple, which is what glTF COLOR_0 stores."""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def _hash(x, y, z, s=0):
    """Deterministic pseudo-random in [-1, 1] from a position (for facet jitter)."""
    n = math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453
    return (n - math.floor(n)) * 2 - 1


def camo(colors, scale=7.0, seed=0):
    """Blotchy per-face camouflage: low-frequency value noise picks one of the colours."""
    def f(q):
        x, y, z = q.x * scale, q.y * scale, q.z * scale
        n = math.sin(x * 1.7 + seed) + math.sin(y * 2.3 + z * 1.1 + seed * 2) + math.sin(z * 1.9 - x * 0.7 + seed * 3)
        n = (n / 3 + 1) / 2
        return colors[min(len(colors) - 1, int(n * len(colors)))]
    return f


def mirror_name(name):
    if name.endswith('L'):
        return name[:-1] + 'R'
    if name.endswith('R'):
        return name[:-1] + 'L'
    return name


class Kit:
    """Collects parts into one bmesh. A part = verts + faces + colour + bone (+ material)."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.dl = self.bm.verts.layers.deform.verify()
        self.groups = []  # bone names in vertex-group order
        self.mats = ['Body', 'Accent', 'Glow']

    def gi(self, bone):
        if bone not in self.groups:
            self.groups.append(bone)
        return self.groups.index(bone)

    def add(self, verts, faces, color, bone, mat='Body', jitter=0.0, mirror=False, weights=None, seed=0, deform=None, flip=False):
        """verts: list of Vector; faces: index lists (CCW seen from outside). weights(v) -> {bone: w} overrides bone.
        deform(q) -> q reshapes each vertex; flip reverses winding (inner linings)."""
        if flip:
            faces = [list(reversed(f)) for f in faces]
        for side in ([1, -1] if mirror else [1]):
            b = bone if side == 1 else mirror_name(bone)
            vs = []
            for p in verts:
                q = V(deform(V(p))) if deform else V(p)
                q = V((q.x * side, q.y, q.z))
                if jitter:
                    q += V((_hash(*q, seed), _hash(*q, seed + 1), _hash(*q, seed + 2))) * jitter
                v = self.bm.verts.new(q)
                if weights:
                    for bn, w in weights(q).items():
                        bn = bn if side == 1 else mirror_name(bn)
                        v[self.dl][self.gi(bn)] = w
                else:
                    v[self.dl][self.gi(b)] = 1.0
                vs.append(v)
            pick = color if callable(color) else None
            c = None if pick else (lin(color) if isinstance(color, str) else color)
            for f in faces:
                idx = f if side == 1 else list(reversed(f))
                try:
                    face = self.bm.faces.new([vs[i] for i in idx])
                except ValueError:
                    continue
                face.material_index = self.mats.index(mat)
                fc = lin(pick(face.calc_center_median())) if pick else c
                for loop in face.loops:
                    loop[self.col] = fc
        return self

    # ─── primitives (return verts, faces) ───────────────────────────────────

    @staticmethod
    def ring(c, U, W, rx, ry, n, sq=2.0, phase=None):
        phase = math.pi / n if phase is None else phase
        pts = []
        for k in range(n):
            a = phase + 2 * math.pi * k / n
            ca, sa = math.cos(a), math.sin(a)
            x = math.copysign(abs(ca) ** (2 / sq), ca) * rx
            y = math.copysign(abs(sa) ** (2 / sq), sa) * ry
            pts.append(c + U * x + W * y)
        return pts

    def loft(self, path, n=8, sq=2.0, side=V((1, 0, 0)), cap=(True, True), dome=(0, 0), phase=None):
        """path: list of (center, rx, ry) or (center, rx, ry, offset Vector). rx runs along `side`."""
        verts, faces = [], []
        pts = [V(p[0]) for p in path]
        for i, p in enumerate(path):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            U = (side - t * side.dot(t)).normalized()
            W = t.cross(U).normalized()
            verts += self.ring(pts[i], U, W, p[1], p[2], n, sq, phase)
        m = len(path)
        for i in range(m - 1):
            for k in range(n):
                a, b = i * n + k, i * n + (k + 1) % n
                faces.append([a, b, b + n, a + n])
        t0 = (pts[1] - pts[0]).normalized()
        t1 = (pts[-1] - pts[-2]).normalized()
        if cap[0]:
            if dome[0]:
                verts.append(pts[0] - t0 * dome[0])
                ci = len(verts) - 1
                faces += [[(k + 1) % n, k, ci] for k in range(n)]
            else:
                faces.append(list(reversed(range(n))))
        if cap[1]:
            base = (m - 1) * n
            if dome[1]:
                verts.append(pts[-1] + t1 * dome[1])
                ci = len(verts) - 1
                faces += [[base + k, base + (k + 1) % n, ci] for k in range(n)]
            else:
                faces.append([base + k for k in range(n)])
        return verts, faces

    @staticmethod
    def box(c, size, chamfer=0.0, M=None, taper=(1, 1)):
        """Axis box centred at c (size x,y,z) with an optional chamfer on every edge; taper scales the top face."""
        sx, sy, sz = (s / 2 for s in size)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            top = v.co.z > 0
            k = taper if top else (1, 1)
            v.co = V((v.co.x * 2 * sx * k[0], v.co.y * 2 * sy * k[1], v.co.z * 2 * sz))
        if chamfer:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=chamfer, segments=1, affect='EDGES', profile=0.5, clamp_overlap=True)
        M = M or Matrix.Identity(4)
        verts = [M @ v.co + V(c) for v in bm.verts]
        idx = {v: i for i, v in enumerate(bm.verts)}
        faces = [[idx[v] for v in f.verts] for f in bm.faces]
        bm.free()
        return verts, faces

    @staticmethod
    def disc(c, r, h, n=12, M=None, r_top=None):
        """Flat cylinder (axis Z before M) centred at c."""
        r_top = r if r_top is None else r_top
        M = M or Matrix.Identity(4)
        verts = []
        for z, rr in ((-h / 2, r), (h / 2, r_top)):
            for k in range(n):
                a = 2 * math.pi * k / n + math.pi / n
                verts.append(M @ V((math.cos(a) * rr, math.sin(a) * rr, z)) + V(c))
        faces = [[k, (k + 1) % n, n + (k + 1) % n, n + k] for k in range(n)]
        faces.append(list(reversed(range(n))))
        faces.append([n + k for k in range(n)])
        return verts, faces

    @staticmethod
    def dome(c, rx, ry, rz, n=8, rings=3, M=None, flat=0.0):
        """Half ellipsoid (bulging +Z before M), base open-capped."""
        M = M or Matrix.Identity(4)
        verts, faces = [], []
        for j in range(rings):
            phi = (j / rings) * (math.pi / 2)
            for k in range(n):
                a = 2 * math.pi * k / n + math.pi / n
                verts.append(M @ V((math.cos(a) * rx * math.cos(phi), math.sin(a) * ry * math.cos(phi), rz * math.sin(phi) - flat)) + V(c))
        verts.append(M @ V((0, 0, rz - flat)) + V(c))
        top = len(verts) - 1
        for j in range(rings - 1):
            for k in range(n):
                a, b = j * n + k, j * n + (k + 1) % n
                faces.append([a, b, b + n, a + n])
        base = (rings - 1) * n
        faces += [[base + k, base + (k + 1) % n, top] for k in range(n)]
        faces.append(list(reversed(range(n))))
        return verts, faces

    # ─── finish ─────────────────────────────────────────────────────────────

    def build(self, arm_obj=None, materials=None):
        me = bpy.data.meshes.new(self.name)
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        for g in self.groups:
            obj.vertex_groups.new(name=g)
        bmesh.ops.remove_doubles(self.bm, verts=list(self.bm.verts), dist=1e-5)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(materials[m] if materials else material(m))
        if me.color_attributes.get('Col'):
            me.color_attributes.active_color = me.color_attributes['Col']
            me.color_attributes.render_color_index = me.color_attributes.find('Col')
        # drop material slots nothing uses (keeps primitives per mesh minimal)
        used = {p.material_index for p in me.polygons}
        for i in reversed(range(len(me.materials))):
            if i not in used:
                for p in me.polygons:
                    if p.material_index > i:
                        p.material_index -= 1
                me.materials.pop(index=i)
        if arm_obj:
            obj.parent = arm_obj
            mod = obj.modifiers.new('Armature', 'ARMATURE')
            mod.object = arm_obj
        return obj


_MATS = {}


def material(name):
    try:
        if name in _MATS and _MATS[name].name:
            return _MATS[name]
    except ReferenceError:  # the scene was reset between characters
        pass
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if name == 'Body':
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    elif name == 'Accent':
        bsdf.inputs['Base Color'].default_value = lin('#7c5cff')
    else:
        bsdf.inputs['Base Color'].default_value = lin('#ffd27a')
        bsdf.inputs['Emission Color'].default_value = lin('#ffd27a')
        bsdf.inputs['Emission Strength'].default_value = 2.0
    bsdf.inputs['Roughness'].default_value = 0.9
    _MATS[name] = m
    return m


# ─── skeleton ───────────────────────────────────────────────────────────────

def armature(name, bones):
    """bones: list of (name, head, tail, parent). Returns the armature object (rest = modelled stance)."""
    arm = bpy.data.armatures.new(name + 'Rig')
    obj = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bn, h, t, parent in bones:
        b = arm.edit_bones.new(bn)
        b.head, b.tail = V(h), V(t)
        b.roll = 0
        if parent:
            b.parent = eb[parent]
        eb[bn] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def spine_weights(levels):
    """Blend between spine bones by height. levels: list of (z, bone) bottom→top."""
    def w(q):
        z = q.z
        if z <= levels[0][0]:
            return {levels[0][1]: 1.0}
        for (z0, b0), (z1, b1) in zip(levels, levels[1:]):
            if z <= z1:
                k = (z - z0) / (z1 - z0)
                return {b0: 1 - k, b1: k} if b0 != b1 else {b0: 1.0}
        return {levels[-1][1]: 1.0}
    return w


# ─── posing ─────────────────────────────────────────────────────────────────

def pose_reset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def turn(arm, bone, axis, deg):
    """Rotate a pose bone about a character-space axis through its head (applied on top of its current pose)."""
    pb = arm.pose.bones[bone]
    M = pb.matrix.copy()
    piv = M.translation.copy()
    R = Matrix.Rotation(math.radians(deg), 4, V(axis).normalized())
    pb.matrix = Matrix.Translation(piv) @ R @ Matrix.Translation(-piv) @ M
    bpy.context.view_layer.update()


def shift(arm, bone, offset):
    pb = arm.pose.bones[bone]
    M = pb.matrix.copy()
    M.translation += V(offset)
    pb.matrix = M
    bpy.context.view_layer.update()


def aim(arm, bone, direction, roll=0.0):
    """Swing a pose bone (shortest arc) so it points along a character-space direction, then roll it about itself."""
    pb = arm.pose.bones[bone]
    cur = (pb.tail - pb.head).normalized()
    axis, ang = cur.rotation_difference(V(direction).normalized()).to_axis_angle()
    if ang > 1e-4:
        turn(arm, bone, axis, math.degrees(ang))
    if roll:
        turn(arm, bone, pb.tail - pb.head, roll)


def clip(arm, name, keys, fps=30):
    """keys: list of (frame, pose_fn(arm)). Bakes each pose into quaternion/location keys of a new action on an NLA track."""
    bpy.context.scene.render.fps = fps
    arm.animation_data_create()
    arm.animation_data.use_nla = False  # earlier clips' tracks must not leak into this bake
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    for frame, fn in keys:
        pose_reset(arm)
        fn(arm)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, int(keys[0][0]), act)
    arm.animation_data.action = None
    pose_reset(arm)
    arm.animation_data.use_nla = True
    return act
