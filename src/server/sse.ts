import type { ServerResponse } from 'node:http';

/** Write the Server-Sent-Events response headers + the client retry hint. Shared by
 *  every SSE endpoint (the file tails in daemon-control, the terminal stream). */
export function sseHead(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
}
