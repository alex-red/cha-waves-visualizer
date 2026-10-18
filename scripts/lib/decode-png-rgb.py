"""Bounded local PNG decoding for the optional real-image workflow.

Pillow only decodes source bytes. Calibration, resizing and all numerical
research helpers remain in TypeScript. Output is raw RGB8 on stdout.
"""
import io
import struct
import sys

def main():
    from PIL import Image
    source = sys.stdin.buffer.read(32 * 1024 * 1024 + 1)
    if not source or len(source) > 32 * 1024 * 1024:
        raise ValueError('PNG source exceeds the byte limit')
    with Image.open(io.BytesIO(source)) as image:
        if image.format != 'PNG' or image.mode != 'RGB':
            raise ValueError('Only RGB PNG sources are supported')
        width, height = image.size
        if width < 1 or height < 1 or width > 4096 or height > 4096 or width * height > 16_000_000:
            raise ValueError('PNG dimensions exceed the supported limit')
        if getattr(image, 'n_frames', 1) != 1:
            raise ValueError('Animated PNG is unsupported')
        image.load()
        sys.stdout.buffer.write(struct.pack('<II', width, height))
        sys.stdout.buffer.write(image.tobytes())

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        sys.stderr.write('PNG decode failed: ' + str(error) + '\n')
        sys.exit(1)
