import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message, MessageRole, MessageStatus, MessageStats } from '../types';

/**
 * 对话导出 / 导入（迁移）工具
 *
 * 导出：把一条对话的消息列表（正文 + 时间）序列化为 JSON 文件供下载；
 * 导入：在另一台机器上解析该文件，逐条校验后一次性还原为新对话。
 *
 * 设计要点：
 * - 校验全部通过前不写入任何数据，保证不会"只还原一半"；
 * - 每个文件有内容指纹，同一文件重复导入不会生成重复消息；
 * - 导入总是创建新对话，不修改、不覆盖已有对话。
 */

/** 导出文件格式标识 */
export const EXPORT_FORMAT = 'react-chat-conversation-export';

/** 当前支持的导出文件版本 */
export const EXPORT_VERSION = 1;

/** 单次导入允许的最大消息条数 */
export const MAX_IMPORT_MESSAGES = 1000;

/** 导入文件大小上限（10 MB） */
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

/** 校验报告中最多展示的问题条数（超出部分汇总提示） */
const MAX_REPORTED_ISSUES = 20;

/** 可接受的时间戳范围：1970 之后 ~ 2100-01-01 */
const MAX_TIMESTAMP = 4102444800000;

const VALID_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system'];

/**
 * 导出文件中的消息结构
 */
export interface ExportedMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  status?: MessageStatus;
  stats?: MessageStats;
}

/**
 * 导出文件中的对话结构
 */
export interface ExportedConversation {
  id: string;
  title: string;
  createdAt: number;
  messages: ExportedMessage[];
}

/**
 * 导出文件的完整结构
 */
export interface ConversationExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  /** 对话内容的校验和，用于发现文件被修改或损坏 */
  checksum: string;
  conversation: ExportedConversation;
}

/**
 * 校验发现的问题（带可读的处理建议）
 */
export interface ImportIssue {
  /** 出问题的消息序号（从 1 开始）；文件整体问题为 null */
  index: number | null;
  /** 问题描述 */
  problem: string;
  /** 处理建议 */
  suggestion: string;
}

/**
 * 校验并规范化后的导入数据
 */
export interface NormalizedImport {
  /** 导出文件中的原对话 id */
  sourceId: string;
  title: string;
  createdAt: number;
  messages: Message[];
  /** 内容指纹，用于同一文件的幂等导入 */
  fingerprint: string;
}

export type ParseImportResult =
  | { ok: true; data: NormalizedImport; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[] };

/**
 * 计算字符串的内容指纹（FNV-1a 与 djb2 双哈希拼接，避免单哈希碰撞）
 * @param input 输入字符串
 * @returns 16 位十六进制指纹
 */
function hashString(input: string): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = (Math.imul(djb, 33) ^ code) >>> 0;
  }
  return (fnv >>> 0).toString(16).padStart(8, '0') + (djb >>> 0).toString(16).padStart(8, '0');
}

/**
 * 生成对话内容的规范化字符串（字段顺序固定，保证同样内容得到同样结果）
 */
function canonicalConversationPayload(conversation: ExportedConversation): string {
  return JSON.stringify({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    messages: conversation.messages.map(m => [m.id, m.role, m.timestamp, m.content]),
  });
}

/**
 * 计算对话内容指纹（同一文件每次计算结果相同，作为幂等导入的依据）
 */
export function computeConversationFingerprint(conversation: ExportedConversation): string {
  return hashString(canonicalConversationPayload(conversation));
}

/**
 * 把对话序列化为导出文件的文本内容
 * @param conversation 要导出的对话
 * @param exportedAt 导出时间戳（默认当前时间）
 * @returns 格式化后的 JSON 文本
 */
export function serializeConversationExport(conversation: Conversation, exportedAt: number = Date.now()): string {
  const exported: ExportedConversation = {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    messages: conversation.messages.map(m => {
      const msg: ExportedMessage = {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        status: m.status,
      };
      if (m.stats) {
        msg.stats = m.stats;
      }
      return msg;
    }),
  };

  const file: ConversationExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    checksum: computeConversationFingerprint(exported),
    conversation: exported,
  };

  return JSON.stringify(file, null, 2);
}

/**
 * 清理文件名中的非法字符
 */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 40) || 'conversation';
}

/**
 * 生成导出文件名
 * @param conversation 要导出的对话
 * @param exportedAt 导出时间戳
 */
export function buildExportFileName(conversation: Conversation, exportedAt: number = Date.now()): string {
  const date = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${sanitizeFileName(conversation.title)}-${stamp}.json`;
}

/**
 * 触发浏览器下载对话导出文件
 * @param conversation 要导出的对话
 */
export function downloadConversationExport(conversation: Conversation): void {
  const text = serializeConversationExport(conversation);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildExportFileName(conversation);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * 把未知值规范化为合法时间戳
 * @returns 合法的毫秒时间戳；无法识别时返回 null
 */
function normalizeTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 0 && raw <= MAX_TIMESTAMP ? Math.round(raw) : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    // 纯数字字符串按毫秒时间戳处理
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return num > 0 && num <= MAX_TIMESTAMP ? num : null;
    }
    // 其余字符串尝试按日期解析（如 ISO 8601）
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= MAX_TIMESTAMP) {
      return parsed;
    }
  }
  return null;
}

/**
 * 规范化消息状态：中间态（pending/streaming）还原后视为已完成
 */
function normalizeStatus(raw: unknown): MessageStatus {
  return raw === 'error' ? 'error' : 'complete';
}

/**
 * 规范化统计信息：只保留合法的数字字段，整体不合法则丢弃
 */
function normalizeStats(raw: unknown): MessageStats | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const stats: MessageStats = {
    responseTime: typeof source.responseTime === 'number' && Number.isFinite(source.responseTime) ? source.responseTime : 0,
    tokenCount: typeof source.tokenCount === 'number' && Number.isFinite(source.tokenCount) ? source.tokenCount : 0,
  };
  if (typeof source.completionTokens === 'number' && Number.isFinite(source.completionTokens)) {
    stats.completionTokens = source.completionTokens;
  }
  if (typeof source.promptTokens === 'number' && Number.isFinite(source.promptTokens)) {
    stats.promptTokens = source.promptTokens;
  }
  return stats;
}

/**
 * 解析并校验对话导入文件
 *
 * 逐条收集所有问题（而不是遇到第一个就停止），便于用户一次修完；
 * 只有全部校验通过才返回规范化数据，否则不产出任何可写入的内容。
 *
 * @param text 文件文本内容
 * @param fallbackNow 文件缺少时间信息时的兜底时间（默认当前时间，测试可注入固定值）
 */
export function parseConversationImport(text: string, fallbackNow: number = Date.now()): ParseImportResult {
  // 1. 解析 JSON
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: '文件内容不是有效的 JSON，可能已损坏或不完整',
        suggestion: '请重新从原设备导出该对话后再上传；如果手动修改过文件，请检查是否有多余或缺失的括号、引号',
      }],
    };
  }

  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  let totalErrors = 0;
  const pushIssue = (list: ImportIssue[], issue: ImportIssue) => {
    if (list.length < MAX_REPORTED_ISSUES) {
      list.push(issue);
    }
  };
  const pushError = (issue: ImportIssue) => {
    totalErrors += 1;
    pushIssue(errors, issue);
  };

  // 2. 校验文件整体结构
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: '文件结构不正确，不是一份对话导出文件',
        suggestion: '请确认上传的是本应用「导出对话」生成的 .json 文件',
      }],
    };
  }

  const file = raw as Record<string, unknown>;

  if (file.format !== EXPORT_FORMAT) {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: '文件格式标识不匹配，不是本应用导出的对话文件',
        suggestion: '请使用本应用「导出对话」功能生成的文件；如果是其他来源的备份，请先转换成该格式',
      }],
    };
  }

  if (typeof file.version !== 'number' || file.version > EXPORT_VERSION) {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: `文件版本（${String(file.version)}）高于当前应用支持的版本（${EXPORT_VERSION}）`,
        suggestion: '该文件可能由更新版本的应用导出，请升级应用后再导入',
      }],
    };
  }

  const conversation = file.conversation as Record<string, unknown> | undefined;
  if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: '文件中缺少对话数据（conversation 字段）',
        suggestion: '文件可能不完整，请重新导出后再上传',
      }],
    };
  }

  // 3. 校验消息列表
  const rawMessages = conversation.messages;
  if (!Array.isArray(rawMessages)) {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: '文件中的消息列表（messages 字段）缺失或不是数组',
        suggestion: '文件可能不完整，请重新导出后再上传',
      }],
    };
  }

  if (rawMessages.length > MAX_IMPORT_MESSAGES) {
    return {
      ok: false,
      errors: [{
        index: null,
        problem: `文件包含 ${rawMessages.length} 条消息，超过单次导入上限 ${MAX_IMPORT_MESSAGES} 条`,
        suggestion: '请将对话拆分为多个不超过上限的文件分批导入，或联系管理员调整上限',
      }],
    };
  }

  const sourceId = typeof conversation.id === 'string' && conversation.id ? conversation.id : uuidv4();
  const title = typeof conversation.title === 'string' && conversation.title.trim()
    ? conversation.title
    : '导入的对话';

  const messages: Message[] = [];
  const usedIds = new Set<string>();
  let earliestTimestamp: number | null = null;

  for (let i = 0; i < rawMessages.length; i++) {
    const index = i + 1;
    const rawMessage = rawMessages[i] as unknown;

    if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
      pushError({
        index,
        problem: `第 ${index} 条消息不是有效的消息对象`,
        suggestion: '请检查该条消息是否完整，或将其从文件中删除后重新导入',
      });
      continue;
    }

    const msg = rawMessage as Record<string, unknown>;
    let hasError = false;

    // 角色
    let role: MessageRole = 'user';
    if (!VALID_ROLES.includes(msg.role as MessageRole)) {
      pushError({
        index,
        problem: `第 ${index} 条消息的角色（role）无效：${JSON.stringify(msg.role)}`,
        suggestion: '角色只能是 "user"、"assistant" 或 "system"，请修正后重新导入',
      });
      hasError = true;
    } else {
      role = msg.role as MessageRole;
    }

    // 正文
    let content = '';
    if (typeof msg.content !== 'string') {
      pushError({
        index,
        problem: `第 ${index} 条消息缺少正文（content 字段缺失或不是文本）`,
        suggestion: '请为该条消息补上 content 文本，或将其从文件中删除后重新导入',
      });
      hasError = true;
    } else if (!msg.content.trim()) {
      pushError({
        index,
        problem: `第 ${index} 条消息的正文为空`,
        suggestion: '请为该条消息补上正文内容，或将其从文件中删除后重新导入',
      });
      hasError = true;
    } else {
      content = msg.content;
    }

    // 时间
    const timestamp = normalizeTimestamp(msg.timestamp);
    if (timestamp === null) {
      pushError({
        index,
        problem: `第 ${index} 条消息的时间格式不正确：${JSON.stringify(msg.timestamp)}`,
        suggestion: '时间应为毫秒时间戳（如 1726768800000）或 ISO 8601 日期字符串（如 2024-09-20T08:00:00.000Z），请修正后重新导入',
      });
      hasError = true;
    }

    if (hasError) {
      continue;
    }

    // 消息 id：缺失或重复时重新生成，保证对话内唯一
    let id = typeof msg.id === 'string' && msg.id ? msg.id : uuidv4();
    while (usedIds.has(id)) {
      id = uuidv4();
    }
    usedIds.add(id);

    if (timestamp !== null && (earliestTimestamp === null || timestamp < earliestTimestamp)) {
      earliestTimestamp = timestamp;
    }

    const message: Message = {
      id,
      role,
      content,
      timestamp: timestamp as number,
      status: normalizeStatus(msg.status),
    };
    const stats = normalizeStats(msg.stats);
    if (stats) {
      message.stats = stats;
    }
    messages.push(message);
  }

  // 问题过多时补充汇总提示，引导用户分批修复
  if (totalErrors > errors.length) {
    errors.push({
      index: null,
      problem: `共发现 ${totalErrors} 个问题，其余 ${totalErrors - errors.length} 个未列出`,
      suggestion: '请先按上面的建议修复，再重新导入查看剩余问题',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // 4. 对话级时间
  const createdAt = normalizeTimestamp(conversation.createdAt)
    ?? earliestTimestamp
    ?? fallbackNow;

  // 5. 校验和（仅警告，不阻止导入，方便用户手动修正文件后导入）
  const normalizedExported: ExportedConversation = {
    id: sourceId,
    title,
    createdAt,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
  };

  if (typeof file.checksum === 'string' && file.checksum) {
    // 校验和基于文件中的原始数据计算
    const rawConversation = conversation as unknown as ExportedConversation;
    const rawMessagesValid = Array.isArray(rawConversation.messages)
      && rawConversation.messages.every(m => m && typeof m === 'object');
    if (rawMessagesValid) {
      const actualChecksum = computeConversationFingerprint({
        id: sourceId,
        title: typeof conversation.title === 'string' ? conversation.title : title,
        createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : createdAt,
        messages: rawConversation.messages,
      });
      if (actualChecksum !== file.checksum) {
        warnings.push({
          index: null,
          problem: '文件校验和不匹配，文件在传输过程中可能被修改或损坏',
          suggestion: '如果消息内容确认无误可以继续导入；否则建议重新从原设备导出后再上传',
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      sourceId,
      title,
      createdAt,
      messages,
      fingerprint: computeConversationFingerprint(normalizedExported),
    },
    warnings,
  };
}
