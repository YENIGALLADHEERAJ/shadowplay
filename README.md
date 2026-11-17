# Shadowplay

**Your hands are the cast.** A seated, hands-only mixed reality game for Meta
Quest. A small lamp glows below your chin, and your real hands throw shadows
onto your real wall. Shape your hands into a rabbit, a stag or a butterfly, and
the shadow comes alive and runs off across the wall.

Built with the [Immersive Web SDK](https://iwsdk.dev) (WebXR) for the Meta VR
Start Developer Competition 2026 (Gaming track, New Experience division).

## Play

Open the hosted link in the Meta Quest Browser, sit down facing a wall, and
press **Start**. No controllers are needed.

- If a wall is detected 0.7 to 4.5 m ahead (room setup / Space Setup), the
  lamplight and shadows land on that wall.
- With no wall ahead, a paper screen in a wooden frame appears in front of you.
- 8 creatures to find: Pebble, Heron, Rabbit, Stag, Seagull, Fish, Starfish and
  Butterfly (two hands).
- Every day starts with a **shadow of the day** that keeps your streak going.
  Progress is saved on the device.

URL options: `?paper` forces the paper screen. `?capture` is a level-authoring
mode (see below).

## How it works

| Part | File |
| --- | --- |
| Game loop, placement on walls, flow, captions | `src/shadowplay.ts` |
| Hand joints → projected shadow + pose features | `src/shadow/hand-shadow.ts` |
| Pose matching (finger extension + direction) | `src/shadow/pose-match.ts` |
| Canvas renderer: light, ghost, shadow, creature, shelf | `src/shadow/screen.ts` |
| Levels and creature motion | `src/shadow/levels.ts`, `src/shadow/level-data.ts` |
| Saved progress, daily shadow, streak | `src/shadow/progress.ts` |
| Synthesized sound (no audio files) | `src/shadow/audio.ts` |

- **Shadows:** each of the 25 tracked hand joints is projected from the lamp
  onto the screen plane (a central projection), and drawn as bone capsules
  plus a palm polygon. The shadow is drawn small and upscaled, which gives a
  soft penumbra cheaply.
- **Matching:** pixel overlap can't tell poses apart (a fist and "horns" look
  92% alike) and breaks when the hand moves toward the lamp. Instead each hand
  is reduced to how straight each finger is plus which way it points on the
  screen. That ignores position and scale, works with either hand, and
  separates every level cleanly (same pose: 1.00; other poses: 0.35 or less in
  emulator tests).
- **Walls:** detected vertical planes (WebXR plane detection) straight ahead
  become the screen. The lamp stays low so shadows throw *above* your hands,
  and moves back for far walls to cap magnification so the whole pose fits.

## Develop

```sh
npm install
npm run dev        # HTTPS dev server + managed browser (use for a Quest on Wi-Fi)
npm run dev:http   # plain HTTP on http://localhost:8082 for desktop browsers
npm run typecheck
npm run build
```

The desktop emulator (IWER) simulates a Quest 3 with hand tracking and a living
room with planes, so the full game can be played without a headset.

### Authoring levels with `?capture`

Run the HTTPS dev server, open `/?capture` on the Quest, and hold a pose. Every
6 seconds the current shadow and hand pose are saved to `captures/*.json`
through the dev server. Those files feed `src/shadow/level-data.ts`.

## Deploy

`.github/workflows/deploy-pages.yml` builds and publishes `dist/` to GitHub
Pages on every push to `master`. Set the repo's Pages source to "GitHub Actions"
once.
