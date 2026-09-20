
import { Empty } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { Conversation } from '../../types';
import { ConversationItem } from './ConversationItem';
import './ConversationList.css';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}

/**
 * 对话列表组件
 */
export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onExport,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="conversation-list-empty">
        <Empty
          image={<InboxOutlined style={{ fontSize: 32, color: 'var(--color-text-tertiary)' }} />}
          description="暂无对话"
          imageStyle={{ height: 40 }}
        />
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          isActive={conversation.id === activeId}
          onSelect={onSelect}
          onDelete={onDelete}
          onExport={onExport}
        />
      ))}
    </div>
  );
}
