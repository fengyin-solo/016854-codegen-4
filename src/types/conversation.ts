import type { Message } from './message';

/**
 * 对话对象
 */
export interface Conversation {
  /** 对话唯一标识 */
  id: string;
  /** 对话标题 */
  title: string;
  /** 消息列表 */
  messages: Message[];
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 导入来源指纹（仅通过导入生成的对话携带，用于幂等去重） */
  importFingerprint?: string;
}

/**
 * 创建对话的参数
 */
export interface CreateConversationParams {
  title?: string;
}

/**
 * 对话列表排序方式
 */
export type ConversationSortBy = 'updatedAt' | 'createdAt' | 'title';

/**
 * 对话列表排序顺序
 */
export type SortOrder = 'asc' | 'desc';
