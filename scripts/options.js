// ===================================
// Options Script - 設定画面
// ===================================

document.addEventListener('DOMContentLoaded', async () => {
  // 要素の取得
  const form = document.getElementById('settingsForm');
  const notionApiKey = document.getElementById('notionApiKey');
  const notionDatabaseId = document.getElementById('notionDatabaseId');
  const autoSync = document.getElementById('autoSync');
  const syncInterval = document.getElementById('syncInterval');
  const testConnectionBtn = document.getElementById('testConnection');
  const statusMessage = document.getElementById('statusMessage');
  
  // 既存の設定を読み込み
  const settings = await chrome.storage.sync.get([
    'notionApiKey',
    'notionDatabaseId',
    'autoSync',
    'syncInterval'
  ]);
  
  // フォームに設定を反映
  if (settings.notionApiKey) notionApiKey.value = settings.notionApiKey;
  if (settings.notionDatabaseId) notionDatabaseId.value = settings.notionDatabaseId;
  if (settings.autoSync !== undefined) autoSync.checked = settings.autoSync;
  if (settings.syncInterval) syncInterval.value = settings.syncInterval;
  
  // ステータスメッセージを表示
  function showStatus(message, type = 'success') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type} show`;
    
    setTimeout(() => {
      statusMessage.classList.remove('show');
    }, 5000);
  }
  
  // フォーム送信
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // バリデーション
    if (!notionApiKey.value) {
      showStatus('Notion APIキーを入力してください', 'error');
      return;
    }
    
    if (!notionDatabaseId.value) {
      showStatus('NotionデータベースIDを入力してください', 'error');
      return;
    }
    
    // 設定を保存
    try {
      await chrome.storage.sync.set({
        notionApiKey: notionApiKey.value,
        notionDatabaseId: notionDatabaseId.value,
        autoSync: autoSync.checked,
        syncInterval: parseInt(syncInterval.value)
      });
      
      // アラームの更新
      if (autoSync.checked) {
        chrome.alarms.clear('syncNotionStatus');
        chrome.alarms.create('syncNotionStatus', {
          periodInMinutes: parseInt(syncInterval.value)
        });
      } else {
        chrome.alarms.clear('syncNotionStatus');
      }
      
      showStatus('✅ 設定を保存しました', 'success');
    } catch (error) {
      console.error('保存エラー:', error);
      showStatus('❌ 保存に失敗しました', 'error');
    }
  });
  
  // 接続テスト
  testConnectionBtn.addEventListener('click', async () => {
    if (!notionApiKey.value || !notionDatabaseId.value) {
      showStatus('APIキーとデータベースIDを入力してください', 'error');
      return;
    }
    
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = 'テスト中...';
    
    try {
      // Notion APIをテスト
      const response = await fetch(
        `https://api.notion.com/v1/databases/${notionDatabaseId.value}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${notionApiKey.value}`,
            'Notion-Version': '2022-06-28'
          }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        
        // プロパティの確認
        const properties = data.properties;
        const requiredProps = ['Title', '🔗', 'ASIN', '📖 読書ステータス', '数量'];
        const missingProps = requiredProps.filter(prop => !properties[prop]);
        
        if (missingProps.length > 0) {
          showStatus(`⚠️ データベースに必要なプロパティがありません: ${missingProps.join(', ')}`, 'error');
        } else {
          showStatus('✅ 接続成功！データベースが正しく設定されています', 'success');
        }
      } else {
        const error = await response.json();
        if (response.status === 401) {
          showStatus('❌ APIキーが無効です', 'error');
        } else if (response.status === 404) {
          showStatus('❌ データベースが見つかりません', 'error');
        } else {
          showStatus(`❌ エラー: ${error.message || 'unknown'}`, 'error');
        }
      }
    } catch (error) {
      console.error('接続テストエラー:', error);
      showStatus('❌ 接続エラー: ネットワークを確認してください', 'error');
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = '接続テスト';
    }
  });
  
  // データベースIDの自動フォーマット
  notionDatabaseId.addEventListener('input', (e) => {
    // URLからIDを抽出
    const value = e.target.value;
    const urlMatch = value.match(/notion\.so\/([a-f0-9]{32})/i);
    
    if (urlMatch) {
      e.target.value = urlMatch[1];
    } else {
      // ハイフンを削除
      e.target.value = value.replace(/-/g, '');
    }
  });
});