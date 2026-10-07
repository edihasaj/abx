import { isProcessAlive } from './error-handling';

export interface StoppableServer {
  pid: number;
  port: number;
  token: string;
}

/** Stop only the recorded daemon. Shutdown may close HTTP before replying. */
export async function stopExistingServer(state: StoppableServer | null): Promise<boolean> {
  if (!state || !isProcessAlive(state.pid)) return false;

  let response: Response | undefined;
  let connectionError: unknown;
  try {
    response = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ command: 'stop', args: [] }),
      signal: AbortSignal.timeout(5000),
    });
    // Reading the body can also fail when shutdown closes the connection.
    await response.text();
  } catch (error) {
    connectionError = error;
  }
  if (response && !response.ok) {
    throw new Error(`Server refused to stop (HTTP ${response.status}).`);
  }

  const deadline = Date.now() + 3000;
  while (isProcessAlive(state.pid) && Date.now() < deadline) await Bun.sleep(50);
  if (isProcessAlive(state.pid)) {
    throw new Error('Server did not stop. No replacement was started.', { cause: connectionError });
  }
  return true;
}
