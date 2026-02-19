import markdown
from weasyprint import HTML
import sys
import os

CSS = """
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 50px;
}
h1 { font-size: 22pt; border-bottom: 2px solid #333; padding-bottom: 8px; margin-top: 30px; }
h2 { font-size: 16pt; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-top: 28px; }
h3 { font-size: 13pt; margin-top: 22px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
th { background-color: #f0f0f0; font-weight: 600; }
tr:nth-child(even) { background-color: #fafafa; }
code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 10pt; }
pre { background: #f4f4f4; padding: 14px; border-radius: 5px; overflow-x: auto; font-size: 9.5pt; line-height: 1.5; }
blockquote { border-left: 3px solid #999; margin-left: 0; padding-left: 16px; color: #555; }
hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
ul, ol { padding-left: 24px; }
li { margin-bottom: 3px; }
@page { margin: 1in 0.75in; size: letter; }
"""

files = [
    ("life-os-discovery.md", "life-os-discovery.pdf"),
    ("life-os-system.md", "life-os-system.pdf"),
    ("life-os-implementation.md", "life-os-implementation.pdf"),
]

base = "/home/user/bloccit"

for md_file, pdf_file in files:
    md_path = os.path.join(base, md_file)
    pdf_path = os.path.join(base, pdf_file)

    with open(md_path, "r") as f:
        md_content = f.read()

    html_content = markdown.markdown(md_content, extensions=["tables", "fenced_code"])
    full_html = f"<html><head><style>{CSS}</style></head><body>{html_content}</body></html>"

    HTML(string=full_html).write_pdf(pdf_path)
    print(f"Created: {pdf_path}")

print("\nAll PDFs generated.")
