import type { MessageRole, MessageStatus, MessageStats } from './message';

/**
 * 对话导出文件格式标识
 */
export const CONVERSATION_EXPORT_FORMAT = 'react-chat-conversation-export' as const;

/**
 * 当前导出文件版本
 */
export const CONVERSATION_EXPORT_VERSION = 1;

/**
 * 单次导入允许的最大消息条数
 */
export const MAX_IMPORT_MESSAGES = 500;

/**
 * 导出文件中的单条消息
 */
export interface ExportedMessage {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色 */
  role: MessageRole;
  /** 消息正文 */
  content: string;
  /** 创建时间戳（毫秒） */
  timestamp: number;
  /** 消息状态（可选，缺省按 complete 处理） */
  status?: MessageStatus;
  /** 统计信息（可选，仅 assistant 消息） */
  stats?: MessageStats;
}

/**
 * 对话导出文件结构
 */
export interface ConversationExportFile {
  /** 格式标识，用于识别文件类型 */
  format: typeof CONVERSATION_EXPORT_FORMAT;
  /** 文件格式版本 */
  version: number;
  /** 导出时间戳（毫秒） */
  exportedAt: number;
  /** 来源对话的元信息 */
  conversation: {
    /** 来源对话 ID */
    id: string;
    /** 对话标题 */
    title: string;
    /** 创建时间戳 */
    createdAt: number;
    /** 最后更新时间戳 */
    updatedAt: number;
  };
  /** 内容指纹：由来源对话 ID 与全部消息计算得出，用于幂等去重 */
  fingerprint: string;
  /** 消息列表（按原始先后顺序排列） */
  messages: ExportedMessage[];
}

/**
 * 导入成功结果
 */
export interface ImportSuccess {
  ok: true;
  /** 导入后（或已存在的）对话 ID */
  conversationId: string;
  /** 对话标题 */
  title: string;
  /** 消息条数 */
  messageCount: number;
  /** 是否为重复导入（true 表示此前已导入过，本次未重复创建） */
  duplicate: boolean;
}

/**
 * 导入失败结果
 */
export interface ImportFailure {
  ok: false;
  /** 可读的校验错误与处理建议 */
  errors: string[];
}

export type ImportResult = ImportSuccess | ImportFailure;

/**
 * 校验通过结果
 */
export interface ValidationSuccess {
  ok: true;
  file: ConversationExportFile;
}

/**
 * 校验失败结果
 */
export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;
