# Ayo (Ayo Olopon) rules - draft for owner approval

Status: **draft, nothing built.** Ayo is played with slightly different rules from town to town, and the written sources disagree on the capture count and on relay sowing (see the end). This document sets the defaults I propose. The owner knows how it is played locally, so please correct anything that is not how you know the game. Once approved it is the single source for the rules.

## Board and seeds

- Two rows of six pits, 12 pits in all. Each player owns the six pits on their side. 48 seeds, four in each pit at the start.
- Pits are numbered 0-11 going round counter-clockwise. Seat 0 owns pits 0-5 (their row, left to right), seat 1 owns pits 6-11.
- The opening seat (`openingSeat`) moves first. A rematch gives the first move to the other seat.

## A turn

1. Pick one of your own pits that holds at least one seed.
2. Lift every seed from it and sow them one at a time, counter-clockwise, starting with the next pit (which may be on the opponent's side).
3. A pit that held 12 or more seeds is skipped when the sowing laps round to it, so the first seed of the next lap goes into the pit after it.
4. **Relay:** if the last seed lands in a pit that already held seeds (it now holds 2 or more), lift all the seeds in that pit and keep sowing from the next pit. This repeats until the last seed lands in an empty pit or a capture happens.
5. **Capture:** if the last seed lands in a pit **on the opponent's side** that now holds exactly 2 or 3 seeds, you capture them. Then look at the pit before it (going backwards, still on the opponent's side): if it holds 2 or 3 seeds you capture it too, and so on until a pit that does not hold 2 or 3, or the edge of the opponent's side.
6. If the last seed lands in an empty pit, the turn ends. If that pit is on your own side nothing is captured; if it is on the opponent's side it now holds 1, which is not a capture.
7. After a capture, or a last seed in an empty pit, the turn passes.

## Rules about running out of seeds

- You may not make a move that leaves the opponent with no seeds if another move exists that gives them some. If every legal move leaves the opponent empty, you may play any of them.
- If you have no seed to move on your turn, the game ends: the opponent keeps the seeds on their side.

## How a game ends

- **Win:** you have captured 25 or more seeds, or when the game ends by the rule above you have more seeds (captured plus those on your side) than the opponent.
- **Draw:** both players have exactly 24, or the same position (board and side to move) occurs three times, or 60 moves each pass with no capture. A draw splits the result.
- **Turn clock:** 20 seconds per turn. If it runs out the player loses the game.
- Leaving or staying disconnected past the grace period loses the game.

## Format

One game per match, rematch available, ratings and XP like the other games.

## What the server does and the client cannot

- The phone sends only the pit number (0-11). The server checks it is the player's own, non-empty pit, plays the whole relay, and works out the captures and the winner. The phone never sends a result.
- Each move is stored with its sowing steps for the event log, so the app can animate it.
- Bots are labelled "Bot" and move through the same validator. Easy: random legal move. Medium: prefers moves that capture. Hard: alpha-beta search about 6 moves deep with a node cap.

## Test plan (done criteria)

Unit and property tests: sowing order, the 12-seed lap skip, relay chains, capture of 2 and of 3, backward chain stops correctly, no capture on your own side, the "do not leave the opponent empty" rule, seed count always 48 (no seed is ever created or lost), 25-seed win, draws, timeouts. Mutation checks: remove the lap skip, change the capture counts. Integration tests as for Draughts.

## Questions for the owner (please answer, or say "defaults")

1. **Capture count:** capture a pit that holds 2 or 3 after the last seed (my default), or exactly 4, or other?
2. **Relay sowing:** keep sowing when the last seed lands in a non-empty pit (my default), or stop after one pass?
3. **Capturing backwards** along the opponent's row: yes (default) or only the last pit?
4. **Win threshold:** 25 seeds, or play on until one side has no seeds?
5. **Two-lap rule** (skip the starting pit on a 12+ lap): yes (default) or no?

## Why I am asking

Sources I checked do not agree. For example [gamerules.com](https://gamerules.com/rules/ayo-olopon/) says a capture happens when the last seed makes a pit two or three, and does not describe relay sowing; other write-ups describe relay sowing and a different capture count. I have not found one authoritative text, so the local rules you know should win.
