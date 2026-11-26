'use strict';
 
/* =========================================================
   SERVER ORDERS
   - "Server" tab inside the Saved Orders panel (everyone's orders)
   - Move a local saved order to the server
   - Send an order to a named salesman (popup when one arrives)
   ========================================================= */
(() => {
  // DEV: points at the test function. When you promote to production,
  // change this back to 'smooth-handler' (or keep the new name).
  const ENDPOINT = `${SUPABASE_URL}/functions/v1/smooth-handler-dev`;

  // UI hint only. The server decides who may delete or change an order.
  const ADMIN_NAMES = ['Frisky', 'Amin'];

  const PAGE_SIZE = 60;
  const SEEN_KEY = 'centi_inbox_seen_v1';
  const TAB_KEY = 'centi_saved_tab_v1';

  const COPY = {
    en: {
      localTab: 'Local',
      serverTab: 'Server',
      send: 'Send to salesman',
      choose: 'Select salesman',
      cancel: 'Cancel',
      refresh: '↻ Refresh',
      loading: 'Loading…',
      noOrders: 'No orders on the server.',
      chooseName: 'Select your name first.',
      needPin: 'Set the shared inbox PIN in Connection settings.',
      load: 'Load to cart',
      markDone: 'Mark done',
      reopen: 'Reopen',
      remove: 'Delete',
      view: 'View order',
      done: 'Done',
      open: 'Open',
      unassigned: 'no recipient',
      everyone: 'Everyone',
      hideDone: 'Hide done orders',
      showMore: 'Show more',
      shown: 'orders shown',
      toServer: 'To server',
      moveConfirm:
        'Move this order to the server? It will be removed from this device.',
      moved: 'Order moved to server',
      editedBy: 'Edited by',
      payment: 'Payment',
      printSaved: 'Saved to server',
      printNotSaved: 'Not saved to server',
      history: 'History',
      existsConfirm:
        'This order is already on the server. Replace it with this version?',
      existsBlocked: 'Already on the server and owned by',
      deleteConfirm: 'Delete this order from the server:',
      deleted: 'Order deleted',
      changed: 'Order updated',
      sent: 'Order sent to',
      total: 'Total',
      ongkir: 'Ongkir',
      failed: 'Request failed',
      emptyCartConfirm: 'Replace your current cart with this order?',
      noUsable: 'This order has no usable products',
      orderFrom: 'Order from',
      openInCart: 'open in cart?',
      yesOpen: 'Open in cart',
      later: 'Later',
      loadedFrom: 'Loaded from',
      dateInvalid: 'Unknown date'
    },
    id: {
      localTab: 'Lokal',
      serverTab: 'Server',
      send: 'Kirim ke sales',
      choose: 'Pilih sales',
      cancel: 'Batal',
      refresh: '↻ Muat ulang',
      loading: 'Memuat…',
      noOrders: 'Belum ada pesanan di server.',
      chooseName: 'Pilih nama Anda terlebih dahulu.',
      needPin: 'Atur PIN kotak masuk bersama di Pengaturan koneksi.',
      load: 'Muat ke keranjang',
      markDone: 'Tandai selesai',
      reopen: 'Buka lagi',
      remove: 'Hapus',
      view: 'Lihat pesanan',
      done: 'Selesai',
      open: 'Terbuka',
      unassigned: 'tanpa penerima',
      everyone: 'Semua orang',
      hideDone: 'Sembunyikan pesanan selesai',
      showMore: 'Tampilkan lebih banyak',
      shown: 'pesanan ditampilkan',
      toServer: 'Ke server',
      moveConfirm:
        'Pindahkan pesanan ini ke server? Pesanan akan dihapus dari perangkat ini.',
      moved: 'Pesanan dipindahkan ke server',
      editedBy: 'Diedit oleh',
      payment: 'Pembayaran',
      printSaved: 'Tersimpan di server',
      printNotSaved: 'Tidak tersimpan di server',
      history: 'Riwayat',
      existsConfirm:
        'Pesanan ini sudah ada di server. Ganti dengan versi ini?',
      existsBlocked: 'Sudah ada di server dan milik',
      deleteConfirm: 'Hapus pesanan ini dari server:',
      deleted: 'Pesanan dihapus',
      changed: 'Pesanan diperbarui',
      sent: 'Pesanan terkirim kepada',
      total: 'Total',
      ongkir: 'Ongkir',
      failed: 'Permintaan gagal',
      emptyCartConfirm: 'Ganti keranjang saat ini dengan pesanan ini?',
      noUsable: 'Pesanan ini tidak memiliki produk yang dapat dipakai',
      orderFrom: 'Pesanan dari',
      openInCart: 'buka di keranjang?',
      yesOpen: 'Buka di keranjang',
      later: 'Nanti',
      loadedFrom: 'Dimuat dari',
      dateInvalid: 'Tanggal tidak diketahui'
    }
  };

  let serverOrders = [];
  let serverLimit = PAGE_SIZE;
  let serverHasMore = false;
  let serverLoading = false;
  let personFilter = '';
  let hideDone = false;

  let inboxOrders = [];          // open orders addressed to me
  let inboxRequestRunning = false;

  let activeTab = 'local';
  try {
    activeTab = localStorage.getItem(TAB_KEY) === 'server' ? 'server' : 'local';
  } catch (error) { /* ignore */ }

  let promptQueue = [];
  let promptOpen = false;

  function words() {
    return COPY[currentLanguage === 'id' ? 'id' : 'en'];
  }

  function notReadyMessage() {
    if (!REQUESTER_NAMES.includes(requesterName)) return words().chooseName;
    if (!(settings.inboxPin || '').trim()) return words().needPin;
    return '';
  }

  function canManage(order) {
    return (
      requesterName === order.sender_name ||
      ADMIN_NAMES.includes(requesterName)
    );
  }

  function canChangeStatus(order) {
    return (
      !order.recipient_name ||
      order.recipient_name === requesterName ||
      canManage(order)
    );
  }

  async function callApi(payload) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLIC_KEY
      },
      body: JSON.stringify({
        ...payload,
        requesterName,
        pin: (settings.inboxPin || '').trim()
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      const error = new Error(
        result.error || `${words().failed} (${response.status})`
      );
      error.code = result.code;
      error.existing = result.existing;
      error.canReplace = result.canReplace;
      throw error;
    }

    return result;
  }

  /* ---------- badges ---------- */

  function updateBadges(count) {
    const navBadge = $('savedOrdersBadge');
    if (navBadge) {
      navBadge.textContent = String(count);
      navBadge.hidden = count < 1;
    }

    const tabBadge = $('tabServerCount');
    if (tabBadge) {
      tabBadge.textContent = String(count);
      tabBadge.hidden = count < 1;
    }
  }

  /* ---------- tabs ---------- */

  function setSavedTab(tab, options = {}) {
    const { load = true } = options;

    activeTab = tab === 'server' ? 'server' : 'local';

    try { localStorage.setItem(TAB_KEY, activeTab); } catch (error) { /* ignore */ }

    const isServer = activeTab === 'server';

    $('tabLocal').classList.toggle('is-active', !isServer);
    $('tabLocal').setAttribute('aria-selected', String(!isServer));
    $('tabServer').classList.toggle('is-active', isServer);
    $('tabServer').setAttribute('aria-selected', String(isServer));

    $('savedOrdersList').classList.toggle('hidden', isServer);
    $('serverOrdersPane').classList.toggle('hidden', !isServer);

    if (isServer && load) void loadServerOrders();
  }

  function updateLabels() {
    const w = words();

    const localLabel = $('tabLocalLabel');
    if (localLabel) localLabel.textContent = w.localTab;

    const serverLabel = $('tabServerLabel');
    if (serverLabel) serverLabel.textContent = w.serverTab;

    const sendButton = $('sendToSalesman');
    if (sendButton) sendButton.textContent = w.send;

    buildToolbar();
    renderServerOrders();
  }

  /* ---------- server tab: toolbar ---------- */

  function buildToolbar() {
    const bar = $('serverToolbar');
    if (!bar) return;

    const w = words();

    bar.innerHTML = `
      <select id="serverPersonFilter" aria-label="${esc(w.everyone)}">
        <option value="">${esc(w.everyone)}</option>
        ${REQUESTER_NAMES.map(name => `
          <option value="${esc(name)}"${name === personFilter ? ' selected' : ''}>
            ${esc(name)}
          </option>
        `).join('')}
      </select>
      <button id="serverRefresh" type="button">${esc(w.refresh)}</button>
      <label class="hide-done">
        <input id="serverHideDone" type="checkbox"${hideDone ? ' checked' : ''}>
        ${esc(w.hideDone)}
      </label>
      <div id="serverStatus" class="server-status"></div>
    `;
  }

  function setServerStatus(text) {
    const status = $('serverStatus');
    if (status) status.textContent = text;
  }

  /* ---------- server tab: list ---------- */

  function visibleServerOrders() {
    return serverOrders.filter(order => {
      if (hideDone && order.status === 'completed') return false;

      if (
        personFilter &&
        order.sender_name !== personFilter &&
        order.recipient_name !== personFilter
      ) {
        return false;
      }

      return true;
    });
  }
function stamp(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function editedLineHtml(order) {
    if (!order.last_edited_by) return '';

    return `<small>${esc(words().editedBy)} ${esc(order.last_edited_by)} · ` +
      `${esc(stamp(order.last_edited_at))}</small>`;
  }

  // INV / NOT / PAID chips. An invoice method is only a preference.
  function serverTagsHtml(order) {
    const tags = [];

    if (order.inv_at) {
      const preferred = order.payment && !order.nota_at
        ? ` · ${order.payment}` : '';
      const tip = `Invoice: ${order.inv_by || ''} ${stamp(order.inv_at)}`;
      tags.push(
        `<em class="doc-tag inv" title="${esc(tip)}">INV${esc(preferred)}</em>`
      );
    }

    if (order.nota_at) {
      const tip = `Nota: ${order.nota_by || ''} ${stamp(order.nota_at)}`;
      tags.push(`<em class="doc-tag not" title="${esc(tip)}">NOT</em>`);

      if (order.payment) {
        tags.push(
          `<em class="doc-tag paid">PAID · ${esc(order.payment)}</em>`
        );
      }
    }

    return tags.length ? `<div class="doc-tags">${tags.join('')}</div>` : '';
  }
const EVENT_LABELS = {
    en: {
      created: 'created it', edited: 'edited it', sent: 'sent it to',
      invoice: 'sent the invoice', nota: 'sent the nota',
      done: 'marked it done', reopened: 'reopened it'
    },
    id: {
      created: 'membuat', edited: 'mengedit', sent: 'mengirim ke',
      invoice: 'mengirim invoice', nota: 'mengirim nota',
      done: 'menandai selesai', reopened: 'membuka lagi'
    }
  };

  function historyLine(event) {
    const labels = EVENT_LABELS[currentLanguage === 'id' ? 'id' : 'en'];
    let text = labels[event.event] || event.event;

    if (event.event === 'sent' && event.target) text += ` ${event.target}`;
    if (event.detail && event.detail.payment) {
      text += ` (${event.detail.payment})`;
    }

    return `<li><strong>${esc(event.actor)}</strong> ${esc(text)}` +
      `<small>${esc(stamp(event.created_at))}</small></li>`;
  }

  // Fills the History section of the eye panel (server orders only)
  async function loadOrderHistory(id) {
    const box = $('viewOrderHistory');
    if (!box) return;

    box.dataset.orderId = id;

    try {
      const result = await callApi({ action: 'history', id });

      // A newer order was opened meanwhile, or the panel was closed
      if (box.dataset.orderId !== id) return;

      const events = (result.events || []).slice().reverse();   // newest first

      box.hidden = !events.length;
      box.innerHTML = events.length
        ? `<details><summary>${esc(words().history)} (${events.length})</summary>` +
          `<ul class="history-list">${events.map(historyLine).join('')}</ul></details>`
        : '';
    } catch (error) {
      console.warn('History failed:', error);
    }
  }
  // Extra lines for the eye panel
  function serverExtraMeta(order) {
    return [
      order.last_edited_by
        ? `${words().editedBy} ${order.last_edited_by} ${stamp(order.last_edited_at)}`
        : '',
      order.inv_by ? `Invoice: ${order.inv_by} ${stamp(order.inv_at)}` : '',
      order.nota_by ? `Nota: ${order.nota_by} ${stamp(order.nota_at)}` : '',
      order.payment ? `${words().payment}: ${order.payment}` : ''
    ].filter(Boolean);
  }
 const EYE_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';

  function renderServerOrders() {
    const host = $('serverOrdersList');
    if (!host) return;

    const w = words();
    const list = visibleServerOrders();

    setServerStatus(`${list.length} ${w.shown}`);

    if (!list.length) {
      host.innerHTML = `<p class="shared-inbox-empty">${esc(w.noOrders)}</p>`;
      return;
    }

    host.innerHTML = list.map(order => {
      const created = new Date(order.created_at);
      const date = Number.isNaN(created.getTime())
        ? w.dateInvalid
        : created.toLocaleString();

      const isDone = order.status === 'completed';
      const count = (order.items || []).length;

      const route = order.recipient_name
        ? `${order.sender_name} → ${order.recipient_name}`
        : order.sender_name;

      const ongkir = Number(order.shipping) > 0
        ? ` · ${w.ongkir} ${money(order.shipping)}`
        : '';

      const id = esc(order.id);

      return `
        <div class="saved-order-card server-card${isDone ? ' is-done' : ''}">
          <div class="saved-order-info">
            <div class="server-card-title">
              <strong>${esc(order.order_no)}</strong>
              <span class="order-status-badge ${isDone ? 'done' : 'open'}">
                ${esc(isDone ? w.done : w.open)}
              </span>
            </div>
            ${order.customer_name
              ? `<small>${esc(order.customer_name)}</small>` : ''}
            <small>
              ${count} ${esc(t('differentProducts'))} ·
              ${esc(money(order.total))}${esc(ongkir)}
            </small>
            <small>${esc(route)} · ${esc(date)}</small>
            ${editedLineHtml(order)}
            ${serverTagsHtml(order)}
          </div>

          <div class="server-card-actions">
            <button type="button" class="primary-button"
                    data-server-load="${id}">${esc(w.load)}</button>
            ${canChangeStatus(order) ? `
              <button type="button" data-server-toggle="${id}">
                ${esc(isDone ? w.reopen : w.markDone)}
              </button>` : ''}
            ${canManage(order) ? `
              <button type="button" class="danger"
                      data-server-delete="${id}">${esc(w.remove)}</button>` : ''}
            <button type="button" class="view-server" data-server-view="${id}"
                    aria-label="${esc(w.view)}" title="${esc(w.view)}">
              ${EYE_ICON}
            </button>
          </div>
        </div>
      `;
    }).join('') + (serverHasMore ? `
      <button type="button" class="server-more" data-server-more>
        ${esc(w.showMore)}
      </button>` : '');
  }

  // Opens the same order panel the Local tab uses (the eye button)
  function viewServerOrder(id) {
    const order = serverOrders.find(item => item.id === id);
    if (!order || typeof window.openViewOrder !== 'function') return;

    setTimeout(() => void loadOrderHistory(order.id), 0);

    window.openViewOrder({
      invoiceNumber: order.order_no,
      name: order.customer_name || '',
      items: order.items || [],
      total: Number(order.total) || 0,
      shipping: Number(order.shipping) || 0,
      orderLocation: order.order_location,
      customerType: order.customer_type,
      extraMeta: serverExtraMeta(order),
      requesterName: order.recipient_name
        ? `${order.sender_name} → ${order.recipient_name}`
        : order.sender_name
    });
  }
  async function loadServerOrders() {
    const problem = notReadyMessage();

    if (problem) {
      setServerStatus(problem);
      return;
    }

    if (serverLoading) return;
    serverLoading = true;

    setServerStatus(words().loading);

    try {
      const result = await callApi({ action: 'list', limit: serverLimit });

      serverOrders = result.orders || [];
      serverHasMore = !!result.hasMore;
      renderServerOrders();
    } catch (error) {
      setServerStatus(error.message);
    } finally {
      serverLoading = false;
    }
  }

  async function refreshAll() {
    await Promise.all([loadServerOrders(), pollInbox()]);
  }

  /* ---------- server tab: actions ---------- */

  async function toggleServerOrder(id) {
    const order = serverOrders.find(item => item.id === id);
    if (!order) return;

    const completing = order.status !== 'completed';

    if (completing && !confirm(`${words().markDone}?`)) return;

    try {
      await callApi({ action: completing ? 'complete' : 'reopen', id });
      showToast(words().changed);
      await refreshAll();
    } catch (error) {
      showToast(`${words().failed}: ${error.message}`);
    }
  }

  async function deleteServerOrder(id) {
    const order = serverOrders.find(item => item.id === id);
    if (!order) return;

    if (!confirm(`${words().deleteConfirm} ${order.order_no}`)) return;

    try {
      await callApi({ action: 'delete', id });
      showToast(words().deleted);
      await refreshAll();
    } catch (error) {
      showToast(`${words().failed}: ${error.message}`);
    }
  }

  function loadServerOrder(id) {
    const order =
      serverOrders.find(item => item.id === id) ||
      inboxOrders.find(item => item.id === id);

    if (order) openServerOrderInCart(order);
  }

  function openServerOrderInCart(order) {
    const importedCart = {};

    for (const item of order.items || []) {
      const sku = String(item.sku || '').trim();
      const qty = Math.floor(Number(item.qty) || 0);
      if (!sku || qty < 1) continue;

      const product = products.find(
        entry => String(entry.sku).trim() === sku
      );

      importedCart[sku] = {
        sku,
        name: product?.short || product?.name || item.name || sku,
        price: Number(item.price) || 0,
        image: product?.image || item.image || '',
        qty: (importedCart[sku]?.qty || 0) + qty
      };
    }

    if (!Object.keys(importedCart).length) {
      showToast(words().noUsable);
      return;
    }

    if (cartValues().length && !confirm(words().emptyCartConfirm)) {
      return;
    }

    cart = importedCart;
    $('customerType').value = order.customer_type || '';
    setOrderLocation(order.order_location || 'Pusat');

    // Keep the original order number (CAT-123 -> 123)
    setCartNo(String(order.order_no || '').replace(/\D/g, ''));
    setShipping(Number(order.shipping) || 0);
    setCartSource({
      type: 'server',
      from: order.sender_name,
      to: order.recipient_name || ''
    });
    saveCart();

    closeQuantitySelector();
    closeSavedOrders();
    openCart();
    showToast(`${words().loadedFrom} ${order.sender_name}`);
  }

  /* ---------- move a local saved order to the server ---------- */

  async function moveToServer(id, replace = false) {
    const order = savedOrders.find(item => item.id === id);
    if (!order) return;

    if (!REQUESTER_NAMES.includes(requesterName)) {
      showRequesterPrompt();
      showToast(t('selectName'));
      return;
    }

    if (!(settings.inboxPin || '').trim()) {
      openSettings();
      showToast(words().needPin);
      return;
    }

    if (!replace && !confirm(`${words().moveConfirm}\n\n${savedTitle(order)}`)) return;

    const number = String(
      order.orderNo || order.invoiceNumber || order.id || ''
    ).replace(/\D/g, '');

    try {
      await callApi({
        action: 'move',
        replace,
        order: {
          orderNo: `CAT-${number}`,
          customerType: order.customerType,
          orderLocation: order.orderLocation || 'Pusat',
          customerName: order.name || '',
          shipping: Number(order.shipping) || 0,
          items: (order.items || []).map(item => ({
            sku: item.sku,
            name: item.name,
            price: Number(item.price) || 0,
            qty: Number(item.qty) || 0,
            image: item.image || ''
          }))
        }
      });
    } catch (error) {
      // Already on the server: ask before replacing it
      if (error.code === 'exists') {
        const info = error.existing || {};

        if (!error.canReplace) {
          showToast(`${words().existsBlocked} ${info.sender_name || ''}`);
          return;
        }

        const when = info.created_at
          ? new Date(info.created_at).toLocaleString()
          : '';

        if (confirm(
          `${words().existsConfirm}\n\n` +
          `${savedTitle(order)}\n` +
          `${info.sender_name || ''} · ${when}\n` +
          `${info.item_count || 0} ${t('differentProducts')} · ${money(info.total)}`
        )) {
          await moveToServer(id, true);
        }
        return;
      }

      // Nothing was removed locally, so the order is still safe on this device.
      showToast(`${words().failed}: ${error.message}`);
      return;
    }

    savedOrders = savedOrders.filter(item => item.id !== id);
    writeStorage(CONFIG.savedOrdersKey, savedOrders);
    renderSavedOrders();

    showToast(words().moved);
    setSavedTab('server');
  }

  /* ---------- send to a named salesman ---------- */

  function addControls() {
    const cartActions = document.querySelector('.cart-actions');
    const savedOrdersButton = $('savedOrdersTop');

    if (!cartActions || !savedOrdersButton || !$('tabLocal')) {
      console.error('Server orders: required page elements were not found.');
      return false;
    }

    const sendRow = document.createElement('div');
    sendRow.className = 'cart-button-row shared-send-row';

    const sendButton = document.createElement('button');
    sendButton.id = 'sendToSalesman';
    sendButton.type = 'button';
    sendButton.className = 'primary-button shared-send-button';
    sendRow.appendChild(sendButton);

    const firstButtonRow = cartActions.querySelector('.cart-button-row');
    if (firstButtonRow) {
      firstButtonRow.insertAdjacentElement('afterend', sendRow);
    } else {
      cartActions.appendChild(sendRow);
    }

    sendButton.addEventListener('click', openRecipientPopup);

    // Tabs
    $('tabLocal').addEventListener('click', () => setSavedTab('local'));
    $('tabServer').addEventListener('click', () => setSavedTab('server'));

    // The nav button opens the panel (app.js). Pick the tab here:
    // jump to Server when something is waiting for me.
    savedOrdersButton.addEventListener('click', () => {
      setSavedTab(inboxOrders.length ? 'server' : activeTab);
    });

    // Local list: move to server
    $('savedOrdersList').addEventListener('click', event => {
      const button = event.target.closest('[data-move-server]');
      if (button) void moveToServer(button.dataset.moveServer);
    });

    // Server list and toolbar
    const pane = $('serverOrdersPane');

    pane.addEventListener('click', event => {
      const target = event.target;

      if (target.closest('#serverRefresh')) {
        void refreshAll();
        return;
      }

      if (target.closest('[data-server-more]')) {
        serverLimit += PAGE_SIZE;
        void loadServerOrders();
        return;
      }

      const viewButton = target.closest('[data-server-view]');
      if (viewButton) {
        viewServerOrder(viewButton.dataset.serverView);
        return;
      }

      const loadButton = target.closest('[data-server-load]');
      if (loadButton) {
        loadServerOrder(loadButton.dataset.serverLoad);
        return;
      }

      const toggleButton = target.closest('[data-server-toggle]');
      if (toggleButton) {
        void toggleServerOrder(toggleButton.dataset.serverToggle);
        return;
      }

      const deleteButton = target.closest('[data-server-delete]');
      if (deleteButton) {
        void deleteServerOrder(deleteButton.dataset.serverDelete);
      }
    });

    pane.addEventListener('change', event => {
      if (event.target.id === 'serverPersonFilter') {
        personFilter = event.target.value;
        renderServerOrders();
      }

      if (event.target.id === 'serverHideDone') {
        hideDone = event.target.checked;
        renderServerOrders();
      }
    });

    $('languageSelect')?.addEventListener('change', updateLabels);

    updateLabels();
    setSavedTab(activeTab, { load: false });
    renderCart();

    setInterval(() => {
      if (!document.hidden && navigator.onLine) void pollInbox();
    }, 20000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void pollInbox();
    });

    void pollInbox();
    return true;
  }

  function openRecipientPopup() {
    if (!REQUESTER_NAMES.includes(requesterName)) {
      showRequesterPrompt();
      showToast(t('selectName'));
      return;
    }

    if (!cartValues().length) {
      showToast(t('emptyCart'));
      return;
    }

    if (!requireCustomer()) return;

    let selectedRecipient = '';

    const overlay = document.createElement('div');
    overlay.id = 'salesmanRecipientOverlay';
    overlay.className = 'salesman-recipient-overlay';

    overlay.innerHTML = `
      <section class="salesman-recipient-dialog"
               role="dialog" aria-modal="true">
        <h2>${esc(words().send)}</h2>
        <p class="salesman-recipient-prompt">${esc(words().choose)}</p>

        <div class="salesman-recipient-options">
          ${REQUESTER_NAMES.map(name => `
            <button
              type="button"
              class="salesman-recipient-option"
              data-recipient="${esc(name)}"
              aria-pressed="false">
              ${esc(name)}
            </button>
          `).join('')}
        </div>

        <div class="salesman-recipient-actions">
          <button id="cancelSalesmanPopup" type="button">
            ${esc(words().cancel)}
          </button>
          <button id="confirmSalesmanPopup"
                  class="primary-button" type="button" disabled>
            ${esc(words().send)}
          </button>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);

    const closePopup = () => overlay.remove();

    $('cancelSalesmanPopup').onclick = closePopup;

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closePopup();
    });

    overlay.querySelectorAll('[data-recipient]').forEach(button => {
      button.addEventListener('click', () => {
        selectedRecipient = button.dataset.recipient;

        overlay.querySelectorAll('[data-recipient]').forEach(option => {
          const selected = option === button;
          option.classList.toggle('is-selected', selected);
          option.setAttribute('aria-pressed', String(selected));
        });

        $('confirmSalesmanPopup').disabled = false;
      });
    });

    $('confirmSalesmanPopup').onclick = async () => {
      if (!selectedRecipient) {
        showToast(words().choose);
        return;
      }

      closePopup();
      await sendSharedOrder(selectedRecipient);
    };
  }

  async function sendSharedOrder(recipientName) {
    if (!REQUESTER_NAMES.includes(requesterName)) {
      showRequesterPrompt();
      showToast(t('selectName'));
      return;
    }

    const items = cartValues();
    if (!items.length) {
      showToast(t('emptyCart'));
      return;
    }

    const customerType = $('customerType').value;
    if (!customerType) {
      showToast(t('selectCustomerFirst'));
      return;
    }

    if (!(settings.inboxPin || '').trim()) {
      openSettings();
      showToast(words().needPin);
      return;
    }

    if (!(await ensureFreshCartNo('salesman'))) return;

    const button = $('sendToSalesman');
    button.disabled = true;

    try {
      await callApi({
        action: 'send',
        recipientName,
        order: {
          orderNo: `CAT-${getCartNo()}`,
          customerType,
          orderLocation,
          shipping: cartShipping(),
          items: items.map(item => ({
            sku: item.sku,
            name: item.name,
            price: Number(item.price) || 0,
            qty: Number(item.qty) || 0,
            image: item.image || ''
          }))
        }
      });

      markNoUsed('salesman');
      showToast(`${words().sent} ${recipientName}`);

      if (
        activeTab === 'server' &&
        $('savedOrdersPanel')?.classList.contains('open')
      ) {
        await loadServerOrders();
      }
    } catch (error) {
      showToast(`${words().failed}: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

 /* ---------- save every printed / WhatsApp nota or invoice ---------- */

  // Called by the print popup. Never blocks printing.
  async function saveOrderToServer(base, details) {
    try {
      if (!REQUESTER_NAMES.includes(requesterName)) return;
      if (!(settings.inboxPin || '').trim()) return;

      const customerType = details.customerType || base.customerType || '';
      const digits = String(base.invoiceNumber || '').replace(/\D/g, '');

      if (!customerType || !digits) {
        showToast(words().printNotSaved);
        return;
      }

      await callApi({
        action: 'print',
        docType: details.docType,
        payment: details.payment || '',
        order: {
          orderNo: `CAT-${digits}`,
          customerType,
          orderLocation: base.orderLocation || orderLocation,
          customerName: details.name || '',
          shipping: Number(base.shipping) || 0,
          items: (base.items || []).map(item => ({
            sku: item.sku,
            name: item.name,
            price: Number(item.price) || 0,
            qty: Number(item.qty) || 0,
            image: item.image || ''
          }))
        }
      });

      showToast(words().printSaved);

      if (
        activeTab === 'server' &&
        $('savedOrdersPanel')?.classList.contains('open')
      ) {
        void loadServerOrders();
      }
    } catch (error) {
      showToast(`${words().printNotSaved}: ${error.message}`);
    }
  }

  window.saveOrderToServer = saveOrderToServer;

   window.saveOrderToServer = saveOrderToServer;

  // Called after "Save order" (local). If the same number is on the server,
  // ask whether to update the server copy too.
  window.syncSavedToServer = async function (order) {
    try {
      if (!REQUESTER_NAMES.includes(requesterName)) return;
      if (!(settings.inboxPin || '').trim()) return;

      const digits = String(order.orderNo || '').replace(/\D/g, '');
      if (!digits) return;

      const result = await callApi({ action: 'list', limit: 300 });
      const onServer = (result.orders || []).find(
        row => row.order_no === `CAT-${digits}`
      );
      if (!onServer) return;

      const who = onServer.last_edited_by || onServer.sender_name || '';
      const done = onServer.status === 'completed' ? ' (Done)' : '';

      if (!confirm(
        `CAT-${digits}${done} juga ada di server` +
        (who ? ` (terakhir diubah: ${who})` : '') + `.\n\n` +
        `OK = perbarui juga yang di server\n` +
        `Cancel = simpan lokal saja`
      )) return;

      await callApi({
        action: 'move',
        replace: true,
        order: {
          orderNo: `CAT-${digits}`,
          customerType: order.customerType,
          orderLocation: order.orderLocation || 'Pusat',
          customerName: order.name || '',
          shipping: Number(order.shipping) || 0,
          items: (order.items || []).map(item => ({
            sku: item.sku,
            name: item.name,
            price: Number(item.price) || 0,
            qty: Number(item.qty) || 0,
            image: item.image || ''
          }))
        }
      });

      showToast(words().printSaved);
      if (activeTab === 'server' && $('savedOrdersPanel')?.classList.contains('open')) {
        void loadServerOrders();
      }
    } catch (error) {
      showToast(`${words().failed}: ${error.message}`);
    }
  };
  /* ---------- inbox polling: badge + incoming-order popup ---------- */

  async function pollInbox() {
    if (notReadyMessage()) {
      updateBadges(0);
      return;
    }

    if (inboxRequestRunning) return;
    inboxRequestRunning = true;

    try {
      const result = await callApi({
        action: 'inbox',
        recipientName: requesterName
      });

      inboxOrders = result.orders || [];
      updateBadges(inboxOrders.length);
      checkNewOrders(inboxOrders);
    } catch (error) {
      console.warn('Inbox check failed:', error);
    } finally {
      inboxRequestRunning = false;
    }
  }

  function markSeen(id) {
    const stored = readStorage(SEEN_KEY, []);
    const list = Array.isArray(stored) ? stored : [];
    if (!list.includes(id)) list.push(id);
    writeStorage(SEEN_KEY, list.slice(-300));
  }

  function promptBlocked() {
    const settingsEl = $('settingsPanel');
    const identityEl = $('requesterIdentityOverlay');

    return !!(
      (settingsEl && !settingsEl.classList.contains('hidden')) ||
      (identityEl && identityEl.style.display === 'flex') ||
      $('notaPopupOverlay') ||
      $('salesmanRecipientOverlay') ||
      $('invoiceNoOverlay') ||
      $('savedOrdersPanel')?.classList.contains('open') ||
      $('viewOrderPanel')?.classList.contains('open')
    );
  }

  function checkNewOrders(orders) {
    const seen = readStorage(SEEN_KEY, null);

    // First run on this device: don't pop up for orders that already exist
    if (!Array.isArray(seen)) {
      writeStorage(SEEN_KEY, orders.map(order => order.id));
      return;
    }

    orders.slice().reverse().forEach(order => {   // oldest first
      if (!seen.includes(order.id) &&
          !promptQueue.some(queued => queued.id === order.id)) {
        promptQueue.push(order);
      }
    });

    showNextPrompt();
  }

  function showNextPrompt() {
    if (promptOpen || !promptQueue.length || promptBlocked()) return;
    showOrderPrompt(promptQueue[0]);
  }

  function showOrderPrompt(order) {
    promptOpen = true;

    const count = (order.items || []).length;

    const overlay = document.createElement('div');
    overlay.id = 'orderPromptOverlay';
    overlay.className = 'salesman-recipient-overlay';

    overlay.innerHTML = `
      <section class="salesman-recipient-dialog"
               role="dialog" aria-modal="true">
        <p class="order-prompt-text">
          ${esc(words().orderFrom)}
          <strong>${esc(order.sender_name)}</strong>
          — ${esc(words().openInCart)}
        </p>
        <p class="order-prompt-summary">
          ${esc(order.order_no)} · ${count} ${esc(t('products'))} ·
          ${esc(money(order.total))}
        </p>
        <p class="order-prompt-summary">
          ${esc(order.customer_type)} · ${esc(order.order_location)}
        </p>

        <div class="salesman-recipient-actions">
          <button id="orderPromptLater" type="button">
            ${esc(words().later)}
          </button>
          <button id="orderPromptYes" class="primary-button" type="button">
            ${esc(words().yesOpen)}
          </button>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);

    // Back-gesture guard: this popup owns one history entry
    history.pushState({ centiOrderPrompt: true }, '', location.href);

    const finish = (accepted, fromBack) => {
      overlay.remove();
      window.closeOrderPrompt = null;

      markSeen(order.id);
      promptQueue = promptQueue.filter(queued => queued.id !== order.id);
      promptOpen = false;

      const next = () => {
        if (accepted) openServerOrderInCart(order);
        else showNextPrompt();
      };

      if (fromBack) {          // the back gesture already removed the entry
        next();
        return;
      }

      // Remove our history entry first, then continue, so the cart's
      // guard entry is not pushed on top of a pending history.back().
      let done = false;
      const run = () => {
        if (done) return;
        done = true;
        next();
      };

      window.addEventListener('popstate', run, { once: true });
      window.__skipPop = true;
      history.back();
      setTimeout(run, 400);    // fallback
    };

    window.closeOrderPrompt = () => finish(false, true);

    $('orderPromptLater').onclick = () => finish(false, false);
    $('orderPromptYes').onclick = () => finish(true, false);
    // No tap-outside-to-close: the choice should be deliberate.
  }

  addControls();
})();
