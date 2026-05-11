import type { StreamEvent, AssistantMessage, KanbanEvent } from '../types';

export class KanbanConverter {
  private cardIdCounter = 0;

  convert(event: StreamEvent, sessionId: string): KanbanEvent[] {
    const events: KanbanEvent[] = [];

    console.log(`[${sessionId}] 🔄 Converting event type: ${event.type}`);

    switch (event.type) {
      case 'system':
        events.push({
          type: 'session:start',
          session_id: sessionId,
        });
        break;

      case 'assistant': {
        const msg = event as AssistantMessage;
        const content = msg.message?.content?.[0];

        if (!content) break;

        if (content.type === 'thinking') {
          events.push({
            type: 'card:add',
            card: {
              id: `thinking-${sessionId}-${++this.cardIdCounter}`,
              column: 'THINKING',
              title: '🧠 Agent thinking...',
              content: content.thinking || '(Internal deliberation)',
              status: 'in-progress',
              timestamp: Date.now(),
              metadata: {
                signature: content.signature?.substring(0, 16) + '...',
              },
            },
          });
        } else if (content.type === 'text') {
          events.push({
            type: 'card:add',
            card: {
              id: `response-${sessionId}-${++this.cardIdCounter}`,
              column: 'FEEDBACK',
              title: '💬 Response',
              content: content.text || '',
              status: 'success',
              timestamp: Date.now(),
            },
          });
        } else if (content.type === 'tool_use') {
          const toolName = content.name || 'Unknown';
          events.push({
            type: 'card:add',
            card: {
              id: `action-${sessionId}-${++this.cardIdCounter}`,
              column: 'ACTIONS',
              title: `🔧 ${toolName}`,
              content: JSON.stringify(content.input || {}, null, 2),
              status: 'in-progress',
              timestamp: Date.now(),
              metadata: {
                toolName,
                input: content.input,
              },
            },
          });
        }
        break;
      }

      case 'user': {
        const msg = event as any;
        const toolResult = msg.message?.content?.[0];

        if (toolResult?.type === 'tool_result') {
          const isError = toolResult.is_error;
          events.push({
            type: 'card:add',
            card: {
              id: `result-${sessionId}-${++this.cardIdCounter}`,
              column: 'FEEDBACK',
              title: isError ? '❌ Tool Error' : '✅ Tool Result',
              content: toolResult.content || '',
              status: isError ? 'error' : 'success',
              timestamp: Date.now(),
            },
          });
        }
        break;
      }

      case 'result': {
        const resultEvent = event as any;
        events.push({
          type: 'session:end',
          session_id: sessionId,
          cost: resultEvent.total_cost_usd,
        });
        events.push({
          type: 'card:add',
          card: {
            id: `complete-${sessionId}-${++this.cardIdCounter}`,
            column: 'COMPLETE',
            title: '✨ Complete',
            content: `Total cost: $${resultEvent.total_cost_usd?.toFixed(4) || '0.0000'}`,
            status: 'success',
            timestamp: Date.now(),
            metadata: {
              modelUsage: resultEvent.modelUsage,
            },
          },
        });
        break;
      }
    }

    if (events.length > 0) {
      console.log(`[${sessionId}] ✅ Created ${events.length} Kanban event(s) from stream event`);
    }

    return events;
  }
}
