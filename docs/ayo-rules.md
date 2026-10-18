# Ayo (Ayo Olopon) rules - for owner approval

Status: **second draft, nothing built.** Rewritten on 2026-10-18 from the owner's description (reap at four, rounds, pits that run out). Anything marked **(default)** is my guess where the owner has not said; please correct it. Once approved this is the single source for the rules.

## Board

- Twelve pits in a ring, numbered 0-11 counter-clockwise. Seat 0 owns pits 0-5, seat 1 owns pits 6-11.
- 48 seeds, four in each pit, at the start of the match.
- A pit that has been "lost" (see rounds below) is out of the ring. Sowing skips it.

## A turn

1. Pick one of your own pits that holds seeds. Lift all its seeds.
2. Sow them one at a time, counter-clockwise, starting with the next pit in the ring (your own or the opponent's).
3. **Reap at four.** When a seed makes a pit hold exactly **4**:
   - on your own side: you reap it (take the 4 seeds into your store);
   - on the opponent's side, **by a seed that is not the last of your turn**: the opponent reaps it;
   - on the opponent's side, **by the last seed of your turn**: you reap it.
     Only exactly 4 counts; 5 or more is not reaped. Sowing carries on after a reap that happened before the last seed.
4. **Relay.** When the last seed of a lift lands in a pit that already held seeds and did not make 4, lift every seed in that pit (yours or the opponent's) and keep sowing from the next pit. This repeats.
5. **End of turn.** The turn ends when the last seed lands in an empty pit (it now holds 1), or when the last seed makes a 4 that is reaped. Then the other player moves.
6. A lift of 12 or more seeds skips the pit it was lifted from on each lap **(default)**.
7. A move that leaves the opponent with no seeds on the board is allowed **(default)**. If a player has no seed to move when their turn comes, the round ends and the other player takes everything left on the board **(default)**.

## Rounds

- A round ends when **8 seeds are left on the board** and somebody then reaps a 4: that player takes the 4 they reaped **and the remaining 4**, so 8 in all, and the round is over at once, even in the middle of a sowing. Who reaps does not matter: if the opponent's pit reaches 4 during your sowing and the opponent reaps it, the opponent takes all 8.
- Every seed a player has reaped stays in their store. The seeds on the board are gone for the round, so a store only grows.
- **Next round:** each player fills their pits with four seeds each from their store. A player with a store of `S` seeds gets `min(6, floor(S / 4))` pits. Extra seeds beyond six pits stay in the store as a reserve. Where a player has fewer than six pits, they get the first pits of their row in the sowing direction (seat 0 pits 0, 1, 2…; seat 1 pits 6, 7, 8…) **(default)**; the other pits of that row are out of the ring.
- The player who lost the previous round starts the next one **(default)**. Round 1 is opened by `openingSeat`; a rematch gives the first move to the other seat.

## How the match ends

- **Automatically** when a player is left with **one pit or none** at the start of a round (their store is below 8). The other player wins.
- **By agreement** when a player has exactly **two pits**: either player can press "End game" and it ends if the other accepts. Then the player with more seeds in total (store plus board) wins; equal is a draw.
- Turn clock: 20 seconds a move. If it runs out that player loses the match. Leaving, or staying disconnected past the grace period, loses the match.

## Worked example (first move, all pits at 4)

Seat 0 lifts pit 0 (4 seeds) and sows pits 1, 2, 3, 4, which become 5, 5, 5, 5. The last seed made pit 4 hold 5, so it is a relay: lift pit 4 (5 seeds) and sow pits 5-9 (pit 9 becomes 5). Pit 9 is non-empty: lift its 5 and sow pits 10, 11, 0, 1, 2 (pit 0 had been emptied, so it now holds 1); the last seed makes pit 2 hold 7 - lift 6... the exact relay continues until a last seed lands in an empty pit. The computed result of this move from the start position (checked by a throwaway script, not yet by the game code) is the board `[2, 7, 1, 6, 1, 6, 6, 6, 0, 1, 6, 6]` for pits 0-11, with nothing reaped. Opening moves never reap because every pit holds 4 and each seed makes a 5 or more.

## What the server does and the client cannot

- The phone sends only the pit number (0-11). The server checks it is the player's own, non-empty pit, plays the whole turn including every relay and reap, and decides rounds, stores and the winner.
- The move is stored with its sowing steps so the app can animate it.
- Bots are labelled "Bot" and use the same validator. Easy: random legal pit. Medium: prefers pits that reap and avoids giving the opponent a reap. Hard: alpha-beta, about 6 moves deep, with a node cap.

## Test plan (done criteria)

Unit and property tests: sowing order, relay chains, reaping on own side, the opponent reaping a 4 made mid-sow, the last-seed exception, only-exactly-4, the 8-seed round end taking all 8 (including mid-sowing), refilling pits from the store, the one-pit end, the by-agreement end at two pits, seed count always conserved (board plus both stores equal 48), the 12-seed lap skip. Mutation checks: let 5 count as a reap, remove the last-seed exception. Integration tests as for Draughts.

## Still to confirm

1. **Which pits** a player with fewer than six pits keeps (default: the first ones in their row), and whether the board shows the lost pits as blank.
2. **Who starts** the next round (default: the loser of the last round).
3. **Reserve seeds** (a store above 24) stay with the player and count in the final total (default).
