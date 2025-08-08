// ===================================
// Popup Script
// ===================================

document.addEventListener('DOMContentLoaded', async () => {
  // 要素の取得
  const syncStatusDot = document.getElementById('syncStatus');
  const syncStatusText = document.getElementById('syncStatusText');
  const pendingCount = document.getElementById('pendingCount');
  const addedCount = document.getElementById('addedCount');
  const openNotionBtn = document.getElementById('openNotionBtn');
  const openSettings = document.getElementById('openSettings');
  
  // 設定を読み込み
  const settings = await chrome.storage.sync.get(['notionApiKey', 'notionDatabaseId', 'autoSync']);
  
  // autoSyncのデフォルト値をtrueに設定
  if (settings.autoSync === undefined) {
    settings.autoSync = true;
    chrome.storage.sync.set({ autoSync: true });
  }
  
  // 設定チェック
  if (!settings.notionApiKey || !settings.notionDatabaseId) {
    syncStatusDot.classList.add('inactive');
    syncStatusText.textContent = '設定が必要です';
    pendingCount.textContent = '-';
    addedCount.textContent = '-';
  } else {
    // ステータスを更新
    updateStatus();
  }
  
  // ステータス更新関数
  async function updateStatus() {
    try {
      // 自動同期の状態を表示
      if (settings.autoSync) {
        syncStatusDot.classList.add('active');
        syncStatusDot.classList.remove('inactive');
        syncStatusText.textContent = '自動同期: ON (30秒ごと)';
      } else {
        syncStatusDot.classList.add('inactive');
        syncStatusDot.classList.remove('active');
        syncStatusText.textContent = '自動同期: OFF';
      }
      
      // Notion APIから統計を取得
      const stats = await getNotionStats();
      pendingCount.textContent = stats.pending || 0;
      addedCount.textContent = stats.addedToday || 0;
    } catch (error) {
      console.error('ステータス更新エラー:', error);
      syncStatusText.textContent = 'エラー';
    }
  }
  
  // Notionから統計を取得
  async function getNotionStats() {
    try {
      // カート追加待ちの数を取得
      const pendingResponse = await fetch(
        `https://api.notion.com/v1/databases/${settings.notionDatabaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.notionApiKey}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            filter: {
              property: '📖 読書ステータス',
              select: {
                equals: 'カート追加待ち'
              }
            }
          })
        }
      );
      
      const pendingData = await pendingResponse.json();
      
      // 本日追加済みの数を取得
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const addedResponse = await fetch(
        `https://api.notion.com/v1/databases/${settings.notionDatabaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.notionApiKey}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            filter: {
              and: [
                {
                  property: '📖 読書ステータス',
                  select: {
                    equals: 'カート追加済み'
                  }
                },
                {
                  property: '追加日時',
                  date: {
                    after: today.toISOString()
                  }
                }
              ]
            }
          })
        }
      );
      
      const addedData = await addedResponse.json();
      
      return {
        pending: pendingData.results?.length || 0,
        addedToday: addedData.results?.length || 0
      };
    } catch (error) {
      console.error('Notion統計取得エラー:', error);
      return { pending: 0, addedToday: 0 };
    }
  }
  
  // Notionデータベースを開く
  openNotionBtn.addEventListener('click', () => {
    if (settings.notionDatabaseId) {
      chrome.tabs.create({
        url: `https://www.notion.so/${settings.notionDatabaseId.replace(/-/g, '')}`
      });
    } else {
      alert('Notionデータベースが設定されていません');
    }
  });
  
  // 設定を開く
  openSettings.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});