#!/usr/bin/env python3
"""Generate the canonical Respondus Word and PDF fixture corpus."""

from __future__ import annotations

from argparse import ArgumentParser
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageDraw
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


FIXED_TIME = datetime(2026, 7, 27, tzinfo=UTC)
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def configure_document(document: Document, title: str) -> None:
    """Apply the compact-reference-guide fixture preset."""
    section = document.sections[0]
    section.start_type = WD_SECTION.NEW_PAGE
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.85)

    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(31, 41, 55)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    normal.paragraph_format.line_spacing = Pt(14)

    properties = document.core_properties
    properties.title = title
    properties.subject = "QFlow Respondus import fixture"
    properties.author = "QFlow"
    properties.last_modified_by = "QFlow"
    properties.created = FIXED_TIME
    properties.modified = FIXED_TIME


def add_lines(document: Document, lines: tuple[str, ...]) -> None:
    for line in lines:
        document.add_paragraph(line)


def save_visible_numbering(output_dir: Path) -> None:
    document = Document()
    configure_document(document, "Respondus visible numbering fixture")
    add_lines(
        document,
        (
            "Title: Word question",
            "1. Which protocol carries web pages?",
            "*a. HTTP",
            "b. SMTP",
            "c. SSH",
            "Type: F",
            "Title: Word short answer",
            "2. What does HTTP stand for?",
            "a. Hypertext Transfer Protocol",
        ),
    )
    save_document(document, output_dir / "word-visible-numbering.docx")


def append_numbering_definition(
    document: Document,
    *,
    abstract_id: int,
    num_id: int,
    number_format: str,
    level_text: str,
    left_twips: int,
) -> None:
    numbering = document.part.numbering_part.element
    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi_level = OxmlElement("w:multiLevelType")
    multi_level.set(qn("w:val"), "singleLevel")
    abstract.append(multi_level)

    level = OxmlElement("w:lvl")
    level.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    level.append(start)
    num_format = OxmlElement("w:numFmt")
    num_format.set(qn("w:val"), number_format)
    level.append(num_format)
    level_label = OxmlElement("w:lvlText")
    level_label.set(qn("w:val"), level_text)
    level.append(level_label)
    suffix = OxmlElement("w:suff")
    suffix.set(qn("w:val"), "space")
    level.append(suffix)
    paragraph_properties = OxmlElement("w:pPr")
    indentation = OxmlElement("w:ind")
    indentation.set(qn("w:left"), str(left_twips))
    indentation.set(qn("w:hanging"), "360")
    paragraph_properties.append(indentation)
    level.append(paragraph_properties)
    abstract.append(level)
    numbering.append(abstract)

    number = OxmlElement("w:num")
    number.set(qn("w:numId"), str(num_id))
    abstract_reference = OxmlElement("w:abstractNumId")
    abstract_reference.set(qn("w:val"), str(abstract_id))
    number.append(abstract_reference)
    numbering.append(number)


def apply_numbering(paragraph, num_id: int) -> None:
    properties = paragraph._p.get_or_add_pPr()
    num_properties = properties.find(qn("w:numPr"))
    if num_properties is None:
        num_properties = OxmlElement("w:numPr")
        properties.append(num_properties)
    level = OxmlElement("w:ilvl")
    level.set(qn("w:val"), "0")
    number = OxmlElement("w:numId")
    number.set(qn("w:val"), str(num_id))
    num_properties.append(level)
    num_properties.append(number)


def save_automatic_numbering(output_dir: Path) -> None:
    document = Document()
    configure_document(document, "Word automatic numbering fixture")
    append_numbering_definition(
        document,
        abstract_id=72,
        num_id=72,
        number_format="lowerLetter",
        level_text="%1.",
        left_twips=720,
    )
    document.add_paragraph("Type: MA")
    document.add_paragraph("Which protocol carries web pages?", style="List Number")
    for choice in ("HTTP", "SMTP", "SSH"):
        paragraph = document.add_paragraph(choice)
        apply_numbering(paragraph, 72)
    save_document(document, output_dir / "word-automatic-numbering.docx")


def save_embedded_media(output_dir: Path) -> None:
    document = Document()
    configure_document(document, "Respondus embedded media fixture")
    add_lines(
        document,
        (
            "Title: Word image question",
            "1. Which line ends at the highest value?",
        ),
    )
    media_paragraph = document.add_paragraph()
    media_paragraph.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    media_paragraph.paragraph_format.line_spacing = 1
    media_paragraph.paragraph_format.space_after = Pt(8)
    inline_shape = media_paragraph.add_run().add_picture(
        fixture_chart(),
        width=Inches(2.75),
    )
    inline_shape._inline.docPr.set(
        "descr",
        "Line chart used by the Respondus media fixture",
    )
    add_lines(
        document,
        (
            "*a. Blue",
            "b. Orange",
            "c. Gray",
        ),
    )
    save_document(document, output_dir / "word-embedded-media.docx")


def fixture_chart() -> BytesIO:
    image = Image.new("RGB", (600, 240), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    draw.line((50, 200, 560, 200), fill="#94A3B8", width=3)
    draw.line((50, 30, 50, 200), fill="#94A3B8", width=3)
    draw.line((60, 175, 220, 135, 380, 90, 550, 45), fill="#2563EB", width=8)
    draw.line((60, 150, 220, 125, 380, 140, 550, 120), fill="#F97316", width=8)
    draw.line((60, 95, 220, 105, 380, 110, 550, 150), fill="#64748B", width=8)
    stream = BytesIO()
    image.save(stream, format="PNG", dpi=(144, 144))
    stream.seek(0)
    return stream


def draw_wrapped_text(
    canvas: Canvas,
    text: str,
    *,
    x: float,
    y: float,
    max_width: float,
    font: str,
    size: float,
    leading: float,
) -> float:
    words = text.split()
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and stringWidth(candidate, font, size) > max_width:
            canvas.drawString(x, y, line)
            y -= leading
            line = word
        else:
            line = candidate
    if line:
        canvas.drawString(x, y, line)
        y -= leading
    return y


def save_loose_pdf_control(output_dir: Path) -> None:
    path = output_dir / "loose-numbered-quiz.pdf"
    canvas = Canvas(str(path), pagesize=LETTER, pageCompression=1, invariant=1)
    width, height = LETTER
    margin = 54
    canvas.setTitle("Loose numbered quiz negative control")
    canvas.setAuthor("QFlow")
    canvas.setSubject("Negative control for Respondus detection")

    canvas.setFillColor(HexColor("#0F172A"))
    canvas.setFont("Helvetica-Bold", 18)
    canvas.drawString(margin, height - 62, "Loose numbered quiz")
    canvas.setFillColor(HexColor("#475569"))
    canvas.setFont("Helvetica", 9)
    canvas.drawString(margin, height - 79, "Negative control: no Respondus-specific markers")
    canvas.setStrokeColor(HexColor("#CBD5E1"))
    canvas.line(margin, height - 90, width - margin, height - 90)

    y = height - 124
    canvas.setFillColor(HexColor("#1F2937"))
    canvas.setFont("Helvetica", 11)
    for line in (
        "1. Which protocol carries web pages?",
        "a. HTTP",
        "b. SMTP",
        "c. SSH",
        "",
        "2. What does HTTP stand for?",
        "a. Hypertext Transfer Protocol",
        "b. High Transfer Text Process",
        "c. Hosted Transmission Protocol",
    ):
        if not line:
            y -= 8
            continue
        y = draw_wrapped_text(
            canvas,
            line,
            x=margin,
            y=y,
            max_width=width - 2 * margin,
            font="Helvetica",
            size=11,
            leading=17,
        )

    canvas.setFillColor(HexColor("#64748B"))
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - margin, 34, "QFlow fixture corpus - 1")
    canvas.save()


def save_document(document: Document, path: Path) -> None:
    document.save(path)
    normalize_docx_archive(path)


def normalize_docx_archive(path: Path) -> None:
    normalized = BytesIO()
    with ZipFile(path, "r") as source:
        with ZipFile(
            normalized,
            "w",
            compression=ZIP_DEFLATED,
            compresslevel=9,
        ) as target:
            for name in sorted(source.namelist()):
                info = ZipInfo(name, FIXED_ZIP_TIME)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (0o755 if name.endswith("/") else 0o644) << 16
                target.writestr(info, source.read(name))
    path.write_bytes(normalized.getvalue())


def parse_output_dir() -> Path:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Directory that receives the generated Respondus corpus.",
    )
    args = parser.parse_args()
    return args.output_dir.resolve()


def main() -> None:
    output_dir = parse_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    save_visible_numbering(output_dir)
    save_automatic_numbering(output_dir)
    save_embedded_media(output_dir)
    save_loose_pdf_control(output_dir)


if __name__ == "__main__":
    main()
