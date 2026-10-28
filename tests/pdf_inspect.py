import json
import sys
from pypdf import PdfReader

result = []
for page in PdfReader(sys.argv[1]).pages:
    stack = []
    matrix = [1, 0, 0, 1, 0, 0]
    images, clips = [], []
    for operands, operator in page.get_contents().operations:
        if operator == b"q":
            stack.append(matrix[:])
        elif operator == b"Q":
            matrix = stack.pop()
        elif operator == b"cm":
            a, b, c, d, e, f = [float(value) for value in operands]
            aa, bb, cc, dd, ee, ff = matrix
            matrix = [aa*a+cc*b, bb*a+dd*b, aa*c+cc*d, bb*c+dd*d, aa*e+cc*f+ee, bb*e+dd*f+ff]
        elif operator == b"Do":
            images.append(matrix[:])
        elif operator == b"re":
            clips.append([float(value) for value in operands])
    labels = []

    def visit_text(text, cm, tm, font, size):
        if text.strip():
            labels.append({"text": text.strip(), "x": cm[0]*tm[4]+cm[2]*tm[5]+cm[4],
                           "y": cm[1]*tm[4]+cm[3]*tm[5]+cm[5], "fontSize": float(size)})

    text = page.extract_text(visitor_text=visit_text)
    result.append({"width": float(page.mediabox.width), "height": float(page.mediabox.height),
                   "images": images, "clips": clips, "text": text, "labels": labels})
print(json.dumps(result))
