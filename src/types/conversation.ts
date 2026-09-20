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
  /** 导入文件的内容指纹（仅导入还原的对话有值，用于同一文件重复导入时去重） */
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
