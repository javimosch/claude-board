// Streaming mode event types from Claude CLI
export interface StreamEvent {
  type: 'system' | 'rate_limit_event' | 'assistant' | 'user' | 'result' | 'thinking';
  [key: string]: unknown;
}

export interface SystemInitEvent {
  type: 'system';
  cwd: string;
  session_id: string;
  model: string;
  tools: string[];
  permissionMode: string;
  rate_limit_info: {
    status: string;
    resetsAt: number;
  };
}

export interface AssistantMessage {
  type: 'assistant';
  message: {
    content: Array<{
      type: 'thinking' | 'text' | 'tool_use';
      thinking?: string;
      signature?: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export interface ToolResultEvent {
  type: 'user';
  message: {
    content: Array<{
      type: 'tool_result';
      tool_use_id?: string;
      content: string;
      is_error: boolean;
    }>;
  };
}

export interface ResultEvent {
  type: 'result';
  total_cost_usd: number;
  modelUsage: Record<
    string,
    {
      costUSD: number;
      inputTokens: number;
      outputTokens: number;
    }
  >;
  usage: {
    iterations: Array<{
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
    }>;
  };
  permission_denials?: Array<{
    tool: string;
    reason: string;
  }>;
}

// Kanban card types
export interface KanbanCard {
  id: string;
  column: 'THINKING' | 'ACTIONS' | 'FEEDBACK' | 'COMPLETE';
  title: string;
  content: string;
  status: 'pending' | 'in-progress' | 'success' | 'error' | 'warning';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface KanbanEvent {
  type:
    | 'card:add'
    | 'card:update'
    | 'card:move'
    | 'card:remove'
    | 'session:start'
    | 'session:end'
    | 'approval:required';
  card?: KanbanCard;
  cardId?: string;
  session_id?: string;
  cost?: number;
  planned_tools?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    description: string;
  }>;
}

// Session management
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExecutionSession {
  id: string;
  status: 'planning' | 'executing' | 'completed' | 'error';
  prompt: string;
  cards: Map<string, KanbanCard>;
  events: StreamEvent[];
  totalCost: number;
  startTime: number;
  endTime?: number;
  requiresApproval: boolean;
  approvalPending?: boolean;
  plannedTools?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  // Conversation history for follow-ups
  conversationHistory: ConversationMessage[];
  // Project management
  projectId?: string;
  cwd?: string;
}

// Project type
export interface Project {
  id: string;
  name: string;
  cwd: string;
  created_at: number;
  last_used: number;
}
