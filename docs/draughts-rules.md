# Draughts rules (English / American checkers, 8x8) - for owner approval

Status: **approved by the owner 2026-10-18; built in slice 6B (see decision #108).** This document is the single source for the rules. Approve it or list changes, then slice 6B starts. Default variant chosen from `docs/phase-6-plan.md`; the Nigerian or international 10x10 variants are different games and would need their own document.

## Board and pieces

- 8x8 board. Only the 32 dark squares are used. Each side starts with 12 men on the three rows nearest it.
- Seat 0 plays the lower side and moves up the screen; seat 1 plays the upper side. The server owns the board; the phone only draws it.
- The seat chosen as opener (`openingSeat`) moves first. A rematch passes the first move to the other seat.

## Moves

1. A **man** moves one square diagonally forward onto an empty dark square.
2. A **king** moves one square diagonally in any direction (it does not fly).
3. A **capture** jumps diagonally over an adjacent enemy piece onto the empty square directly behind it. The jumped piece is removed.
4. A man captures only forward. A king captures in any direction.
5. **Capturing is compulsory.** If any capture exists, the player must make one; a plain move is refused. If several captures exist, the player may choose any of them (the longest is not required).
6. **Multi-jump:** after a capture, if the same piece can capture again, it must keep jumping in the same turn. The turn is one action made of the whole jump path; the server checks that the path is legal.
7. A piece cannot jump its own pieces, cannot jump two pieces at once, and a piece captured in a multi-jump is removed at the end of the turn (so it cannot be jumped twice).
8. **Crowning:** a man that reaches the far row becomes a king. If it arrived by a capture, the turn ends there, even if the new king could keep capturing.

## How a game ends

- **Win:** the opponent has no pieces left, or has no legal move on their turn.
- **Draw:** (a) the same position, with the same side to move, occurs three times; (b) 40 moves by each side (80 plies) pass with no capture and no man moved. No draw by agreement in the MVP.
- **Turn clock:** 20 seconds per turn (same as the other games). If it runs out, the player loses that game (no auto-move, because a random forced capture would be unfair). The turn clock does not apply to a multi-jump separately; the whole jump is one action.
- **Leaving or staying disconnected** past the grace period loses the game.

## Format

One game per match (no best-of series). A rematch is available at the end. Ranked and ratings work as for the other games (Elo; a draw scores half).

## What the server does and the client cannot

- The client sends only a move: the starting square and the list of landing squares (the jump path). It never sends a capture list, a winner or a board.
- The server rejects: a non-compulsory plain move when a capture exists, a jump path that stops early when more jumps are available, a path through a wrong square, a move out of turn, and any move after the game ended. Repeating the same action id is acknowledged, never applied twice.
- Bots (easy, medium, hard) are labelled "Bot" and move through the same validator. Easy: random legal move. Medium: prefers captures and safe moves, looks 2 plies. Hard: alpha-beta, about 6 plies, with a fixed time cap so it never delays a turn.

## Test plan (done criteria)

Unit and property tests: forced capture, multi-jump continuation, crowning ends the turn, man cannot capture backwards, king moves, no legal moves loses, threefold repetition, 40-move draw, random legal playouts always end and never produce an illegal state. Mutation check: removing the compulsory-capture rule must fail a test. Integration: full game to the end, illegal move refused, duplicate move is a no-op, reconnect, timeout, rematch, result recorded once.

## Questions for the owner

1. English 8x8 rules as above, or a different local variant?
2. Draw by repetition and the 40-move rule: fine?
3. Timeout loses the game: fine?
