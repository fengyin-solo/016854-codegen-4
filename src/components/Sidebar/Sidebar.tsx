import { useRef } from 'react';
import { Button, Modal, Tooltip, message } from 'antd';
import { PlusOutlined, SettingOutlined, UploadOutlined } from '@ant-design/icons';
import { ConversationList } from './ConversationList';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import {
  parseConversationImport,
  MAX_IMPORT_FILE_SIZE,
  type ImportIssue,
  type NormalizedImport,
} from '../../utils/conversationTransfer';
import { formatFileSize } from '../../utils/formatters';
import './Sidebar.css';

/**
 * 渲染校验问题列表（问题描述 + 处理建议）
 */
function IssueList({ issues }: { issues: ImportIssue[] }) {
  return (
    <ul className="import-issue-list">
      {issues.map((issue, i) => (
        <li key={i} style={{ marginBottom: 8 }}>
          <div>{issue.problem}</div>
          <div style={{ color: '#888' }}>建议：{issue.suggestion}</div>
        </li>
      ))}
    </ul>
  );
}

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

  /** 把校验通过的数据写入 store 并反馈结果 */
  const doImport = (data: NormalizedImport) => {
    const result = importConversation(data);
    if (!result.ok) {
      Modal.error({
        title: '导入失败',
        content: `${result.error ?? '未知错误'}。本次导入未改动任何已有对话，可重试。`,
      });
      return;
    }
    if (result.duplicated) {
      message.info('该文件之前已经导入过，已为你打开对应的对话，未重复创建');
    } else {
      message.success(`已还原对话「${data.title}」，共 ${data.messages.length} 条消息`);
    }
    setMobileDrawerOpen(false);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 重置 input，保证再次选择同一文件也能触发 change
    event.target.value = '';
    if (!file) {
      return;
    }

    if (file.size > MAX_IMPORT_FILE_SIZE) {
      Modal.error({
        title: '无法导入该文件',
        content: `文件大小为 ${formatFileSize(file.size)}，超过上限 ${formatFileSize(MAX_IMPORT_FILE_SIZE)}。请确认选择的是本应用导出的对话文件。`,
      });
      return;
    }

    const reader = new FileReader();

    // 只有完整读到文件内容才进入解析，读取中断/失败时不改动任何数据
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = parseConversationImport(text);

      if (!result.ok) {
        Modal.error({
          title: '无法导入该文件',
          width: 560,
          content: (
            <div>
              <p>发现以下问题，请修正后重新导入（本次未改动任何已有对话）：</p>
              <IssueList issues={result.errors} />
            </div>
          ),
        });
        return;
      }

      if (result.warnings.length > 0) {
        Modal.confirm({
          title: '导入前请确认',
          width: 560,
          content: <IssueList issues={result.warnings} />,
          okText: '仍然导入',
          cancelText: '取消',
          onOk: () => doImport(result.data),
        });
        return;
      }

      doImport(result.data);
    };

    reader.onerror = () => {
      message.error('读取文件失败，请重试');
    };

    reader.onabort = () => {
      message.info('已取消读取文件，未导入任何内容');
    };

    reader.readAsText(file);
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
        onChange={handleFileChange}
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
