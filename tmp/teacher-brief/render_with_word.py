"""Use the packaged DOCX renderer with Word's Windows PDF converter.

This runtime bundles no LibreOffice on Windows. The PNG stage and document
geometry checks are kept in the packaged render_docx implementation.
"""
from pathlib import Path
import importlib.util
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path('C:/Users/tani/.cache/codex-runtimes/codex-primary-runtime/dependencies')
SKILL = Path('C:/Users/tani/.codex/plugins/cache/openai-primary-runtime/documents/26.1025.11240/skills/documents')
os.environ['PATH'] = str(RUNTIME / 'native/poppler/Library/bin') + os.pathsep + os.environ.get('PATH', '')
spec = importlib.util.spec_from_file_location('render_docx', SKILL / 'render_docx.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

def word_to_pdf(doc_path, user_profile, convert_tmp_dir, stem, verbose=False):
    pdf = Path(convert_tmp_dir) / (stem + '.pdf')
    result = subprocess.run([
        'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        str(Path(__file__).with_name('export_word.ps1')),
        '-InputDocx', str(doc_path), '-OutputPdf', str(pdf),
    ], capture_output=True, text=True, errors='replace', timeout=90)
    logs = result.stdout + result.stderr
    if result.returncode:
        raise RuntimeError(logs)
    print(logs.strip())
    return str(pdf), logs

renderer.convert_to_pdf = word_to_pdf
renderer.main()
