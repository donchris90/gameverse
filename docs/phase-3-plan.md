# Phase 3 plan — voice in matches

Slices: **3A** API (VoiceSession, match-bound token, usage logging, fake provider), **3B** mobile (controller, Agora engine, panel, permissions, background), **3C** docs and gate.

Design: a thin `VoiceProvider` on the server (Agora + fake); the phone-side flow is a tested controller over a `VoiceEngine` seam (Agora implementation + fake in tests). Voice is opt-in per match, humans only, no recording.
