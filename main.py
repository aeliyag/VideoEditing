# test_zoom.py

from effects import Clip, Rectangle, zoom

clip = Clip.from_file("testing.mov")



print("fps:", clip.fps)
print("duration:", clip.duration)
print("width:", clip.width)
print("height:", clip.height)


full = Rectangle(
    x=0,
    y=0,
    width=clip.width,
    height=clip.height,
)

target = Rectangle(
    x=500,
    y=200,
    width=600,
    height=400,
)

result = zoom(
    clip,
    start_rect=full,
    end_rect=target,
    duration=2.0,
)

result.write("zoomed_output.mp4")