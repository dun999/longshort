"""
Builds the arena cast and exports one GLB per class into web/public/models/.
Run: blender -b --factory-startup --python web/art/cast/build.py [-- gladiator sniper ...]
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ next to the sources
sys.path.insert(0, HERE)
CAST = ['gladiator', 'sniper', 'pathfinder', 'pirate', 'pigeon', 'keone']
for m in [m for m in list(sys.modules) if m in ('lib', 'parts', 'footholds', 'anims', *CAST)]:
    del sys.modules[m]

import anims  # noqa: E402
import footholds  # noqa: E402

OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'models'))
os.makedirs(OUT, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
names = argv or [n for n in CAST if os.path.exists(os.path.join(HERE, f'{n}.py'))]


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_yup=True, export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_normals=False,
        export_texcoords=False, export_materials='EXPORT', export_force_sampling=True, export_optimize_animation_size=True,
    )
    tris = sum(len(p.vertices) - 2 for o in objs if o.type == 'MESH' for p in o.data.polygons)
    print(f'EXPORT {name}: {os.path.getsize(path) // 1024} KB, {tris} tris')


for n in names:
    clear()
    mod = __import__(n)
    arm, body, *rest = mod.build()
    props = rest[0] if rest else []
    anims.make(n, arm)
    base = footholds.make(n)
    export(n, [arm, body, base, *props])
