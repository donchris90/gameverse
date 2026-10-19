# Ayo rules (RRYDA house rules)

Status: **switched to the RRYDA rules on 2026-10-19 by owner instruction ("copy and paste the exact RRYDA flow", decision #118).** This replaces the reap-at-four rules approved on 2026-10-18 (decision #109, which #118 reverses). The rules are in `packages/game-rules/src/ayo.ts`; the screen and replay timing are in `packages/shared-types/src/ayo-ui.ts` and `apps/mobile/src/ayo/`. Still not seen on a phone.

## Board

- Twelve pits in a ring, numbered 0-11 counter-clockwise. 48 seeds, four in every pit at the start of the match.
- Round 1: seat 0 owns pits 0-5, seat 1 owns pits 6-11. From round 2 who owns which pit changes (see Next round).

## A turn

1. Pick one of **your** pits that holds seeds. Lift all its seeds.
2. Sow them one at a time, counter-clockwise, starting at the next pit. The pit you lifted from is **not skipped** on a long lap.
3. **Relay.** If the last seed lands in a pit that already held seeds, lift every seed in that pit and keep sowing. The turn ends when the last seed lands in an empty pit.
4. **Packing.** A pit that reaches exactly four is packed (emptied, the four counted):
   - in the middle of a sow, the four go to the pit's **owner**;
   - if the last seed of the sow made the four, the **sower** takes them (on either side) and the turn ends.
5. A player with no seeds on their side **skips** their turn. If neither side has seeds the round ends.

## A round

- A round ends when **four seeds or fewer are left on the board** after a move (also when the board is empty, or after 400 turns in the round). The seeds left go to the player who **packed last** (if nobody has, to the opponent of the player who moved).
- Seeds are conserved: board + what each player packed is always 48 inside a round, so what is left is 0 or 4.

## Next round

- Each player makes one pit of four for every four seeds they packed: 28 seeds = 7 pits, and the other player then has 5. Seat 0's pits come first in the ring.
- The board is refilled to 12 pits of four. **The starter alternates** every round (round 1 seat A, round 2 seat B, ...). A rematch gives the first move to the other seat.
- A player who starts a round with **exactly one pit** must choose: **quit** (and lose) or **continue**. Nobody can move until they choose. They have 30 seconds; if the time runs out the server continues for them.
- A player who has **no pit** loses.
- After **30 rounds** the player with more pits wins (equal is a draw).

## Clock and absence

- 20 seconds a move. The clock starts **after the move has been replayed on screen**, so watching never costs anyone time.
- When a clock runs out the **server plays a pit for that player** (the medium bot's pick). After **three** such turns in a row the player loses; any real move resets the count.
- A player who disconnects has **60 seconds** to come back, then loses. Leaving loses the match.

## The replay (what the owner sees)

Every move is shown seed by seed from the server's own record of it, in order, and never skipped: lift (320 ms), each drop (220 ms, shortened only for a very long sow so a move never takes more than 9 s), pack (600 ms), the last seeds of the round (800 ms), a new round (3 s with a "Round N" banner). The pit being sown into is lit, pits already sown into this move are ringed, the seeds in the hand are counted, and a line over the board says who packed or who gets the last seeds. Taps are ignored while a move is being shown. These timings are RRYDA's; they live in one place (`AYO_REPLAY_MS` in `ayo-ui.ts`) and the server reads the same numbers.

## Worked example (first move, all pits at 4)

Seat 0 lifts pit 0 and sows pits 1-4; pit 4 held seeds so its 5 are lifted (pits 5-9); pit 9 held seeds so its 5 are lifted (pits 10, 11, 0, 1, 2); pit 2 holds 6, lift and sow pits 3-8; pit 8 holds 6, lift and sow pits 9, 10, 11, 0, 1, 2; the last seed lands in the just-emptied pit 2 and the turn ends. Pits 0-11: `[2, 7, 1, 6, 1, 6, 6, 6, 0, 1, 6, 6]`, nothing packed. An opening move never packs because each seed makes a pit 5 or more.

## Server rules

- The phone sends only a pit number (`POST /v1/matches/:id/ayo-moves`) or the quit/continue answer (`/ayo-decision`). The server checks the pit is the player's own and non-empty, plays the whole turn, and decides packs, rounds, pits and the winner.
- Bots are labelled "Bot" and use the same validator: easy picks any pit; medium is RRYDA's bot (best net pack three times in four); hard looks three turns ahead. A bot always chooses "continue" and never quits.
- Entry fees and the pot work as for the other games (decision #114).

## Where we differ from RRYDA (honest list)

- RRYDA has one bot; we keep three levels.
- RRYDA's spectator bets, party rooms, sounds and Redis state are not ported (out of scope or no audio module).
- The turn clock is 20 s here; RRYDA's value is configurable and I did not see it in the backup.
- Not seen on a phone and Maestro flows not run: the replay speed in particular needs the owner's eyes.
