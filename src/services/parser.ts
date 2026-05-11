import { createInterface } from 'readline';
import type { StreamEvent } from '../types';

export async function* parseJsonlStream(stream: NodeJS.ReadableStream) {
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as StreamEvent;
    } catch (e) {
      console.error('Failed to parse line:', line, e);
    }
  }
}
