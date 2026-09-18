"""One-off sweep: TextInput placeholder prop -> components/AppTextInput.

Finds every TextInput that owns a `placeholder` prop, renames the tag, and adds
the import. Skips expo-image placeholders (blurhash), props forwarded to other
components, and the fields already on the shared component.

Kept in the repo as the record of what the sweep touched; re-running it is a
no-op because a converted tag no longer reads `<TextInput`.
"""
import io
import os
import re

SKIP_FILES = {
    # expo-image `placeholder` (blurhash / cover uri) — not a TextInput.
    'screens/TurtleScreen/components/PhotoGrid/GridCell.jsx',
    'screens/TurtleScreen/components/PhotoVaultBoardCard.jsx',
    'screens/TurtleScreen/components/PhotoViewer/ViewerPage.jsx',
    # A `placeholder` STRING handed to another component, not to an input.
    'screens/TasksScreen/components/CalendarView.jsx',
    # Converted by hand (each has its own hand-rolled placeholder overlay).
    'screens/TasksScreen/components/TaskFinderOverlay.jsx',
    'screens/TasksScreen/components/OverviewPage.jsx',
    'screens/TurtleScreen/components/PhotoVaultBoardsPage.jsx',
}


def import_path(path):
    if path.startswith('components/'):
        return './AppTextInput'
    return '../' * (path.count('/')) + 'components/AppTextInput'


def sweep():
    report = []
    for dirpath, _dirnames, filenames in os.walk('.'):
        norm = dirpath.replace('\\', '/')
        if 'node_modules' in norm or '__tests__' in norm or '/.git' in norm:
            continue
        if not (norm.startswith('./screens') or norm.startswith('./components')):
            continue
        for fn in sorted(filenames):
            if not fn.endswith(('.jsx', '.js')):
                continue
            path = (norm + '/' + fn)[2:]
            if path in SKIP_FILES:
                continue
            src = io.open(path, encoding='utf-8').read()
            if 'placeholder=' not in src:
                continue

            lines = src.split('\n')
            converted = 0
            for i, line in enumerate(lines):
                if not re.search(r'\bplaceholder=', line):
                    continue
                # Walk up to the element that owns this prop.
                owner = None
                done_already = False
                j = i
                while j >= 0 and i - j < 40:
                    if '<TextInput' in lines[j]:
                        owner = j
                        break
                    if '<AppTextInput' in lines[j]:
                        done_already = True
                        break
                    if re.search(r'<[A-Z][A-Za-z0-9_]*', lines[j]):
                        break  # some other element opened first
                    j -= 1
                if done_already:
                    continue
                if owner is None:
                    report.append('  -- %s:%d  %s' % (path, i + 1, line.strip()[:64]))
                    continue
                lines[owner] = lines[owner].replace('<TextInput', '<AppTextInput', 1)
                converted += 1

            if not converted:
                continue
            out = '\n'.join(lines)
            if "components/AppTextInput'" not in out and "./AppTextInput'" not in out:
                # The react-native import is usually a multi-line brace list.
                m = re.search(r"^import[\s\S]{0,400}?from 'react-native';", out, re.M)
                if not m:
                    report.append('  !! %s: no react-native import to anchor to' % path)
                    continue
                out = out[:m.end()] + ("\nimport AppTextInput from '%s';" % import_path(path)) + out[m.end():]
            io.open(path, 'w', encoding='utf-8').write(out)
            report.append('  ok %s  (%d)' % (path, converted))
    return report


if __name__ == '__main__':
    print('\n'.join(sweep()))
