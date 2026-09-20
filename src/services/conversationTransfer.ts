import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message, MessageStatus } from '../types';
import {
  CONVERSATION_EXPORT_FORMAT,
  CONVERSATION_EXPORT_VERSION,
  MAX_IMPORT_MESSAGES,
} from '../types/conversationTransfer';
import type {
  ConversationExportFile,
  ExportedMessage,
  ValidationResult,
} from '../types/conversationTransfer';

/** 校验失败时最多逐条列出的问题数量，超出部分汇总提示 */
const MAX_REPORTED_ERRORS = 5;

const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const VALID_STATUSES = new Set(['pending', 'streaming', 'complete', 'error']);

/**
 * FNV-1a 哈希（32 位），输出 8 位十六进制字符串
 */
function fnv1a(input: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 计算对话内容指纹
 * 由来源对话 ID 与全部消息的 id/role/content/timestamp 决定，
 * 同一份导出文件无论何时上传都会得到相同的指纹，用于幂等去重。
 */
export function computeConversationFingerprint(
  sourceConversationId: string,
  messages: ExportedMessage[]
): string {
  const serialized =
    sourceConversationId +
    '\n' +
    messages
      .map((m) => [m.id, m.role, m.content, String(m.timestamp)].join('\u0001'))
      .join('\u0002');
  // 两个不同种子的哈希拼接，降低碰撞概率
  return fnv1a(serialized, 0x811c9dc5) + fnv1a(serialized, 0x811c9dc5 ^ 0x9e3779b9);
}

/**
 * 构建对话导出文件内容
 */
export function buildConversationExport(conversation: Conversation): ConversationExportFile {
  const messages: ExportedMessage[] = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    status: m.status,
    ...(m.stats ? { stats: m.stats } : {}),
  }));

  return {
    format: CONVERSATION_EXPORT_FORMAT,
    version: CONVERSATION_EXPORT_VERSION,
    exportedAt: Date.now(),
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    fingerprint: computeConversationFingerprint(conversation.id, messages),
    messages,
  };
}

/**
 * 序列化导出文件为 JSON 文本
 */
export function serializeConversationExport(file: ConversationExportFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * 生成导出文件名（清理标题中的非法字符）
 */
export function buildExportFilename(title: string, exportedAt: number = Date.now()): string {
  const safeTitle =
    title
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || '对话';

  const d = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  return `对话导出-${safeTitle}-${stamp}.json`;
}

/**
 * 导出对话并触发浏览器下载
 * @returns 下载的文件名
 */
export function downloadConversationExport(conversation: Conversation): string {
  const file = buildConversationExport(conversation);
  const json = serializeConversationExport(file);
  const filename = buildExportFilename(conversation.title, file.exportedAt);

  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return filename;
}

/**
 * 解析导入文件的 JSON 文本
 */
export function parseConversationExport(
  raw: string
): { ok: true; data: unknown } | { ok: false; errors: string[] } {
  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      errors: ['文件内容为空。请确认选择的是从本应用导出的对话文件，或重新导出后再试。'],
    };
  }

  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      errors: ['文件内容不是有效的 JSON，可能已损坏或被修改。请重新从原设备导出后再试。'],
    };
  }
}

/**
 * 校验导入文件结构，全部问题一次性收集，错误信息附带处理建议
 */
export function validateConversationExport(data: unknown): ValidationResult {
  const errors: string[] = [];
  let overflowCount = 0;

  const report = (message: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) {
      errors.push(message);
    } else {
      overflowCount++;
    }
  };

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      errors: ['文件结构不正确：应为对话导出文件（JSON 对象）。请确认文件未经过手动修改。'],
    };
  }

  const record = data as Record<string, unknown>;

  // 格式标识
  if (record.format !== CONVERSATION_EXPORT_FORMAT) {
    return {
      ok: false,
      errors: [
        '这不是有效的对话导出文件（格式标识不匹配）。请确认选择的是从本应用导出的 JSON 文件。',
      ],
    };
  }

  // 版本
  if (typeof record.version !== 'number' || !Number.isInteger(record.version)) {
    report('文件缺少有效的版本号。请使用本应用重新导出的文件。');
  } else if (record.version > CONVERSATION_EXPORT_VERSION) {
    return {
      ok: false,
      errors: [
        `文件版本（v${record.version}）高于当前应用支持的版本（v${CONVERSATION_EXPORT_VERSION}）。请升级应用后再导入。`,
      ],
    };
  }

  // 对话元信息（宽松处理，缺失时使用兜底值）
  const meta = (typeof record.conversation === 'object' && record.conversation !== null
    ? record.conversation
    : {}) as Record<string, unknown>;

  const exportedAt =
    typeof record.exportedAt === 'number' && Number.isFinite(record.exportedAt)
      ? record.exportedAt
      : Date.now();

  const sourceId = typeof meta.id === 'string' ? meta.id : '';
  const title =
    typeof meta.title === 'string' && meta.title.trim().length > 0 ? meta.title : '导入的对话';
  const createdAt =
    typeof meta.createdAt === 'number' && Number.isFinite(meta.createdAt) && meta.createdAt > 0
      ? meta.createdAt
      : exportedAt;
  const updatedAt =
    typeof meta.updatedAt === 'number' && Number.isFinite(meta.updatedAt) && meta.updatedAt > 0
      ? meta.updatedAt
      : createdAt;

  // 消息列表
  if (!Array.isArray(record.messages)) {
    return {
      ok: false,
      errors: ['文件中缺少消息列表（messages）。文件可能不完整，请重新导出后再试。'],
    };
  }

  if (record.messages.length > MAX_IMPORT_MESSAGES) {
    return {
      ok: false,
      errors: [
        `文件包含 ${record.messages.length} 条消息，超过单次导入上限 ${MAX_IMPORT_MESSAGES} 条。建议将对话拆分为多个部分分别导出后再导入。`,
      ],
    };
  }

  const messages: ExportedMessage[] = [];

  record.messages.forEach((item, index) => {
    const position = index + 1;

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      report(`第 ${position} 条消息结构不正确。请检查导出文件是否完整，或重新从原设备导出。`);
      return;
    }

    const raw = item as Record<string, unknown>;

    // 正文
    if (typeof raw.content !== 'string' || raw.content.trim().length === 0) {
      report(`第 ${position} 条消息缺少正文内容。请检查导出文件是否完整，或重新从原设备导出。`);
      return;
    }

    // 时间
    if (
      typeof raw.timestamp !== 'number' ||
      !Number.isFinite(raw.timestamp) ||
      raw.timestamp <= 0
    ) {
      report(
        `第 ${position} 条消息的时间格式不正确：应为毫秒时间戳（正数）。请检查文件是否被修改或损坏。`
      );
      return;
    }

    // 角色
    if (typeof raw.role !== 'string' || !VALID_ROLES.has(raw.role)) {
      report(
        `第 ${position} 条消息的角色（role）无效，应为 user / assistant / system 之一。请检查文件是否被修改。`
      );
      return;
    }

    // 状态（可选，无效时按 complete 处理）
    let status: MessageStatus | undefined;
    if (typeof raw.status === 'string' && VALID_STATUSES.has(raw.status)) {
      status = raw.status as MessageStatus;
    }

    // 统计信息（可选，结构不完整时丢弃，不影响导入）
    let stats: ExportedMessage['stats'];
    if (typeof raw.stats === 'object' && raw.stats !== null) {
      const s = raw.stats as Record<string, unknown>;
      if (typeof s.responseTime === 'number' && typeof s.tokenCount === 'number') {
        stats = {
          responseTime: s.responseTime,
          tokenCount: s.tokenCount,
          ...(typeof s.completionTokens === 'number'
            ? { completionTokens: s.completionTokens }
            : {}),
          ...(typeof s.promptTokens === 'number' ? { promptTokens: s.promptTokens } : {}),
        };
      }
    }

    messages.push({
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : uuidv4(),
      role: raw.role as ExportedMessage['role'],
      content: raw.content,
      timestamp: raw.timestamp,
      ...(status ? { status } : {}),
      ...(stats ? { stats } : {}),
    });
  });

  if (errors.length > 0 || overflowCount > 0) {
    if (overflowCount > 0) {
      errors.push(`……以及另外 ${overflowCount} 个问题。建议重新从原设备导出完整文件后再试。`);
    }
    return { ok: false, errors };
  }

  const file: ConversationExportFile = {
    format: CONVERSATION_EXPORT_FORMAT,
    version: typeof record.version === 'number' ? record.version : CONVERSATION_EXPORT_VERSION,
    exportedAt,
    conversation: { id: sourceId, title, createdAt, updatedAt },
    fingerprint: computeConversationFingerprint(sourceId, messages),
    messages,
  };

  return { ok: true, file };
}

/**
 * 将校验通过的导出文件转换为可入库的对话对象
 * 对话 ID 重新生成，避免与本机已有对话冲突；消息保持原始条数与先后顺序。
 */
export function toImportedConversation(
  file: ConversationExportFile,
  newId: string = uuidv4()
): Conversation {
  const normalizeStatus = (status?: MessageStatus): MessageStatus => {
    // 还原后不应存在"进行中"的状态，统一按已完成处理
    if (!status || status === 'streaming' || status === 'pending') {
      return 'complete';
    }
    return status;
  };

  const messages: Message[] = file.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    status: normalizeStatus(m.status),
    ...(m.stats ? { stats: m.stats } : {}),
  }));

  return {
    id: newId,
    title: file.conversation.title,
    messages,
    createdAt: file.conversation.createdAt,
    updatedAt: file.conversation.updatedAt,
    importFingerprint: file.fingerprint,
  };
}
