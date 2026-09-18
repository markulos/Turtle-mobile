"""After the placeholder sweep, drop `TextInput` from the react-native import
of any file that no longer uses it. Companion to sweep-placeholders.py."""
import io
import os
import re

BARE_USE = re.compile(r'<TextInput\b|\bTextInput\.\w')
RN_IMPORT = re.compile(r'import[\s\S]*?from \'react-native\';')


def clean():
    cleaned = []
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
            if 'TextInput' not in src or BARE_USE.search(src):
                continue
            m = RN_IMPORT.search(src)
            if not m or 'TextInput' not in m.group(0):
                continue
            imp = m.group(0)
            fixed = re.sub(r'\n\s*TextInput,(?=\n)', '', imp)      # own line
            fixed = re.sub(r'\bTextInput,\s*', '', fixed)          # leading in a list
            fixed = re.sub(r',\s*TextInput\b', '', fixed)          # trailing in a list
            if fixed == imp:
                continue
            io.open(path, 'w', encoding='utf-8').write(src[:m.start()] + fixed + src[m.end():])
            cleaned.append(path)
    return cleaned


if __name__ == '__main__':
    out = clean()
    print('\n'.join(out) if out else 'none')
