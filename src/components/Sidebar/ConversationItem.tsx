import React, { memo, useState } from 'react';
import { Button, Popconfirm, message } from 'antd';
import { MessageOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import type { Conversation } from '../../types';
import { formatRelativeTime, truncateText } from '../../utils/formatters';
import { downloadConversationExport } from '../../utils/conversationTransfer';
import './ConversationItem.css';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 对话项组件
 */
export const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: ConversationItemProps) {
  const [showActions, setShowActions] = useState(false);

  const handleClick = () => {
    onSelect(conversation.id);
  };

  const handleDelete = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onDelete(conversation.id);
  };

  const handleExport = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (conversation.messages.length === 0) {
      message.warning('当前对话还没有消息，无需导出');
      return;
    }
    try {
      downloadConversationExport(conversation);
      message.success(`对话「${truncateText(conversation.title, 20)}」已导出，请在下载目录中查看`);
    } catch (error) {
      console.error('Failed to export conversation:', error);
      message.error('导出失败，请重试');
    }
  };

  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const preview = lastMessage
    ? truncateText(lastMessage.content, 50)
    : '暂无消息';

  return (
    <div
      className={`conversation-item ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="conversation-icon">
        <MessageOutlined />
      </div>

      <div className="conversation-content">
        <div className="conversation-title">
          {truncateText(conversation.title, 20)}
        </div>
        <div className="conversation-preview">{preview}</div>
        <div className="conversation-time">
          {formatRelativeTime(conversation.updatedAt)}
        </div>
      </div>

      <div className={`conversation-actions ${showActions ? 'visible' : ''}`}>
        <Button
          type="text"
          size="small"
          icon={<DownloadOutlined />}
          title="导出对话"
          onClick={handleExport}
        />
        <Popconfirm
          title="删除对话"
          description="确定要删除这个对话吗？"
          onConfirm={handleDelete}
          okText="删除"
          cancelText="取消"
          placement="right"
        >
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      </div>
    </div>
  );
});
