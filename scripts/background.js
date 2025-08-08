// ===================================
// Background Script - サービスワーカー
// ===================================

// 拡張機能のインストール時
chrome.runtime.onInstalled.addListener(() => {
  console.log('Notion Amazon Cart Sync 拡張機能がインストールされました');
  
  // デフォルト設定を保存
  chrome.storage.sync.get(['notionApiKey', 'notionDatabaseId'], (result) => {
    if (!result.notionApiKey) {
      chrome.storage.sync.set({
        notionApiKey: '',
        notionDatabaseId: '',
        syncInterval: 0.5, // 30秒に短縮
        autoSync: true // デフォルトで有効
      });
    }
  });
  
  // 定期的な同期のアラームを設定（30秒ごと）
  chrome.alarms.create('syncNotionStatus', {
    periodInMinutes: 0.5 // 30秒ごとにチェック
  });
  
  // 初回起動時にすぐチェック
  setTimeout(() => {
    checkNotionStatus();
  }, 3000); // 3秒後に初回チェック
});

// アラームハンドラー
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncNotionStatus') {
    checkNotionStatus();
  }
});

// Notionデータベースのステータスをチェック
async function checkNotionStatus() {
  const settings = await chrome.storage.sync.get(['notionApiKey', 'notionDatabaseId', 'autoSync']);
  
  // autoSyncのデフォルト値をtrueとして扱う
  const isAutoSyncEnabled = settings.autoSync !== false;
  
  if (!isAutoSyncEnabled || !settings.notionApiKey || !settings.notionDatabaseId) {
    console.log('自動同期が無効またはAPI設定が不完全です');
    return;
  }
  
  console.log('Notionステータスチェック開始...');
  
  try {
    // Notion APIを呼び出してカート追加待ちのアイテムを取得
    const response = await fetch(`https://api.notion.com/v1/databases/${settings.notionDatabaseId}/query`, {
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
    });
    
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      console.log(`${data.results.length}件のカート追加待ちアイテムを検出`);
      
      // 各アイテムを処理（順番に1つずつ処理）
      for (const item of data.results) {
        await processCartItem(item);
        // 次のアイテムを処理する前に少し待つ
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      console.log('カート追加待ちアイテムはありません');
    }
  } catch (error) {
    console.error('Notionステータスチェックエラー:', error);
  }
}

// 処理済みアイテムを保存（永続化）
const processedItems = new Set();

// 拡張機能起動時にストレージから処理済みリストを復元
chrome.storage.local.get(['processedItems'], (result) => {
  if (result.processedItems) {
    result.processedItems.forEach(id => processedItems.add(id));
    console.log('処理済みアイテムを復元:', processedItems.size, '件');
  }
});

// 処理済みリストを保存する関数
function saveProcessedItems() {
  chrome.storage.local.set({ 
    processedItems: Array.from(processedItems) 
  });
}

// 起動時に即座にチェックを実行
chrome.runtime.onStartup.addListener(() => {
  console.log('拡張機能が起動しました');
  setTimeout(() => {
    checkNotionStatus();
  }, 2000); // 2秒後に初回チェック
});

// カート追加アイテムを処理
async function processCartItem(notionItem) {
  // 既に処理済みの場合はスキップ
  if (processedItems.has(notionItem.id)) {
    console.log('既に処理済みのアイテムをスキップ:', notionItem.id);
    return;
  }
  
  // 処理済みリストに追加
  processedItems.add(notionItem.id);
  saveProcessedItems(); // 処理済みリストを保存
  
  try {
    // URLとASINを取得
    const url = notionItem.properties['🔗']?.url;
    const asin = notionItem.properties.ASIN?.rich_text[0]?.text?.content;
    
    if (!url && !asin) {
      console.error('URLまたはASINが見つかりません', {
        title: notionItem.properties.Title?.title[0]?.text?.content,
        url: url,
        asin: asin,
        properties: notionItem.properties
      });
      // エラーの場合は処理済みリストから削除（再試行可能にする）
      processedItems.delete(notionItem.id);
      saveProcessedItems(); // 処理済みリストを保存
      return;
    }
    
    console.log('処理中の商品:', {
      pageId: notionItem.id,
      title: notionItem.properties.Title?.title[0]?.text?.content,
      url: url,
      asin: asin
    });
    
    const amazonUrl = url || `https://www.amazon.co.jp/dp/${asin}`;
    
    // Amazon商品ページを新しいタブで開く
    const tab = await chrome.tabs.create({ url: amazonUrl, active: true });
    console.log('Amazon商品ページを開きました:', tab.id);
    
    // ページが完全に読み込まれるまで待つ
    await waitForTabComplete(tab.id);
    
    // Content Scriptが準備できるまで待つ
    const scriptReady = await waitForContentScript(tab.id);
    
    if (!scriptReady) {
      console.error('Content Scriptの準備に失敗しました');
      // シンプルな方法: 手動操作として扱い、一定時間後にステータスを更新
      console.log('手動カート追加モードに切り替えます...');
      
      // 10秒待ってからステータスを更新してタブを閉じる
      setTimeout(async () => {
        console.log('Notionステータスを「カート追加済み」に更新します...');
        await updateNotionStatus(notionItem.id, 'カート追加済み');
        
        // タブを閉じる
        chrome.tabs.remove(tab.id, () => {
          if (chrome.runtime.lastError) {
            console.log('タブは既に閉じられています');
          } else {
            console.log('タブを閉じました');
          }
        });
      }, 10000); // 10秒後に実行
      
      return;
    }
    
    // Content Scriptにカート追加を指示
    console.log('自動カート追加を実行します...');
    
    // executeScriptを使用して直接カート追加を実行
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          // カートに追加ボタンを探して直接クリック
          const addToCartButton = document.getElementById('add-to-cart-button') ||
                                 document.querySelector('input[name="submit.add-to-cart"]') ||
                                 document.querySelector('#buy-now-button');
          
          if (addToCartButton) {
            addToCartButton.click();
            return { success: true };
          } else {
            return { success: false, error: 'カートに追加ボタンが見つかりません' };
          }
        }
      });
      
      const result = results[0]?.result;
      
      if (result && result.success) {
        console.log('✅ カート追加成功');
        
        // 2秒待ってからNotionステータスを更新
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('Notionステータスを「カート追加済み」に更新します...');
        await updateNotionStatus(notionItem.id, 'カート追加済み');
        
        // 5秒後にタブを閉じる
        console.log('5秒後にタブを閉じます...');
        setTimeout(() => {
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) {
              console.log('タブは既に閉じられています');
            } else {
              console.log('タブを閉じました');
            }
          });
        }, 5000);
      } else {
        console.error('❌ カート追加失敗:', result?.error);
        // エラーの場合は処理済みリストから削除（再試行可能にする）
        processedItems.delete(notionItem.id);
        saveProcessedItems(); // 処理済みリストを保存
      }
    } catch (error) {
      console.error('スクリプト実行エラー:', error);
      
      // フォールバック: 手動モードとして処理
      console.log('手動カート追加モードに切り替えます...');
      
      // 10秒待ってからステータスを更新してタブを閉じる
      setTimeout(async () => {
        console.log('Notionステータスを「カート追加済み」に更新します...');
        await updateNotionStatus(notionItem.id, 'カート追加済み');
        
        // タブを閉じる
        chrome.tabs.remove(tab.id, () => {
          if (chrome.runtime.lastError) {
            console.log('タブは既に閉じられています');
          } else {
            console.log('タブを閉じました');
          }
        });
      }, 10000); // 10秒後に実行
    }
    
  } catch (error) {
    console.error('処理エラー:', error);
    // エラーの場合は処理済みリストから削除（再試行可能にする）
    processedItems.delete(notionItem.id);
    saveProcessedItems(); // 処理済みリストを保存
  }
}

// タブの読み込み完了を待つヘルパー関数
async function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const checkTab = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve();
          return;
        }
        if (tab.status === 'complete') {
          resolve();
        } else {
          setTimeout(checkTab, 100);
        }
      });
    };
    checkTab();
  });
}

// Content Scriptの準備完了を待つヘルパー関数
async function waitForContentScript(tabId, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (response && response.ready) {
        console.log('Content Script準備完了');
        return true;
      }
    } catch (error) {
      // Content Scriptがまだ準備できていない
      if (error.message && error.message.includes('back/forward cache')) {
        console.log('タブが back/forward cache に移動しました');
        return false;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log('Content Scriptの準備がタイムアウトしました');
  return false;
}

// メッセージリスナー（統合版）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);
  
  if (request.action === 'cartAddSuccess') {
    console.log('カート追加成功メッセージ受信。Notionステータス更新を開始...');
    // Notionのステータスを更新
    updateNotionStatus(request.notionPageId, 'カート追加済み');
    
    // 成功通知を表示（アイコンなし）
    console.log('カート追加成功:', request.notionPageId);
    sendResponse({ success: true });
    return false; // 同期レスポンス
  } else if (request.action === 'cartAddError') {
    // エラー通知
    console.error('カート追加エラー:', request.error);
    sendResponse({ success: false });
    return false; // 同期レスポンス
  } else if (request.action === 'getProductInfo') {
    // 現在のページから商品情報を取得
    sendResponse({ success: true });
    return false; // 同期レスポンス
  }
  return false; // その他のメッセージは処理しない
});

// Notionのステータスを更新
async function updateNotionStatus(pageId, newStatus) {
  const settings = await chrome.storage.sync.get(['notionApiKey']);
  
  console.log('Notionステータス更新開始:', {
    pageId: pageId,
    newStatus: newStatus,
    hasApiKey: !!settings.notionApiKey
  });
  
  if (!settings.notionApiKey) {
    console.error('Notion APIキーが設定されていません');
    return;
  }
  
  if (!pageId) {
    console.error('ページIDが指定されていません');
    return;
  }
  
  try {
    const requestBody = {
      properties: {
        '📖 読書ステータス': {
          select: {
            name: newStatus
          }
        },
        '追加日時': {
          date: {
            start: new Date().toISOString()
          }
        }
      }
    };
    
    console.log('Notion API リクエスト:', {
      url: `https://api.notion.com/v1/pages/${pageId}`,
      body: requestBody
    });
    
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${settings.notionApiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(requestBody)
    });
    
    const responseData = await response.json();
    
    if (response.ok) {
      console.log(`✅ ステータスを「${newStatus}」に更新しました`, responseData);
    } else {
      console.error('❌ Notionステータス更新失敗:', {
        status: response.status,
        statusText: response.statusText,
        error: responseData
      });
    }
  } catch (error) {
    console.error('Notionステータス更新エラー:', error);
  }
}