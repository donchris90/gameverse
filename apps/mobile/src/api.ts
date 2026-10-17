const baseUrl = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export type ReadyResult =
  { kind: 'ok' } | { kind: 'not-ready'; status: number } | { kind: 'unreachable'; reason: string };

/** Asks the API whether it can serve traffic. Never reports ok unless the API actually said so. */
export async function checkApiReady(signal?: AbortSignal): Promise<ReadyResult> {
  try {
    const response = await fetch(`${baseUrl}/health/ready`, signal ? { signal } : {});
    if (response.ok) return { kind: 'ok' };
    return { kind: 'not-ready', status: response.status };
  } catch (error) {
    return {
      kind: 'unreachable',
      reason: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
