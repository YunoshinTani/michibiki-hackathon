from pathlib import Path
import json

from docx import Document
from docx.shared import Mm, Pt, RGBColor
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'teacher-brief'
OUT.mkdir(parents=True, exist_ok=True)
STEM = '2026-10-29_先生向け提案概要'
FONT = 'BIZ UDPゴシック'

title = 'みちびきを活用した作業ロボットの提案概要'
intro = (
    '共通の移動ロボットに、用途に応じた作業モジュールを付け替える案です。'
    'モジュールを追加販売し、清掃や除雪などに使い分けることで、年間の稼働率を高めることを目指します。'
    'まずは、みちびき受信機を用いた自動移動の実演に取り組みます。'
)
background = (
    '大阪の花火大会で、会場に残されたごみを人が収集していることが着想のきっかけです。'
    '地元の長岡花火にも関連づけ、会場の清掃などを担う人の作業負担を軽減できないかと考えています。'
    '想定する利用者は、イベント会場や屋外施設の管理者です。'
)
rows = [
    ['区分', '構想', '今回の取り組み'],
    ['共通の移動ベース', '足回りとみちびき受信機を中心に構成', '自動移動を実演'],
    ['作業モジュール', '用途に応じて付け替え、追加販売', '今回は製作しない'],
]
modules = '候補は、ごみ拾い、草刈り、ライン引き、除雪、荷物保持、路面清掃、ボール回収、自動散水です。荷物の運搬・配達への応用も検討します。'
demo = (
    '足回りとみちびき受信機を用いた自動移動を実演します。'
    '具体的な走行制御、電源、受信機の仕様、実演場所は今後検討します。'
)
validation = (
    '検証案として、設定した経路に沿って移動・停止できるかを確認し、経路からのずれや繰り返し走行の結果を記録します。'
    '実演時の速度や緊急停止方法も相談したいと考えています。'
)
business = (
    'ごみ拾いだけでは利用機会が限られるため、季節や用途に合わせたモジュールの販売で利益を出す方針です。'
    '価格、製作費、販売先、販売台数は未定であり、収益性は今後検証します。'
)
questions = [
    '今回の製作範囲と実演目標は、授業の課題として適切か。',
    '必要な位置精度に対して、みちびきのどの機能と受信機を使うべきか。走行制御や安全対策をどう構成するか。',
    '最初に想定する顧客と用途をどこに絞り、モジュール販売の採算をどう確かめるか。',
]
research = '調査候補　長岡花火財団の決算資料から関連費用の記載を確認し、清掃の負担や導入余地を考える手がかりにします。'

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Mm(210), Mm(297)
sec.top_margin, sec.bottom_margin = Mm(15), Mm(15)
sec.left_margin, sec.right_margin = Mm(18), Mm(18)
sec.header_distance, sec.footer_distance = Mm(6), Mm(6)

for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'List Bullet']:
    st = doc.styles[name]
    st.font.name = FONT
    st.font.color.rgb = RGBColor(0, 0, 0)
    st.font.underline = False
    st.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), FONT)
    st.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:ascii'), FONT)
    st.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:hAnsi'), FONT)
normal = doc.styles['Normal']
normal.font.size = Pt(11)
normal.paragraph_format.line_spacing = 1.13
normal.paragraph_format.space_after = Pt(4)
normal.paragraph_format.widow_control = True
doc.styles['Title'].font.size = Pt(18)
doc.styles['Title'].font.bold = True
doc.styles['Title'].paragraph_format.space_after = Pt(4)
doc.styles['Title'].paragraph_format.line_spacing = 1.05
doc.styles['Title'].paragraph_format.keep_with_next = True
heading = doc.styles['Heading 1']
heading.font.size = Pt(11.5)
heading.font.bold = True
heading.paragraph_format.space_before = Pt(8)
heading.paragraph_format.space_after = Pt(3)
heading.paragraph_format.keep_with_next = True

# Keep Japanese text metrics stable in Word rather than snapping to its document grid.
for st in [normal, heading, doc.styles['Title']]:
    pg = st.element.get_or_add_pPr()
    snap = OxmlElement('w:snapToGrid')
    snap.set(qn('w:val'), '0')
    pg.append(snap)

doc.core_properties.title = title
doc.core_properties.subject = 'モジュール交換式ロボットの構想と自動移動の実演に関する先生への相談資料'
doc.core_properties.author = ''
doc.core_properties.last_modified_by = ''
doc.core_properties.comments = ''
doc.add_paragraph(title, 'Title')
meta = doc.add_paragraph('メカトロニクス　先生への相談資料　2026年10月29日')
meta.paragraph_format.space_after = Pt(8)
for run in meta.runs:
    run.font.size = Pt(9)
doc.add_paragraph(intro)

doc.add_heading('ねらいと地域とのつながり', level=1)
doc.add_paragraph(background)

doc.add_heading('製品構成と将来の用途', level=1)
table = doc.add_table(rows=0, cols=3)
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.autofit = False
widths = [36, 94, 44]
for col, width in zip(table.columns, widths):
    col.width = Mm(width)

tblpr = table._tbl.tblPr
borders = OxmlElement('w:tblBorders')
for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
    bd = OxmlElement(f'w:{side}')
    bd.set(qn('w:val'), 'single')
    bd.set(qn('w:sz'), '4')
    bd.set(qn('w:color'), 'D9D9D9')
    borders.append(bd)
tblpr.append(borders)
margins = OxmlElement('w:tblCellMar')
for side, value in [('top', '75'), ('bottom', '75'), ('left', '90'), ('right', '90')]:
    el = OxmlElement(f'w:{side}')
    el.set(qn('w:w'), value)
    el.set(qn('w:type'), 'dxa')
    margins.append(el)
tblpr.append(margins)
for i, vals in enumerate(rows):
    row = table.add_row()
    pr = row._tr.get_or_add_trPr()
    pr.append(OxmlElement('w:cantSplit'))
    if i == 0:
        pr.append(OxmlElement('w:tblHeader'))
    for cell, value, width in zip(row.cells, vals, widths):
        cell.width = Mm(width)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        cell.text = value
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.line_spacing = 1.1
        for run in p.runs:
            run.font.size = Pt(9.5)
            run.font.bold = i == 0
        if i == 0:
            shade = OxmlElement('w:shd')
            shade.set(qn('w:fill'), 'E8EDF2')
            cell._tc.get_or_add_tcPr().append(shade)
mp = doc.add_paragraph(modules)
mp.paragraph_format.space_before = Pt(5)

doc.add_heading('今回の実演と確認したいこと', level=1)
doc.add_paragraph(demo)
doc.add_paragraph(validation)

doc.add_heading('収益の考え方', level=1)
doc.add_paragraph(business)

doc.add_heading('先生に相談したい点', level=1)
for number, question in enumerate(questions, 1):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Mm(5)
    p.paragraph_format.first_line_indent = Mm(-5)
    p.paragraph_format.space_after = Pt(3)
    p.add_run(f'{number}　{question}')
rp = doc.add_paragraph(research)
rp.paragraph_format.space_before = Pt(4)
rp.paragraph_format.space_after = Pt(0)
for run in rp.runs:
    run.font.size = Pt(9)

path = OUT / f'{STEM}.docx'
# The bundled blank template contains inherited blue paragraph rules.
# Remove that residue so hierarchy is expressed only by black type and spacing.
for tree in [doc.styles.element, doc.element]:
    for border in tree.xpath('.//w:pBdr'):
        border.getparent().remove(border)
doc.save(path)

# A plain-text copy beside the meeting notes supports later revision.
md = [f'# {title}', '', 'メカトロニクス　先生への相談資料　2026年10月29日', '', intro, '',
      '## ねらいと地域とのつながり', '', background, '',
      '## 製品構成と将来の用途', '',
      '| 区分 | 構想 | 今回の取り組み |', '| --- | --- | --- |']
md.extend('| ' + ' | '.join(row) + ' |' for row in rows[1:])
md.extend(['', modules, '', '## 今回の実演と確認したいこと', '', demo, '', validation, '',
           '## 収益の考え方', '', business, '', '## 先生に相談したい点', ''])
md.extend(f'{i}. {question}' for i, question in enumerate(questions, 1))
md.extend(['', research, ''])
(ROOT / 'docs' / f'{STEM}.md').write_text('\n'.join(md), encoding='utf-8')
print(json.dumps({'docx': str(path), 'body_characters': len(''.join([intro, background, modules, demo, validation, business, *questions, research]))}, ensure_ascii=False))
