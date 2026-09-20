import { describe, it, expect } from 'vitest';
import type { Conversation, Message } from '@/types';
import { MAX_IMPORT_MESSAGES, CONVERSATION_EXPORT_VERSION } from '@/types';
import {
  buildConversationExport,
  serializeConversationExport,
  parseConversationExport,
  validateConversationExport,
  toImportedConversation,
  computeConversationFingerprint,
  buildExportFilename,
} from '@/services/conversationTransfer';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '你好',
    timestamp: 1700000000000,
    status: 'complete',
    ...overrides,
  };
}

function makeConversation(messages: Message[], overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: '测试对话',
    messages,
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  };
}

/** 走一遍合法的导出流程，返回可篡改的对象 */
function makeValidExportData(messages: Message[] = [makeMessage()]) {
  const file = buildConversationExport(makeConversation(messages));
  return JSON.parse(serializeConversationExport(file)) as Record<string, unknown>;
}

describe('conversationTransfer 导出', () => {
  it('导出文件包含格式标识、版本与全部消息', () => {
    const messages = [
      makeMessage({ id: 'm1', content: '第一条', timestamp: 1000 }),
      makeMessage({ id: 'm2', role: 'assistant', content: '第二条', timestamp: 2000 }),
    ];
    const file = buildConversationExport(makeConversation(messages));

    expect(file.format).toBe('react-chat-conversation-export');
    expect(file.version).toBe(CONVERSATION_EXPORT_VERSION);
    expect(file.messages).toHaveLength(2);
    expect(file.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('导出文件名清理非法字符', () => {
    const filename = buildExportFilename('a/b\\c:d*e?f"g<h>i|j 标题', 1700000000000);
    expect(filename).not.toMatch(/[\\/:*?"<>|\s]/);
    expect(filename).toMatch(/^对话导出-.+-\d{8}-\d{6}\.json$/);

    expect(buildExportFilename('   ', 1700000000000)).toMatch(/^对话导出-对话-/);
  });
});

describe('conversationTransfer 往返还原', () => {
  it('导出→序列化→解析→校验→还原后，消息条数、顺序、正文与时间一致', () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', content: '问题一', timestamp: 1111 }),
      makeMessage({ id: 'm2', role: 'assistant', content: '回答一', timestamp: 2222 }),
      makeMessage({ id: 'm3', role: 'user', content: '问题二', timestamp: 3333 }),
    ];
    const original = makeConversation(messages);

    const text = serializeConversationExport(buildConversationExport(original));
    const parsed = parseConversationExport(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const validated = validateConversationExport(parsed.data);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const restored = toImportedConversation(validated.file);
    expect(restored.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(restored.messages.map((m) => m.content)).toEqual(['问题一', '回答一', '问题二']);
    expect(restored.messages.map((m) => m.timestamp)).toEqual([1111, 2222, 3333]);
    expect(restored.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(restored.title).toBe('测试对话');
    // 还原的对话使用新 ID，避免与本机已有对话冲突
    expect(restored.id).not.toBe(original.id);
  });

  it('还原时把进行中的状态规范化为 complete', () => {
    const messages = [
      makeMessage({ id: 'm1', status: 'streaming' }),
      makeMessage({ id: 'm2', status: 'pending' }),
      makeMessage({ id: 'm3', status: 'error' }),
    ];
    const data = makeValidExportData(messages);
    const validated = validateConversationExport(data);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const restored = toImportedConversation(validated.file);
    expect(restored.messages.map((m) => m.status)).toEqual(['complete', 'complete', 'error']);
  });
});

describe('conversationTransfer 校验与可读错误', () => {
  it('空文本与非 JSON 文本给出可读提示', () => {
    const empty = parseConversationExport('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]).toContain('文件内容为空');

    const broken = parseConversationExport('{not json');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toContain('不是有效的 JSON');
  });

  it('格式标识不匹配时提示确认文件来源', () => {
    const result = validateConversationExport({ format: 'something-else', messages: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('格式标识不匹配');
  });

  it('版本过高时提示升级应用', () => {
    const data = makeValidExportData();
    data.version = CONVERSATION_EXPORT_VERSION + 1;
    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('请升级应用后再导入');
  });

  it('正文缺失时报第几条并给出建议', () => {
    const data = makeValidExportData([
      makeMessage({ id: 'm1', content: '正常' }),
      makeMessage({ id: 'm2', content: '正常' }),
    ]);
    (data.messages as Array<Record<string, unknown>>)[1]!.content = '';

    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('第 2 条消息缺少正文内容');
      expect(result.errors[0]).toContain('重新从原设备导出');
    }
  });

  it('时间格式不对时报第几条并说明期望格式', () => {
    const data = makeValidExportData([makeMessage({ id: 'm1' })]);
    (data.messages as Array<Record<string, unknown>>)[0]!.timestamp = '2024-01-01';

    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('第 1 条消息的时间格式不正确');
      expect(result.errors[0]).toContain('毫秒时间戳');
    }
  });

  it('时间为负数或零同样被拒绝', () => {
    const data = makeValidExportData([makeMessage({ id: 'm1' })]);
    (data.messages as Array<Record<string, unknown>>)[0]!.timestamp = -5;
    expect(validateConversationExport(data).ok).toBe(false);
  });

  it('条数超过上限时给出拆分建议', () => {
    const tooMany = Array.from({ length: MAX_IMPORT_MESSAGES + 1 }, (_, i) =>
      makeMessage({ id: `m${i}` })
    );
    const data = makeValidExportData(tooMany);

    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain(`超过单次导入上限 ${MAX_IMPORT_MESSAGES} 条`);
      expect(result.errors[0]).toContain('拆分');
    }
  });

  it('角色无效时给出可读错误', () => {
    const data = makeValidExportData([makeMessage({ id: 'm1' })]);
    (data.messages as Array<Record<string, unknown>>)[0]!.role = 'robot';

    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('角色（role）无效');
  });

  it('多个问题一次性汇总，超出上限的问题汇总提示', () => {
    const bad = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      role: 'user',
      content: '',
      timestamp: 1000 + i,
    }));
    const data = makeValidExportData();
    data.messages = bad;

    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 5 条逐条 + 1 条汇总
      expect(result.errors).toHaveLength(6);
      expect(result.errors[5]).toContain('另外 3 个问题');
    }
  });

  it('缺少消息列表时提示文件不完整', () => {
    const data = makeValidExportData();
    delete data.messages;
    const result = validateConversationExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('缺少消息列表');
  });
});

describe('conversationTransfer 指纹', () => {
  it('同一份内容指纹稳定，内容变化指纹变化', () => {
    const messages = [
      { id: 'm1', role: 'user' as const, content: '你好', timestamp: 1000 },
      { id: 'm2', role: 'assistant' as const, content: '世界', timestamp: 2000 },
    ];

    const a = computeConversationFingerprint('conv-1', messages);
    const b = computeConversationFingerprint('conv-1', messages);
    expect(a).toBe(b);

    const changed = computeConversationFingerprint('conv-1', [
      messages[0]!,
      { ...messages[1]!, content: '世界！' },
    ]);
    expect(changed).not.toBe(a);

    const otherConv = computeConversationFingerprint('conv-2', messages);
    expect(otherConv).not.toBe(a);
  });
});
