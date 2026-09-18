"""Give every light-mode surface its depth (utils/surfaceDepth).

Finds style blocks that paint a themed fill AND round their corners — the
app's cards, panels, chips and rows — and spreads `...depth(theme, LEVEL)`
into them. The level comes from the block's NAME, which in this codebase is
reliably descriptive (card / chip / sheet / menu).

Deliberately skipped:
  • anything drawn from `pal.*` — the inset-card palette. docs/STYLE-RULES.md
    §1 says task cards carry NO drop shadow in either mode: they are recesses
    lit from the top edge, and a drop shadow would turn them back into slabs.
  • blocks that already declare a shadow of their own.
  • blocks whose file has no `theme` in scope to switch on.

Run with --apply to write; without it, prints the plan.
"""
import io
import os
import re
import sys

FILL = re.compile(r'backgroundColor:\s*(theme\.colors|c|colors|pal)\.(surface|surfaceElevated|background|card)\b')
RADIUS = re.compile(r'borderRadius:')
HAS_SHADOW = re.compile(r'shadowColor|elevation:')

# Name → level. First match wins, so the specific patterns come first.
RULES = [
    ('overlay', r'sheet|modal|dialog|overlay|popup'),
    ('raised', r'menu|suggest|autocomplete|dropdown|fab|banner|toast|tooltip|hint|popover|float'),
    ('control', r'chip|pill|btn|button|key|badge|avatar|input|circle|toggle|thumb|stepper|switch|opt|tab|icon|fab'),
    ('card', r'.'),
]


# Names the pattern list gets wrong. A search FIELD is a control however it is
# spelled, and a "sheet cancel" is a button inside a sheet, not a sheet.
OVERRIDES = {
    'searchRow': 'control',
    'searchBox': 'control',
    'friendSearchBox': 'control',
    'shareSheetCancel': 'control',
}


def level_for(name):
    if name in OVERRIDES:
        return OVERRIDES[name]
    low = name.lower()
    for level, pattern in RULES:
        if re.search(pattern, low):
            return level
    return 'card'


# The stylesheet factory this block lives in must actually take a `theme`.
FACTORY = re.compile(r'(?:const\s+\w+\s*=\s*\(([^)]*)\)\s*=>|function\s+\w+\s*\(([^)]*)\))')


def theme_in_scope(src, index):
    """Does the function enclosing `index` take a parameter named `theme`?"""
    best = None
    for m in FACTORY.finditer(src, 0, index):
        best = (m.group(1) or m.group(2) or '')
    return best is not None and re.search(r'\btheme\b', best) is not None


def import_path(path):
    if path.startswith('components/'):
        return '../utils/surfaceDepth'
    return '../' * (path.count('/')) + 'utils/surfaceDepth'


def plan():
    jobs = []
    for dirpath, _dirnames, filenames in os.walk('.'):
        norm = dirpath.replace(os.sep, '/')
        if 'node_modules' in norm or '__tests__' in norm:
            continue
        if not (norm.startswith('./screens') or norm.startswith('./components')):
            continue
        for fn in sorted(filenames):
            if not fn.endswith(('.jsx', '.js')):
                continue
            path = (norm + '/' + fn)[2:]
            src = io.open(path, encoding='utf-8').read()
            edits = []
            for m in re.finditer(r'^(\s+)([A-Za-z0-9_]+):\s*\{\n([\s\S]*?)^\1\},', src, re.M):
                indent, name, body = m.group(1), m.group(2), m.group(3)
                fill = FILL.search(body)
                if not fill or not RADIUS.search(body):
                    continue
                if HAS_SHADOW.search(body):
                    continue
                if fill.group(1) == 'pal':
                    continue                      # inset task cards: no shadow, by rule
                if not theme_in_scope(src, m.start()):
                    print('  -- %s: %s has no `theme` in scope' % (path, name))
                    continue
                edits.append((m.end(), indent, name, level_for(name)))
            if edits:
                jobs.append((path, src, edits))
    return jobs


def apply(jobs):
    touched = 0
    for path, src, edits in jobs:
        out = src
        # Back to front, so the offsets stay valid.
        for end, indent, name, level in sorted(edits, key=lambda e: -e[0]):
            insert = '%s  ...depth(theme, \'%s\'),\n' % (indent, level)
            close = out.rindex(indent + '},', 0, end)
            out = out[:close] + insert + out[close:]
        if "utils/surfaceDepth'" not in out:
            m = re.search(r"^import[\s\S]{0,600}?from 'react-native';", out, re.M)
            if not m:
                print('  !! %s: nowhere to anchor the import' % path)
                continue
            out = out[:m.end()] + ("\nimport { depth } from '%s';" % import_path(path)) + out[m.end():]
        io.open(path, 'w', encoding='utf-8').write(out)
        touched += 1
    return touched


if __name__ == '__main__':
    jobs = plan()
    total = sum(len(e) for _p, _s, e in jobs)
    for path, _src, edits in jobs:
        by = {}
        for _end, _i, name, level in edits:
            by.setdefault(level, []).append(name)
        print('%-60s %s' % (path, '  '.join('%s:%s' % (k, ','.join(v)) for k, v in sorted(by.items()))))
    print('\n%d blocks in %d files' % (total, len(jobs)))
    if '--apply' in sys.argv:
        print('applied to %d files' % apply(jobs))
