// ===================================
// Content Script - Amazonページで動作
// ===================================

console.log('Notion Amazon Cart Sync - Content Script loaded');

// 商品情報を取得
function getProductInfo() {
  const info = {
    url: window.location.href,
    asin: null,
    title: null,
    price: null,
    image: null,
    available: true
  };
  
  // ASINを取得（URLから）
  const asinMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
  if (asinMatch) {
    info.asin = asinMatch[1];
  }
  
  // 商品タイトル
  const titleElement = document.getElementById('productTitle');
  if (titleElement) {
    info.title = titleElement.textContent.trim();
  }
  
  // 価格
  const priceElement = document.querySelector('.a-price-whole');
  if (priceElement) {
    info.price = priceElement.textContent.trim();
  }
  
  // 商品画像
  const imageElement = document.querySelector('#landingImage, #imgBlkFront');
  if (imageElement) {
    info.image = imageElement.src;
  }
  
  // 在庫状況
  const availability = document.querySelector('#availability span');
  if (availability && availability.textContent.includes('在庫切れ')) {
    info.available = false;
  }
  
  return info;
}

// カートに追加ボタンをクリック
async function addToCart(quantity = 1) {
  try {
    // 数量を設定
    const quantitySelect = document.getElementById('quantity');
    if (quantitySelect && quantity > 1) {
      quantitySelect.value = quantity.toString();
      
      // 変更イベントを発火
      const event = new Event('change', { bubbles: true });
      quantitySelect.dispatchEvent(event);
      
      // 少し待つ
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // カートに追加ボタンを探す
    const addToCartButton = document.getElementById('add-to-cart-button') ||
                           document.querySelector('input[name="submit.add-to-cart"]') ||
                           document.querySelector('#buy-now-button');
    
    if (addToCartButton) {
      addToCartButton.click();
      
      // カート追加の確認を待つ
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 成功を確認
      const successIndicator = document.querySelector('.sw-atc-success-message') ||
                              document.querySelector('#sw-atc-details-single-container') ||
                              document.querySelector('.a-size-medium-plus.a-color-base.sw-atc-text');
      
      if (successIndicator) {
        return { success: true };
      } else {
        // カートページに遷移した場合も成功とみなす
        if (window.location.href.includes('/cart/') || window.location.href.includes('/gp/cart/')) {
          return { success: true };
        }
        return { success: false, error: 'カート追加の確認ができませんでした' };
      }
    } else {
      return { success: false, error: 'カートに追加ボタンが見つかりません' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 削除: SavetoNotionで既に保存機能があるため不要

// ステータスインジケーターを表示
function showStatusIndicator(message, type = 'info') {
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
    color: white;
    border-radius: 5px;
    z-index: 10000;
    font-size: 14px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease;
  `;
  indicator.textContent = message;
  
  document.body.appendChild(indicator);
  
  setTimeout(() => {
    indicator.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => indicator.remove(), 300);
  }, 3000);
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);
  
  // pingリクエストに応答（準備完了確認用）
  if (request.action === 'ping') {
    sendResponse({ ready: true });
    return false;
  }
  
  if (request.action === 'addToCart') {
    console.log('カート追加リクエスト受信:', {
      notionPageId: request.notionPageId,
      quantity: request.quantity
    });
    
    // カートに追加
    showStatusIndicator('カートに追加中...', 'info');
    
    addToCart(request.quantity).then(result => {
      console.log('カート追加結果:', result);
      
      if (result.success) {
        showStatusIndicator('✅ カートに追加しました', 'success');
        
        console.log('バックグラウンドに成功を通知:', request.notionPageId);
        // バックグラウンドスクリプトに成功を通知
        chrome.runtime.sendMessage({
          action: 'cartAddSuccess',
          notionPageId: request.notionPageId
        }, response => {
          console.log('バックグラウンドからの応答:', response);
        });
      } else {
        showStatusIndicator(`❌ ${result.error}`, 'error');
        
        console.log('バックグラウンドにエラーを通知:', result.error);
        // エラーを通知
        chrome.runtime.sendMessage({
          action: 'cartAddError',
          notionPageId: request.notionPageId,
          error: result.error
        }, response => {
          console.log('バックグラウンドからの応答:', response);
        });
      }
      sendResponse(result);
    });
    
    return true; // 非同期レスポンス
  } else if (request.action === 'getProductInfo') {
    const info = getProductInfo();
    sendResponse(info);
  }
});

// ページ読み込み時の処理（特に何もしない）
// SavetoNotionが商品保存を担当するため

// スタイルを追加
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);