from __future__ import annotations

import wave
from pathlib import Path

import numpy as np


SAMPLE_RATE = 48_000
DURATION = 45.0
BPM = 92.0
BEAT = 60.0 / BPM
OUT = Path(__file__).with_name("agora-music-bed-45s.wav")

rng = np.random.default_rng(20260911)
frames = int(SAMPLE_RATE * DURATION)
music = np.zeros((frames, 2), dtype=np.float64)


def midi(note: int) -> float:
    return 440.0 * (2.0 ** ((note - 69) / 12.0))


def window(start: float, duration: float) -> tuple[slice, np.ndarray]:
    i0 = max(0, int(start * SAMPLE_RATE))
    i1 = min(frames, int((start + duration) * SAMPLE_RATE))
    t = np.arange(i1 - i0, dtype=np.float64) / SAMPLE_RATE
    return slice(i0, i1), t


def envelope(t: np.ndarray, duration: float, attack: float, release: float) -> np.ndarray:
    env = np.ones_like(t)
    if attack > 0:
        env *= np.minimum(1.0, t / attack)
    if release > 0:
        env *= np.minimum(1.0, np.maximum(0.0, duration - t) / release)
    return env


def add_stereo(signal: np.ndarray, sl: slice, pan: float = 0.0) -> None:
    left = np.sqrt((1.0 - pan) * 0.5)
    right = np.sqrt((1.0 + pan) * 0.5)
    music[sl, 0] += signal * left
    music[sl, 1] += signal * right


def add_pad(start: float, duration: float, notes: tuple[int, ...]) -> None:
    sl, t = window(start, duration)
    env = envelope(t, duration, 0.65, 1.1)
    drift = 1.0 + 0.025 * np.sin(2 * np.pi * 0.12 * t)
    for index, note in enumerate(notes):
        freq = midi(note)
        phase = index * 0.73
        tone = (
            np.sin(2 * np.pi * freq * t + phase)
            + 0.22 * np.sin(2 * np.pi * freq * 2.0 * t + phase * 0.4)
        )
        add_stereo(0.018 * tone * env * drift, sl, pan=(-0.45 + index * 0.45))


def add_bass(start: float, note: int, duration: float = 0.46) -> None:
    sl, t = window(start, duration)
    env = np.exp(-5.0 * t / duration) * np.minimum(1.0, t / 0.012)
    freq = midi(note)
    tone = np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(2 * np.pi * freq * 2 * t)
    add_stereo(0.085 * tone * env, sl)


def add_kick(start: float) -> None:
    duration = 0.24
    sl, t = window(start, duration)
    freq = 86.0 * np.exp(-4.2 * t) + 41.0
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.exp(-18.0 * t)
    click = np.exp(-90.0 * t) * rng.normal(0.0, 0.2, len(t))
    add_stereo(0.15 * np.sin(phase) * env + 0.018 * click, sl)


def add_snare(start: float) -> None:
    duration = 0.19
    sl, t = window(start, duration)
    noise = rng.normal(0.0, 1.0, len(t))
    bright = np.concatenate(([0.0], np.diff(noise)))
    body = np.sin(2 * np.pi * 178.0 * t)
    env = np.exp(-22.0 * t)
    signal = (0.052 * bright + 0.028 * body) * env
    add_stereo(signal, sl, pan=0.06)


def add_hat(start: float, accent: bool = False) -> None:
    duration = 0.065 if not accent else 0.1
    sl, t = window(start, duration)
    noise = rng.normal(0.0, 1.0, len(t))
    bright = np.concatenate(([0.0], np.diff(noise)))
    env = np.exp((-60.0 if not accent else -42.0) * t)
    add_stereo((0.009 if not accent else 0.014) * bright * env, sl, pan=0.28)


def add_transition(at: float) -> None:
    duration = 0.7
    sl, t = window(at - duration, duration)
    noise = rng.normal(0.0, 1.0, len(t))
    smooth = np.convolve(noise, np.ones(80) / 80, mode="same")
    rise = np.square(np.clip(t / duration, 0.0, 1.0))
    add_stereo(0.014 * smooth * rise, sl, pan=-0.2)


progression = [
    ((50, 53, 57, 62), 38),  # D minor
    ((46, 50, 53, 58), 34),  # B-flat major
    ((53, 57, 60, 65), 41),  # F major
    ((48, 52, 55, 60), 36),  # C major
]

bar = 0
while bar * 4 * BEAT < DURATION:
    notes, bass_note = progression[bar % len(progression)]
    start = bar * 4 * BEAT
    add_pad(start, min(4 * BEAT + 0.35, DURATION - start), notes)
    add_bass(start, bass_note)
    add_bass(start + 2 * BEAT, bass_note, 0.38)
    add_kick(start)
    add_snare(start + BEAT)
    add_kick(start + 2 * BEAT)
    add_snare(start + 3 * BEAT)
    for eighth in range(8):
        add_hat(start + eighth * BEAT / 2, accent=eighth in {3, 7})
    bar += 1

for cut in (15.0, 20.0, 23.0, 28.0, 31.0, 36.0, 41.0):
    add_transition(cut)

# A restrained two-note shimmer gives the brand reveal a clean finish.
for start, note in ((41.2, 74), (42.5, 77), (43.7, 81)):
    sl, t = window(start, 1.2)
    env = envelope(t, 1.2, 0.02, 0.9)
    tone = np.sin(2 * np.pi * midi(note) * t) + 0.3 * np.sin(2 * np.pi * midi(note + 12) * t)
    add_stereo(0.026 * tone * env, sl, pan=0.35)

# Gentle fade in and a clean tail.
timeline = np.arange(frames, dtype=np.float64) / SAMPLE_RATE
master_env = np.minimum(1.0, timeline / 1.2) * np.minimum(1.0, np.maximum(0.0, DURATION - timeline) / 1.4)
music *= master_env[:, None]
peak = np.max(np.abs(music))
if peak > 0:
    music *= 0.72 / peak

pcm = np.int16(np.clip(music, -1.0, 1.0) * 32767)
with wave.open(str(OUT), "wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(SAMPLE_RATE)
    wav.writeframes(pcm.tobytes())

print(OUT)
