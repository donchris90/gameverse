# Ludo rules

Status: **Implemented, with four rules changed on 2026-10-19 to match RRYDA (decision #116).** Sections 7, 9 and 10 below are the current rules; the rest is as first approved. Items marked **[DECIDE]** are the original choices.

Ludo has many house variants. These follow the common international/Nigerian family version, with the options that most often cause arguments settled in writing.

## 1. Players and board

- 2, 3 or 4 players. Each has 4 tokens of one colour (red, blue, yellow, green), seated clockwise around the board.
- Board: a cross-shaped track of **52 shared squares**, a **home column of 6 squares** leading to the centre for each colour, and a **base** (yard) in each corner where tokens wait.
- Each colour has a **start square** on the track (the square just outside its base). Start squares are 13 squares apart. With 2 players, seats use opposite colours (red and yellow); with 3, three of the four colours; seat order decides who moves first after the random opener.
- A token enters on its **start square, the second box of its arm** (as in RRYDA), travels 51 squares along the track (positions 0..50; the box behind its own start is never used), then up its own 5-square home column (51..55); the centre is **home** (56). Total path per token: 56 steps from the start square to home.

## 2. Turn order and dice

- The server rolls one six-sided die with a cryptographically secure random number generator. The phone never rolls and never sends a number. Every roll is stored in the match event log with its seat and sequence number.
- Play goes clockwise. The opening player is chosen at random by the server.
- A player's turn: roll, then move one token by the rolled number if any legal move exists. If none exists, the turn passes.

## 3. Leaving the base

- **A 6 is needed to bring a token out of the base** onto its start square. **[DECIDE: 6 only (proposed). Alternative: 1 or 6.]**
- A token on the board never goes back to the base unless captured.
- Rolling a 6 gives the player a choice: bring a new token out, or move a token already on the board by 6.
- If a player has no token on the board and does not roll a 6, the turn passes. There is **no re-roll to try again** (a player with all tokens in the base gets one roll per turn). **[DECIDE: one roll (proposed). Alternative: up to three tries while all tokens are in base.]**

## 4. Moving

- A token moves exactly the rolled number of squares forward along the track, then into its home column.
- A move is legal only if the destination is not blocked (see below) and does not overshoot home.
- **Exact roll to finish:** a token reaches home only with the exact number. A token in the home column that cannot use the roll without overshooting stays where it is. **[DECIDE: exact roll required (proposed). Alternative: overshoot bounces back, or any roll finishes.]**
- If the player has several legal moves, they choose which token to move. If exactly one move is legal it is **not** made automatically in the rules engine, but the app may offer a one-tap confirm; the server accepts only a legal move and never picks for a human except on timeout (section 9).

## 5. Capturing

- If a token ends its move on a track square occupied by an opponent's **single** token, that token is **captured** and returns to its owner's base. The capturing token stays.
- A token cannot capture on a **safe square** (section 6) or inside a home column.
- A player may not capture their own token. Landing on a square holding your own token forms a **block** (below) if allowed.

## 6. Safe squares

- The 4 start squares and the 4 squares 8 steps after each start square (8 in total, the usual starred squares) are **safe**: any number of tokens of any colours may share them, and nothing is captured there. **[DECIDE: 8 safe squares (proposed). Alternative: only the 4 start squares.]**
- Home columns are private to their owner and also safe.

## 7. Blocks (stacked tokens)

- **There are no blocks** (RRYDA rule, decision #116). Two tokens of one colour on the same non-safe square are captured together by an opponent who lands there. On a safe square nothing is captured. Tokens may always pass over other tokens.

## 8. Extra turns

- Rolling a **6** gives another roll after the move. **[Default, standard.]**
- **Capturing** an opponent's token gives another roll. **[DECIDE: yes (proposed).]**
- **Reaching home** with a token gives another roll. **[DECIDE: yes (proposed).]**
- **Three sixes in a row:** if a player rolls a 6 three times in a row in one turn, the third move is **not played** and the turn ends (the third six is cancelled). **[DECIDE: third six forfeits the turn (proposed). Alternative: no limit, or tokens that moved on the sixes go back to base.]**
- Extra turns from different causes do not stack beyond the three-sixes rule; each extra roll is a normal roll.

## 9. Timers, away players, bots and leaving

- Turn clock: **20 seconds** to roll and 20 seconds to choose a token after the roll.
- **AI cover.** When a player's clock runs out, or they stay offline past the 30 second grace, the server's AI plays that seat so the others are not kept waiting. The seat is labelled in the app ("AI is playing for <name>", and "The AI is playing for you" for the player). The AI uses the same validators as a human move. The player can press **Take back control** (`POST /v1/matches/:id/resume`), or simply roll or move, and the AI stops.
- **Cap.** If the AI plays for the same seat **20 turns in a row**, the seat is removed (same as leaving). Any human roll or move resets the count.
- A player who presses Leave is removed at once. In a 2-player game the other player wins. In a 3- or 4-player game the leaver's tokens are removed and the game continues; the leaver is placed last and never receives coins.
- Bots are always labelled "Bot" and move through the same validator. Levels: easy, medium, hard (hard uses RRYDA's scoring weights: finishing, capturing, leaving base, entering the home column, safe squares and danger).

## 10. Winning and results

- A player wins by getting **all 4 tokens home**.
- **2 players:** the game ends when one player finishes or the other is removed. **3 or 4 players:** the game ends when **two** players have finished (or only one player is left). Unfinished seats are ranked by tokens home, then by progress, then removed seats last.
- **Pot (bonus coins).** Entry fee x players. 2 or 3 players: first place takes the whole pot. 4 players: first takes two thirds (rounded down), second takes the rest. A removed seat is never paid. A match that never completes refunds every entry.
- Ranked results: Elo is applied pairwise between placings, only for quick matches between humans. XP is based on placing. Private, friend and bot matches are not rated.
- A rematch keeps the same players; the opener rotates.

## 11. Fairness and server rules

- The server holds the whole game state; the phone only requests "roll" and "move token N". Clients cannot send dice values, positions or winners.
- Every request is idempotent (action id + expected version), exactly like tic-tac-toe, so a retry never rolls twice.
- Every roll and move is in the event log, so a disputed game can be replayed from the log.
- State must never become illegal: no two different colours on a non-safe square, no token past home, no more than 4 tokens per colour, no token in two places. The rules package is tested with property-based fuzzing to prove this.

## 12. Summary of what you must decide

| #   | Question                                   | Proposed                                      |
| --- | ------------------------------------------ | --------------------------------------------- |
| 1   | What brings a token out of base            | 6 only                                        |
| 2   | Tries per turn when all tokens are in base | One roll                                      |
| 3   | Finishing                                  | Exact roll to reach home                      |
| 4   | Safe squares                               | 8 (4 starts + 4 stars)                        |
| 5   | Same-colour stacks                         | No blocks: a pair is captured together        |
| 6   | Extra roll for capture / for reaching home | Yes / yes (plus every 6)                      |
| 7   | Three sixes in a row                       | Third six cancelled, turn ends                |
| 8   | Turn clock                                 | 20 s to roll, 20 s to choose                  |
| 9   | An absent player                           | AI covers the seat; removed after 20 turns    |
| 10  | When a game ends                           | 2 players: first finisher; 3-4: two finishers |
