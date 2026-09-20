import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Tooltip, message, Modal } from 'antd';
import { PlusOutlined, SettingOutlined, UploadOutlined } from '@ant-design/icons';
import { ConversationList } from './ConversationList';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { downloadConversationExport } from '../../services/conversationTransfer';
import './Sidebar.css';

/**
 * 侧边栏组件
 */
export function Sidebar() {
  const {
    conversations,
    activeConversationId,
    createConversation,
    deleteConversation,
    setActiveConversation,
    importConversation,
  } = useChatStore();

  const { setConfigPanelVisible, setMobileDrawerOpen } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNewConversation = () => {
    createConversation();
    setMobileDrawerOpen(false);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversation(id);
    setMobileDrawerOpen(false);
  };

  const handleOpenSettings = () => {
    setConfigPanelVisible(true);
  };

  const handleExportConversation = (id: string) => {
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) {
      message.error('未找到要导出的对话');
      return;
    }

    try {
      const filename = downloadConversationExport(conversation);
      message.success(`已导出 ${conversation.messages.length} 条消息到文件「${filename}」`);
    } catch (error) {
      console.error('Failed to export conversation:', error);
      message.error('导出失败，请重试');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 重置 input，保证再次选择同一个文件也能触发 onChange
    e.target.value = '';

    if (!file) {
      return;
    }

    let raw: string;
    try {
      raw = await file.text();
    } catch (error) {
      // 读取中断（如文件被占用、浏览器中止读取）时不会改动任何数据
      console.error('Failed to read import file:', error);
      message.error('文件读取失败或被中断，请重新选择文件再试');
      return;
    }

    const result = importConversation(raw);

    if (!result.ok) {
      Modal.error({
        title: '导入失败',
        content: (
          <div>
            <p>文件未通过校验，现有对话未受影响。请根据以下提示处理：</p>
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              {result.errors.map((err, i) => (
                <li key={i} style={{ marginBottom: 8 }}>{err}</li>
              ))}
            </ul>
          </div>
        ),
        okText: '知道了',
      });
      return;
    }

    setMobileDrawerOpen(false);

    if (result.duplicate) {
      message.info(`该文件之前已导入过，已为你定位到对话「${result.title}」，未重复导入`);
    } else {
      message.success(`已导入对话「${result.title}」，共 ${result.messageCount} 条消息`);
    }
  };

  return (
    <div className="sidebar glass-card">
      <div className="sidebar-header">
        <h2 className="sidebar-title">对话历史</h2>
        <div className="sidebar-actions">
          <Tooltip title="导入对话">
            <Button
              type="text"
              icon={<UploadOutlined />}
              onClick={handleImportClick}
            />
          </Tooltip>
          <Tooltip title="设置">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={handleOpenSettings}
            />
          </Tooltip>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <div className="sidebar-new">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleNewConversation}
          block
        >
          新建对话
        </Button>
      </div>

      <div className="sidebar-content">
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onDelete={deleteConversation}
          onExport={handleExportConversation}
        />
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-footer-text">
          共 {conversations.length} 个对话
        </span>
      </div>
    </div>
  );
}
