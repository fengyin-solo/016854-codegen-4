import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { Conversation, Message } from '@/types';
import {
  buildConversationExport,
  serializeConversationExport,
  parseConversationExport,
  validateConversationExport,
  toImportedConversation,
  computeConversationFingerprint,
} from '@/services/conversationTransfer';

const timestampArb = fc.integer({ min: 1, max: 4_000_000_000_000 });

const messageArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom('user', 'assistant', 'system'),
  content: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  timestamp: timestampArb,
  status: fc.constantFrom('complete', 'error'),
});

const conversationArb: fc.Arbitrary<Conversation> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  messages: fc.array(messageArb, { maxLength: 30 }),
  createdAt: timestampArb,
  updatedAt: timestampArb,
});

describe('对话导出/导入 属性测试', () => {
  it('任意对话导出再还原后，消息条数、先后次序与内容完全一致', () => {
    fc.assert(
      fc.property(conversationArb, (conversation) => {
        const text = serializeConversationExport(buildConversationExport(conversation));

        const parsed = parseConversationExport(text);
        if (!parsed.ok) return false;

        const validated = validateConversationExport(parsed.data);
        if (!validated.ok) return false;

        const restored = toImportedConversation(validated.file);

        if (restored.title !== conversation.title) return false;
        if (restored.messages.length !== conversation.messages.length) return false;

        return restored.messages.every((m, i) => {
          const orig = conversation.messages[i];
          return (
            orig !== undefined &&
            m.id === orig.id &&
            m.role === orig.role &&
            m.content === orig.content &&
            m.timestamp === orig.timestamp &&
            m.status === orig.status
          );
        });
      }),
      { numRuns: 100 }
    );
  });

  it('同一份导出内容的指纹恒定，可用于幂等去重', () => {
    fc.assert(
      fc.property(conversationArb, (conversation) => {
        const file = buildConversationExport(conversation);
        const again = computeConversationFingerprint(
          file.conversation.id,
          file.messages.map((m) => ({ ...m }))
        );
        return file.fingerprint === again;
      }),
      { numRuns: 100 }
    );
  });
});
