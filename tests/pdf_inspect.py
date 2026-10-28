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
    result.append({"width": float(page.mediabox.width), "height": float(page.mediabox.height), "images": images, "clips": clips})
print(json.dumps(result))
