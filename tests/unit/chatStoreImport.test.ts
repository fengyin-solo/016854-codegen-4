import { describe, it, expect, beforeEach } from 'vitest';
import type { Conversation, Message } from '@/types';
import { MAX_IMPORT_MESSAGES } from '@/types';
import {
  buildConversationExport,
  serializeConversationExport,
} from '@/services/conversationTransfer';
import { useChatStore } from '@/stores/chatStore';

// ---- localStorage 内存模拟（storage 服务在函数内访问 localStorage，此处先行注入） ----
const storageData = new Map<string, string>();
let setItemFailures = 0;

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storageData.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (setItemFailures > 0) {
        setItemFailures--;
        throw new Error('模拟存储写入失败');
      }
      storageData.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageData.delete(key);
    },
    clear: () => storageData.clear(),
  },
});

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
    id: `conv-${Math.random().toString(36).slice(2)}`,
    title: '测试对话',
    messages,
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  };
}

function exportTextOf(conversation: Conversation): string {
  return serializeConversationExport(buildConversationExport(conversation));
}

function resetStore() {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    streamingContent: '',
    streamingMessageId: null,
    initialized: true,
  });
}

beforeEach(() => {
  storageData.clear();
  setItemFailures = 0;
  resetStore();
});

describe('chatStore.importConversation 还原', () => {
  it('还原后消息条数与先后次序和原来相同，已有对话保持不变', () => {
    const existing = makeConversation([makeMessage({ id: 'old-1', content: '旧消息' })], {
      id: 'existing-conv',
      title: '已有对话',
    });
    useChatStore.setState({ conversations: [existing], activeConversationId: existing.id });

    const source = makeConversation(
      [
        makeMessage({ id: 'm1', role: 'user', content: '问题一', timestamp: 1111 }),
        makeMessage({ id: 'm2', role: 'assistant', content: '回答一', timestamp: 2222 }),
        makeMessage({ id: 'm3', role: 'user', content: '问题二', timestamp: 3333 }),
      ],
      { id: 'source-conv', title: '带走的对话' }
    );

    const result = useChatStore.getState().importConversation(exportTextOf(source));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.messageCount).toBe(3);

    const state = useChatStore.getState();
    expect(state.conversations).toHaveLength(2);
    // 已有对话保持不变
    expect(state.conversations[1]).toEqual(existing);
    // 新对话在最前并成为活动对话
    const imported = state.conversations[0]!;
    expect(state.activeConversationId).toBe(imported.id);
    expect(imported.id).not.toBe('source-conv');
    expect(imported.title).toBe('带走的对话');
    expect(imported.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(imported.messages.map((m) => m.content)).toEqual(['问题一', '回答一', '问题二']);
    expect(imported.messages.map((m) => m.timestamp)).toEqual([1111, 2222, 3333]);
  });

  it('同一份文件上传两次不会重复导入', () => {
    const text = exportTextOf(
      makeConversation([makeMessage({ id: 'm1' }), makeMessage({ id: 'm2' })], {
        id: 'source-conv',
      })
    );

    const first = useChatStore.getState().importConversation(text);
    const second = useChatStore.getState().importConversation(text);

    expect(first.ok && !first.duplicate).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.duplicate).toBe(true);
      if (first.ok) expect(second.conversationId).toBe(first.conversationId);
    }

    const state = useChatStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]!.messages).toHaveLength(2);
    expect(state.activeConversationId).toBe(state.conversations[0]!.id);
  });

  it('先后上传两份不同文件互不覆盖，已有对话也不受影响', () => {
    const existing = makeConversation([makeMessage({ id: 'old-1' })], { id: 'existing-conv' });
    useChatStore.setState({ conversations: [existing] });

    const textA = exportTextOf(
      makeConversation([makeMessage({ id: 'a1', content: 'A1' })], { id: 'conv-a', title: '对话A' })
    );
    const textB = exportTextOf(
      makeConversation(
        [makeMessage({ id: 'b1', content: 'B1' }), makeMessage({ id: 'b2', content: 'B2' })],
        { id: 'conv-b', title: '对话B' }
      )
    );

    const resultA = useChatStore.getState().importConversation(textA);
    const resultB = useChatStore.getState().importConversation(textB);

    expect(resultA.ok && resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;
    expect(resultA.conversationId).not.toBe(resultB.conversationId);

    const state = useChatStore.getState();
    expect(state.conversations).toHaveLength(3);

    const importedA = state.conversations.find((c) => c.id === resultA.conversationId)!;
    const importedB = state.conversations.find((c) => c.id === resultB.conversationId)!;
    expect(importedA.messages.map((m) => m.content)).toEqual(['A1']);
    expect(importedB.messages.map((m) => m.content)).toEqual(['B1', 'B2']);
    // 已有对话保持不变
    expect(state.conversations.find((c) => c.id === 'existing-conv')).toEqual(existing);
  });
});

describe('chatStore.importConversation 原子性', () => {
  it.each([
    ['非 JSON 文本', '{broken json'],
    ['空文本', '   '],
  ])('文件无法解析时不改动任何状态：%s', (_label, raw) => {
    const existing = makeConversation([makeMessage({ id: 'old-1' })], { id: 'existing-conv' });
    useChatStore.setState({ conversations: [existing], activeConversationId: existing.id });

    const result = useChatStore.getState().importConversation(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    const state = useChatStore.getState();
    expect(state.conversations).toEqual([existing]);
    expect(state.activeConversationId).toBe('existing-conv');
  });

  it('正文缺失时整体拒绝，不会只还原一半', () => {
    const source = makeConversation([
      makeMessage({ id: 'm1', content: '正常' }),
      makeMessage({ id: 'm2', content: '正常' }),
      makeMessage({ id: 'm3', content: '正常' }),
    ]);
    const data = JSON.parse(exportTextOf(source)) as { messages: Array<{ content: string }> };
    data.messages[1]!.content = '';

    const result = useChatStore.getState().importConversation(JSON.stringify(data));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('第 2 条消息缺少正文内容');
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it('时间格式不对时整体拒绝', () => {
    const source = makeConversation([makeMessage({ id: 'm1' })]);
    const data = JSON.parse(exportTextOf(source)) as { messages: Array<{ timestamp: unknown }> };
    data.messages[0]!.timestamp = '昨天';

    const result = useChatStore.getState().importConversation(JSON.stringify(data));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('时间格式不正确');
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it('条数超过上限时整体拒绝并给出建议', () => {
    const source = makeConversation(
      Array.from({ length: MAX_IMPORT_MESSAGES + 1 }, (_, i) => makeMessage({ id: `m${i}` }))
    );

    const result = useChatStore.getState().importConversation(exportTextOf(source));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('超过单次导入上限');
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it('持久化失败时不留下半截数据，恢复后可重新导入', () => {
    const text = exportTextOf(makeConversation([makeMessage({ id: 'm1' })]));

    setItemFailures = 1; // 下一次写入 localStorage 失败
    const failed = useChatStore.getState().importConversation(text);

    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.errors[0]).toContain('本地存储失败');
    // 内存状态同样没有变化
    expect(useChatStore.getState().conversations).toHaveLength(0);

    // 存储恢复后，同一份文件可以完整导入
    const retried = useChatStore.getState().importConversation(text);
    expect(retried.ok).toBe(true);
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(useChatStore.getState().conversations[0]!.messages).toHaveLength(1);
  });
});
