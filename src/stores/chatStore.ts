import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message, CreateMessageParams, ImportResult } from '../types';
import { saveConversations, loadConversations } from '../services/storage';
import {
  parseConversationExport,
  validateConversationExport,
  toImportedConversation,
} from '../services/conversationTransfer';
import { generateConversationTitle } from '../utils/formatters';

interface ChatState {
  /** 对话列表 */
  conversations: Conversation[];
  /** 当前活动对话 ID */
  activeConversationId: string | null;
  /** 是否正在流式响应 */
  isStreaming: boolean;
  /** 流式响应累积内容 */
  streamingContent: string;
  /** 流式响应消息 ID */
  streamingMessageId: string | null;
  /** 是否已初始化 */
  initialized: boolean;
}

interface ChatActions {
  /** 初始化（从 localStorage 加载） */
  initConversations: () => void;
  /** 创建新对话 */
  createConversation: (title?: string) => string;
  /** 删除对话 */
  deleteConversation: (id: string) => void;
  /** 设置活动对话 */
  setActiveConversation: (id: string | null) => void;
  /** 添加消息到对话 */
  addMessage: (conversationId: string, params: CreateMessageParams) => string;
  /** 更新消息 */
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  /** 开始流式响应 */
  startStreaming: (conversationId: string) => string;
  /** 追加流式内容 */
  appendStreamContent: (content: string) => void;
  /** 完成流式响应 */
  finishStreaming: (stats?: Message['stats']) => void;
  /** 取消流式响应 */
  cancelStreaming: () => void;
  /** 获取当前活动对话 */
  getActiveConversation: () => Conversation | null;
  /** 清除所有对话 */
  clearAllConversations: () => void;
  /** 更新对话标题 */
  updateConversationTitle: (id: string, title: string) => void;
  /**
   * 从导出文件文本导入对话
   * - 先完整解析与校验，任一环节失败都不会改动现有对话（原子性）
   * - 同一份文件重复导入时按指纹去重，直接定位到已导入的对话（幂等）
   * - 每次导入生成新的对话 ID，不会覆盖已有对话
   */
  importConversation: (raw: string) => ImportResult;
}

type ChatStore = ChatState & ChatActions;

// 持久化保存（防抖）
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedSave = (conversations: Conversation[]) => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    try {
      saveConversations(conversations);
    } catch (error) {
      console.error('Failed to save conversations:', error);
    }
  }, 500);
};

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  conversations: [],
  activeConversationId: null,
  isStreaming: false,
  streamingContent: '',
  streamingMessageId: null,
  initialized: false,

  // Actions
  initConversations: () => {
    const conversations = loadConversations();
    const activeId = conversations.length > 0 ? conversations[0]?.id ?? null : null;
    
    set({
      conversations,
      activeConversationId: activeId,
      initialized: true,
    });
  },

  createConversation: (title) => {
    const id = uuidv4();
    const now = Date.now();
    
    const newConversation: Conversation = {
      id,
      title: title || '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    
    set(state => {
      const conversations = [newConversation, ...state.conversations];
      debouncedSave(conversations);
      return {
        conversations,
        activeConversationId: id,
      };
    });
    
    return id;
  },

  deleteConversation: (id) => {
    set(state => {
      const conversations = state.conversations.filter(c => c.id !== id);
      debouncedSave(conversations);
      
      // 如果删除的是当前活动对话，切换到第一个对话
      let activeConversationId = state.activeConversationId;
      if (activeConversationId === id) {
        activeConversationId = conversations[0]?.id ?? null;
      }
      
      return {
        conversations,
        activeConversationId,
      };
    });
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
  },

  addMessage: (conversationId, params) => {
    const messageId = uuidv4();
    const now = Date.now();
    
    const newMessage: Message = {
      id: messageId,
      role: params.role,
      content: params.content,
      timestamp: now,
      status: params.status || 'complete',
    };
    
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;
        
        const messages = [...conv.messages, newMessage];
        
        // 如果是第一条用户消息，自动生成标题
        let title = conv.title;
        if (params.role === 'user' && conv.messages.length === 0) {
          title = generateConversationTitle(params.content);
        }
        
        return {
          ...conv,
          messages,
          title,
          updatedAt: now,
        };
      });
      
      // 重新排序（按更新时间降序）
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      
      debouncedSave(conversations);
      return { conversations };
    });
    
    return messageId;
  },

  updateMessage: (conversationId, messageId, updates) => {
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== messageId) return msg;
          return { ...msg, ...updates };
        });
        
        return {
          ...conv,
          messages,
          updatedAt: Date.now(),
        };
      });
      
      debouncedSave(conversations);
      return { conversations };
    });
  },

  startStreaming: (conversationId) => {
    const messageId = uuidv4();
    const now = Date.now();
    
    const streamingMessage: Message = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: now,
      status: 'streaming',
    };
    
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== conversationId) return conv;
        
        return {
          ...conv,
          messages: [...conv.messages, streamingMessage],
          updatedAt: now,
        };
      });
      
      return {
        conversations,
        isStreaming: true,
        streamingContent: '',
        streamingMessageId: messageId,
      };
    });
    
    return messageId;
  },

  appendStreamContent: (content) => {
    set(state => {
      const newContent = state.streamingContent + content;
      
      // 同时更新消息内容
      const conversations = state.conversations.map(conv => {
        if (conv.id !== state.activeConversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== state.streamingMessageId) return msg;
          return { ...msg, content: newContent };
        });
        
        return { ...conv, messages };
      });
      
      return {
        streamingContent: newContent,
        conversations,
      };
    });
  },

  finishStreaming: (stats) => {
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== state.activeConversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== state.streamingMessageId) return msg;
          return {
            ...msg,
            content: state.streamingContent,
            status: 'complete' as const,
            stats,
          };
        });
        
        return {
          ...conv,
          messages,
          updatedAt: Date.now(),
        };
      });
      
      debouncedSave(conversations);
      
      return {
        conversations,
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
      };
    });
  },

  cancelStreaming: () => {
    set(state => {
      // 保留已接收的内容，但标记为错误状态
      const conversations = state.conversations.map(conv => {
        if (conv.id !== state.activeConversationId) return conv;
        
        const messages = conv.messages.map(msg => {
          if (msg.id !== state.streamingMessageId) return msg;
          return {
            ...msg,
            content: state.streamingContent || '（响应已中断）',
            status: 'error' as const,
          };
        });
        
        return { ...conv, messages };
      });
      
      debouncedSave(conversations);
      
      return {
        conversations,
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
      };
    });
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find(c => c.id === activeConversationId) || null;
  },

  clearAllConversations: () => {
    set({
      conversations: [],
      activeConversationId: null,
    });
    debouncedSave([]);
  },

  updateConversationTitle: (id, title) => {
    set(state => {
      const conversations = state.conversations.map(conv => {
        if (conv.id !== id) return conv;
        return { ...conv, title };
      });

      debouncedSave(conversations);
      return { conversations };
    });
  },

  importConversation: (raw) => {
    // 1. 解析 JSON，失败时不改动任何状态
    const parsed = parseConversationExport(raw);
    if (!parsed.ok) {
      return { ok: false, errors: parsed.errors };
    }

    // 2. 完整校验全部消息，任一失败都不会写入（原子性：全部或没有）
    const validated = validateConversationExport(parsed.data);
    if (!validated.ok) {
      return { ok: false, errors: validated.errors };
    }

    const { file } = validated;

    // 3. 幂等：同一份文件已导入过时，直接定位到已有对话，不重复创建
    const existing = get().conversations.find(
      c => c.importFingerprint === file.fingerprint
    );
    if (existing) {
      set({ activeConversationId: existing.id });
      return {
        ok: true,
        conversationId: existing.id,
        title: existing.title,
        messageCount: existing.messages.length,
        duplicate: true,
      };
    }

    // 4. 构建新对话（新 ID，不影响也不覆盖任何已有对话）
    const conversation = toImportedConversation(file);
    const conversations = [conversation, ...get().conversations];

    // 5. 先持久化，成功后才提交内存状态；持久化失败则整体放弃，不留半截数据
    try {
      saveConversations(conversations);
    } catch (error) {
      console.error('Failed to persist imported conversation:', error);
      return {
        ok: false,
        errors: ['保存到本地存储失败，可能是存储空间不足。请清理部分历史对话后重试。'],
      };
    }

    set({ conversations, activeConversationId: conversation.id });
    // 取消此前可能排队中的旧快照保存，避免覆盖刚写入的数据
    debouncedSave(conversations);

    return {
      ok: true,
      conversationId: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.length,
      duplicate: false,
    };
  },
}));
