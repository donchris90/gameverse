import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type GameId } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';

/** Only tic-tac-toe has a choice of match length; every other game plays its own full game. */
export function assertBestOf(gameId: GameId, bestOf: number): void {
  if (bestOf !== 3 && gameId !== 'tictactoe') {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'Only tic-tac-toe can be played as a single game',
    );
  }
}
