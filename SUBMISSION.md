# Shadowplay: Devpost submission kit

Deadline: **Wed Nov 18, 2026, 12:00 PM PT.** Submit by 9:00 AM PT, then test
the live link in a private window. Nothing can change after the deadline.

## Form fields

**Name:** Shadowplay

**Tagline (140 max):**
> Your hands are the cast. Throw hand shadows onto your real wall and watch them come alive. No controllers, just a lamp and your hands.

(134 characters)

**Track:** Gaming **Division:** New Experience

**Target launch date:** _fill in_ (suggestion: Meta Horizon Store as a PWA, Q1 2027)

## Description (under 500 words)

### Inspiration
Everyone has made a shadow rabbit on a bedroom wall. It might be the oldest
hands-only game there is: no rules, no equipment, just light and your fingers.
Shadowplay asks what happens when that wall can answer back. Mixed reality
finally lets us put a lamp in your room that knows what your hands are doing.

### What it is
Sit down facing a wall and press Start. A small brass lamp glows below your chin
and a pool of warm light lands on your real wall. Raise a hand and its shadow
appears, huge and soft-edged. A faint outline shows the shape to make. Get
close and the lamp hums brighter. Hold it, and the shadow tears free: the
rabbit hops away, the seagull flaps up and out of the light, the fish swims off.

Eight creatures go from a fist (Pebble) to a two-handed Butterfly. Every
creature you find joins a shelf of silhouettes along the bottom of the light.
Each day opens with a **shadow of the day** that keeps your streak alive. One
complete moment takes under a minute, so it fits a bus stop or a coffee break.

### How we built it
- **Immersive Web SDK (WebXR):** one link, runs in the Meta Quest Browser.
- **Real shadows from real hands:** all 25 tracked joints of each hand are
  projected from the lamp's position onto the wall plane. That's the same
  geometry as a real shadow, so moving your hand toward the lamp really does
  make the shadow grow.
- **Your room is the stage:** WebXR plane detection finds the wall in front of
  you, and the light and shadows land on it in passthrough. The lamp sits low
  so shadows throw above your hands, and slides back for distant walls so the
  whole pose fits. With no wall ahead, a paper screen in a wooden frame appears
  in front of you.
- **Matching poses, not pixels:** pixel overlap called a fist and "horns" 92%
  identical. So each hand becomes six numbers: how straight each finger is,
  plus the direction it points. That works with either hand, at any distance.
  In tests, a correct pose scores 1.00 and any wrong pose 0.35 or less.
- **No assets to load:** creatures are their own captured hand shadows, and all
  sound (lamp hum, a unique arpeggio per creature) is synthesized live.

### Hand interactions
Hands are the entire interface. Shadows come from live joint tracking, and
pose matching reads finger extension and orientation. Levels are authored by
holding a pose in the headset.
Everything works within a two-foot radius, seated, with either hand, and
seven of eight creatures need only one hand.

### What's next
More creatures, including two-handed duets, plus a "theatre" mode that records
your shadow show as a short story you can replay. Then shared shadow shows,
where a friend's hands appear on your wall, and a Horizon Store release as a
PWA.

## Video plan (under 3:00, real headset footage)

Record on the Quest (hold the Meta button and choose Record video, or use the
Meta Quest app to cast). Use a dim room with a plain light wall.

| Time | Shot | On-screen text / voice |
| --- | --- | --- |
| 0:00–0:08 | Cold open: a hand rises, a giant rabbit shadow appears on the wall, it hops off | "Remember making shadow puppets?" |
| 0:08–0:20 | Wide shot: seated, the lamp below the chin, light on the real wall | "Shadowplay turns your wall into a stage." |
| 0:20–0:50 | First minute as a new player: pebble, then heron, with the hint appearing | Show how fast it explains itself |
| 0:50–1:30 | Montage: stag, seagull flies away, fish swims, butterfly with two hands | Let the creature motion carry it |
| 1:30–1:50 | Move the hand toward the lamp: the shadow grows | "Real shadow geometry, from 25 joints per hand." |
| 1:50–2:10 | Shelf filling up, the shadow of the day, streak caption | "Something new on your wall every day." |
| 2:10–2:30 | Paper-screen mode (`?paper`) in a different room | "No wall? A paper screen appears." |
| 2:30–2:45 | End card: Shadowplay, "Your hands are the cast." | |

Rules from the brief: real gameplay only, no AI-generated video, lead with the
best moment, keep it under 3 minutes, and upload as Public on YouTube.

## Final checklist

- [ ] Live link opens in the Quest Browser and Start enters XR
- [ ] Hands only, start to finish: no controller paired
- [ ] Wall mode in a real room, plus paper mode with `?paper`
- [ ] Smooth (at least 60 fps): watch for hitches when shadows appear
- [ ] Video Public on YouTube, under 3:00
- [ ] Devpost: name, tagline, track, division, description, video link, live link, launch date, team
- [ ] Submitted before 12:00 PM PT Nov 18; link still works after
