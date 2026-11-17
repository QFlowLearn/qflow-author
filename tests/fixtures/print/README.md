# Static image boundary fixtures

These tiny images were generated locally with Pillow from a three-by-two RGB/RGBA pixel pattern;
they contain no third-party artwork. The RGBA pattern is red/green/blue with alpha255/128/0 on each
row. `normal.jpg` is its RGB JPEG counterpart. `metadata-alpha.png` and
`metadata-alpha-changed.png` have identical pixels, compressed image data and byte lengths but
slightly different private Comment values. `orientation.jpg` records EXIF orientation6;
`cmyk.jpg` uses CMYK; `animated.png` contains two APNG frames. The malformed gAMA and unknown JPEG
marker fixtures put a private sentinel in a named-but-invalid ancillary/coding segment.

The normalization tests reject unsupported semantics and metadata-bearing malformed segments.
An independent Pillow decode of the normal RGB JPEG and RGBA PNG derivatives established exact
pixel equivalence, including transparency. Actual product PDF tests use the retained Worker/R2
output with `unpdf`; parser results are never replaced by mocks or hand-written PDF bytes.
