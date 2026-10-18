import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import type { LudoError, SeriesError } from '@gameverse/game-rules';
import { AppException } from '../common/app.exception.js';

export function notFound(): AppException {
  // One answer for "no such match" and "not your match".
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Match not found');
}

export function invalidState(message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATE, message);
}

export function staleVersion(version: number): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_MATCH_VERSION,
    'The match changed; reload it and try again',
    { version },
  );
}

export function ludoError(error: LudoError): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'WRONG_PHASE':
      return invalidState('Not now: roll the die first, then move a token');
    case 'GAME_FINISHED':
    case 'INVALID_SEAT':
      return invalidState('The match is not accepting moves right now');
    case 'INVALID_DIE':
    case 'INVALID_TOKEN':
    case 'ILLEGAL_MOVE':
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        { reason: error },
      );
  }
}

export function seriesError(error: SeriesError): AppException {
  switch (error) {
    case 'NOT_YOUR_TURN':
      return new AppException(HttpStatus.CONFLICT, ErrorCode.NOT_YOUR_TURN, 'It is not your turn');
    case 'CELL_TAKEN':
    case 'INVALID_CELL':
    case 'GAME_OVER':
      return new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_MOVE,
        'That move is not allowed',
        { reason: error },
      );
    case 'SERIES_NOT_PLAYING':
      return invalidState('The match is not accepting moves right now');
  }
}

/** Seats that have just finished or been removed no longer count as being in the match. */
export function departedSeats(
  events: readonly { type: string; seat?: unknown }[],
): (0 | 1 | 2 | 3)[] {
  return events.flatMap((event) =>
    (event.type === 'SEAT_REMOVED' || event.type === 'SEAT_FINISHED') &&
    typeof event.seat === 'number'
      ? [event.seat as 0 | 1 | 2 | 3]
      : [],
  );
}
