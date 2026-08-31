const PARENT_SESSION_STORAGE_KEY = 'allowanceBankParentSession';
const API_BASE_URL = 'https://allowance-backend-muqk.onrender.com/api';

  const state = {
    initial: null,
    parentSessionToken: '',
    parentSessionExpiresAt: '',
    parentDashboard: null,
    activeDialog: null,
    pending: 0,
  };

  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadInitialState();
  });

  function bindEvents() {
    $('setupForm').addEventListener('submit', handleSetupSubmit);
    $('parentLoginForm').addEventListener('submit', handleParentLogin);
    $('parentPurchaseForm').addEventListener('submit', handleParentPurchase);
    $('configForm').addEventListener('submit', handleConfigSave);
    $('addChildForm').addEventListener('submit', handleAddChild);
    $('adjustmentForm').addEventListener('submit', handleAdjustment);
    $('parentSignOut').addEventListener('click', signOutParent);

    $('appMenuButton').addEventListener('click', (event) => {
      event.stopPropagation();
      setMenuOpen(!$('appMenuRoot').classList.contains('is-active'));
    });

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeActiveDialog();
        setMenuOpen(false);
      }
    });
  }

  // Core routing: ensure only one structural screen is visible
  function switchView(activeId) {
    ['setupView', 'parentLoginForm', 'parentDashboard'].forEach(id => {
      const el = $(id);
      if (el) el.hidden = (id !== activeId);
    });
  }

  async function loadInitialState() {
    setBusy(true);
    try {
      state.initial = await callServer('getInitialState');
      const storedSession = readStoredParentSession();

      if (state.initial.needsParentSetup) {
        switchView('setupView');
        $('appMenuRoot').hidden = true;
      } else if (storedSession) {
        await resumeParentSession(storedSession);
      } else {
        showSignedOut();
      }
    } catch (error) {
      clearStoredParentSession();
      showSignedOut();
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetupSubmit(event) {
    event.preventDefault();
    const pin = $('setupPin').value.trim();
    const confirm = $('setupPinConfirm').value.trim();
    if (pin !== confirm) {
      showToast('PINs do not match.', true);
      return;
    }

    await runForm(event.currentTarget, async () => {
      state.initial = await callServer('initializeParentPin', pin);
      $('setupForm').reset();
      showSignedOut(); // Instantly switch to the sign in screen
      showToast('Parent PIN saved. Please sign in.');
    });
  }

  async function handleParentLogin(event) {
    event.preventDefault();
    const pin = $('parentPin').value.trim();

    await runForm(event.currentTarget, async () => {
      applyParentSessionResponse(await callServer('loginParent', pin));
      $('parentLoginForm').reset();
      showToast('Signed in.');
    });
  }

  async function resumeParentSession(sessionToken) {
    applyParentSessionResponse(await callServer('resumeParentSession', sessionToken));
  }

  function applyParentSessionResponse(response) {
    state.parentSessionToken = response.sessionToken;
    state.parentSessionExpiresAt = response.sessionExpiresAt;
    state.parentDashboard = response.dashboard;
    writeStoredParentSession(response.sessionToken, response.sessionExpiresAt);
    renderParentDashboard();
  }

  function renderParentDashboard() {
    const dashboard = state.parentDashboard;
    const config = dashboard.config;
    const activeChildren = dashboard.children.filter((child) => child.active);
    const totalBalanceCents = activeChildren.reduce((total, child) => {
      return total + (Number(child.balanceCents) || 0);
    }, 0);

    // Apply the active view
    switchView('parentDashboard');
    $('appMenuRoot').hidden = false;

    $('dashboardAccountCount').textContent = String(activeChildren.length);
    $('dashboardTotalBalance').textContent = formatMoney(totalBalanceCents);
    $('dashboardMonthlyAllowance').textContent = formatMoney(config.monthlyAllowanceCents);
    $('monthlyAllowance').value = (config.monthlyAllowanceCents / 100).toFixed(2);
    $('currencyCode').value = config.currency;

    renderParentAccountCards(dashboard.children);
    renderParentAccountRows(dashboard.children);
    renderAccountSelects(activeChildren);
    renderLedgerRows($('parentLedgerBody'), dashboard.ledger, true);
  }

  function renderParentAccountCards(children) {
    if (!children || children.length === 0) {
      $('parentAccountCards').innerHTML = '<div class="empty-state">No child accounts yet.</div>';
      return;
    }

    $('parentAccountCards').innerHTML = children
      .map((child) => {
        const statusClass = child.active ? 'is-success' : 'is-danger';
        const statusText = child.active ? 'Active' : 'Inactive';
        return `
          <article class="account-card">
            <div class="account-card-header">
              <h3 class="title is-5">${escapeHtml(child.name)}</h3>
              <span class="tag is-light ${statusClass}">${statusText}</span>
            </div>
            <p class="account-balance">${formatMoney(child.balanceCents)}</p>
          </article>
        `;
      })
      .join('');
  }

  function renderParentAccountRows(children) {
    $('parentChildrenBody').innerHTML = children.length
      ? children.map(renderParentChildRow).join('')
      : '<tr><td class="empty-row has-text-centered has-text-grey" colspan="4">No accounts</td></tr>';
  }

  function renderParentChildRow(child) {
    const statusClass = child.active ? 'is-success' : 'is-danger';
    const statusText = child.active ? 'Active' : 'Inactive';
    const activeLabel = child.active ? 'Deactivate' : 'Activate';
    return `
      <tr>
        <td>${escapeHtml(child.name)}</td>
        <td><span class="tag is-light ${statusClass}">${statusText}</span></td>
        <td class="money-cell">${formatMoney(child.balanceCents)}</td>
        <td>
          <div class="buttons are-small row-actions">
            <button type="button" class="button is-light" data-action="toggle-active" data-id="${escapeHtml(child.id)}" data-active="${child.active ? 'false' : 'true'}">${activeLabel}</button>
            <button type="button" class="button is-light" data-action="reset-pin" data-id="${escapeHtml(child.id)}">Reset PIN</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderAccountSelects(activeChildren) {
    const options = activeChildren.length
      ? activeChildren
          .map((child) => `<option value="${escapeHtml(child.id)}">${escapeHtml(child.name)}</option>`)
          .join('')
      : '<option value="">No active accounts</option>';

    ['parentPurchaseChild', 'adjustmentChild'].forEach((selectId) => {
      $(selectId).innerHTML = options;
      $(selectId).disabled = activeChildren.length === 0;
    });
    $('parentPurchaseForm').querySelector('button[type="submit"]').disabled = activeChildren.length === 0;
    $('adjustmentForm').querySelector('button[type="submit"]').disabled = activeChildren.length === 0;
  }

  async function handleParentPurchase(event) {
    event.preventDefault();
    await runForm(event.currentTarget, async () => {
      state.parentDashboard = await callServer(
        'recordParentPurchase',
        requireParentCredential(),
        $('parentPurchaseChild').value,
        $('parentPurchaseAmount').value,
        $('parentPurchaseDescription').value
      );
      $('parentPurchaseAmount').value = '';
      $('parentPurchaseDescription').value = '';
      renderParentDashboard();
      closeActiveDialog();
      showToast('Purchase deducted.');
    });
  }

  async function handleConfigSave(event) {
    event.preventDefault();
    await runForm(event.currentTarget, async () => {
      state.parentDashboard = await callServer('updateConfig', requireParentCredential(), {
        monthlyAllowance: $('monthlyAllowance').value,
        currency: $('currencyCode').value,
      });
      renderParentDashboard();
      closeActiveDialog();
      showToast('Settings saved.');
    });
  }

  async function handleAddChild(event) {
    event.preventDefault();
    await runForm(event.currentTarget, async () => {
      state.parentDashboard = await callServer(
        'createChild',
        requireParentCredential(),
        $('newChildName').value,
        $('newChildPin').value
      );
      $('addChildForm').reset();
      renderParentDashboard();
      closeActiveDialog();
      showToast('Account added.');
    });
  }

  async function handleAdjustment(event) {
    event.preventDefault();
    await runForm(event.currentTarget, async () => {
      state.parentDashboard = await callServer(
        'recordAdjustment',
        requireParentCredential(),
        $('adjustmentChild').value,
        $('adjustmentAmount').value,
        $('adjustmentDescription').value
      );
      $('adjustmentAmount').value = '';
      $('adjustmentDescription').value = '';
      renderParentDashboard();
      closeActiveDialog();
      showToast('Correction recorded.');
    });
  }

  async function signOutParent() {
    const sessionToken = state.parentSessionToken;
    showSignedOut();
    clearStoredParentSession();
    if (!sessionToken) {
      return;
    }

    await runAction(async () => {
      await callServer('signOutParentSession', sessionToken);
    }, { suppressErrors: true });
  }

  async function handleDocumentClick(event) {
    const closeTrigger = event.target.closest('[data-close-dialog]');
    if (closeTrigger) {
      event.preventDefault();
      closeActiveDialog();
      return;
    }

    const menuAction = event.target.closest('[data-dialog]');
    if (menuAction) {
      openDialog(menuAction.dataset.dialog);
      setMenuOpen(false);
      return;
    }

    const accountAction = event.target.closest('[data-action]');
    if (accountAction) {
      await handleAccountAction(accountAction);
      return;
    }

    if (!$('appMenuRoot').hidden && !$('appMenuRoot').contains(event.target)) {
      setMenuOpen(false);
    }
  }

  async function handleAccountAction(button) {
    if (!state.parentSessionToken) {
      showSignedOut();
      return;
    }

    const childId = button.dataset.id;
    if (button.dataset.action === 'toggle-active') {
      await runAction(async () => {
        state.parentDashboard = await callServer(
          'setChildActive',
          requireParentCredential(),
          childId,
          button.dataset.active === 'true'
        );
        renderParentDashboard();
        showToast('Account updated.');
      });
      return;
    }

    if (button.dataset.action === 'reset-pin') {
      const newPin = window.prompt('New child PIN');
      if (!newPin) return;
      await runAction(async () => {
        state.parentDashboard = await callServer(
          'updateChildPin',
          requireParentCredential(),
          childId,
          newPin
        );
        renderParentDashboard();
        showToast('PIN updated.');
      });
    }
  }

  function openDialog(dialogId) {
    const dialog = $(dialogId);
    if (!dialog) return;

    closeActiveDialog();
    dialog.hidden = false;
    dialog.classList.add('is-active');
    state.activeDialog = dialog;

    const focusTarget = dialog.querySelector('input, select, button[type="submit"]');
    if (focusTarget) {
      window.setTimeout(() => focusTarget.focus(), 0);
    }
  }

  function closeActiveDialog() {
    if (!state.activeDialog) return;
    state.activeDialog.classList.remove('is-active');
    state.activeDialog.hidden = true;
    state.activeDialog = null;
  }

  function setMenuOpen(isOpen) {
    const menu = $('appMenuRoot');
    if (menu.hidden) return;
    menu.classList.toggle('is-active', Boolean(isOpen));
    $('appMenuButton').setAttribute('aria-expanded', String(Boolean(isOpen)));
  }

  function showSignedOut() {
    state.parentSessionToken = '';
    state.parentSessionExpiresAt = '';
    state.parentDashboard = null;
    $('parentPin').value = '';
    
    // Fallback to strict login UI lock
    switchView('parentLoginForm');
    $('appMenuRoot').hidden = true;
    setMenuOpen(false);
    closeActiveDialog();
  }

  function requireParentCredential() {
    if (!state.parentSessionToken) {
      throw new Error('Sign in first.');
    }
    return state.parentSessionToken;
  }

  function readStoredParentSession() {
    try {
      const raw = window.localStorage.getItem(PARENT_SESSION_STORAGE_KEY);
      if (!raw) return '';

      const session = JSON.parse(raw);
      if (!session.token || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
        clearStoredParentSession();
        return '';
      }

      return session.token;
    } catch (error) {
      clearStoredParentSession();
      return '';
    }
  }

  function writeStoredParentSession(token, expiresAt) {
    try {
      window.localStorage.setItem(
        PARENT_SESSION_STORAGE_KEY,
        JSON.stringify({ token: token, expiresAt: expiresAt })
      );
    } catch (error) {
      showToast('This browser could not persist the sign in.', true);
    }
  }

  function clearStoredParentSession() {
    try {
      window.localStorage.removeItem(PARENT_SESSION_STORAGE_KEY);
    } catch (error) {
      // Ignore storage errors while signing out or recovering from bad data.
    }
  }

  function renderLedgerRows(target, rows, includeChild) {
    const colspan = includeChild ? 6 : 5;
    if (!rows || rows.length === 0) {
      target.innerHTML = `<tr><td class="empty-row has-text-centered has-text-grey" colspan="${colspan}">No activity</td></tr>`;
      return;
    }

    target.innerHTML = rows
      .map((row) => {
        const amountClass = row.amountCents < 0
          ? 'has-text-danger has-text-weight-bold'
          : 'has-text-success has-text-weight-bold';
        const childCell = includeChild ? `<td>${escapeHtml(row.childName)}</td>` : '';
        return `
          <tr>
            <td>${escapeHtml(row.timestamp)}</td>
            ${childCell}
            <td>${formatType(row.type)}</td>
            <td>${escapeHtml(formatDetail(row))}</td>
            <td class="money-cell ${amountClass}">${formatSignedMoney(row.amountCents)}</td>
            <td class="money-cell">${formatMoney(row.balanceAfterCents)}</td>
          </tr>
        `;
      })
      .join('');
  }

  function formatDetail(row) {
    if (row.relatedChildName) {
      return `${row.description} (${row.relatedChildName})`;
    }
    if (row.period) {
      return `${row.description} ${row.period}`;
    }
    return row.description || '';
  }

  function formatType(type) {
    return String(type || '')
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function formatMoney(cents) {
    const currency =
      (state.parentDashboard && state.parentDashboard.config.currency) ||
      (state.initial && state.initial.config.currency) ||
      'USD';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format((Number(cents) || 0) / 100);
  }

  function formatSignedMoney(cents) {
    const value = Number(cents) || 0;
    return `${value < 0 ? '-' : '+'}${formatMoney(Math.abs(value))}`;
  }

  async function runForm(form, task) {
    setFormDisabled(form, true);
    try {
      await task();
    } catch (error) {
      handleError(error);
    } finally {
      setFormDisabled(form, false);
    }
  }

  async function runAction(task, options = {}) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      if (!options.suppressErrors) {
        handleError(error);
      }
    } finally {
      setBusy(false);
    }
  }

  function setFormDisabled(form, disabled) {
    Array.from(form.elements).forEach((element) => {
      element.disabled = disabled;
    });
    setBusy(disabled);
  }

  function setBusy(isBusy) {
    state.pending += isBusy ? 1 : -1;
    state.pending = Math.max(0, state.pending);
    const isWorking = state.pending > 0;
    
    document.body.classList.toggle('busy', isWorking);
    
    // Toggle the new visual overlay
    const loader = $('globalLoader');
    if (loader) loader.hidden = !isWorking;
  }

  function handleError(error) {
    const message = (error && error.message) || String(error);
    if (message.indexOf('Parent session expired') !== -1) {
      clearStoredParentSession();
      showSignedOut();
    }
    showToast(message, true);
  }

  async function callServer(method, ...args) {
    let endpoint = '';
    let payload = {};

    if (method === 'getInitialState') {
      const response = await fetch(API_BASE_URL + '/initial-state');
      if (!response.ok) throw new Error('Server error');
      return response.json();
    } 
    else if (method === 'initializeParentPin') {
      endpoint = '/setup-parent-pin';
      payload = { pin: args[0] };
    }
    else if (method === 'loginParent' || method === 'resumeParentSession') {
      endpoint = '/parent/login'; 
      payload = { pin: args[0] };
    }
    else if (method === 'createChild') {
      endpoint = '/parent/child/create';
      payload = { pin: args[0], name: args[1], childPin: args[2] };
    }
    else if (method === 'setChildActive') {
      endpoint = '/parent/child/active';
      payload = { pin: args[0], childId: args[1], active: args[2] };
    }
    else if (method === 'updateChildPin') {
      endpoint = '/parent/child/pin';
      payload = { pin: args[0], childId: args[1], newPin: args[2] };
    }
    else if (method === 'updateConfig') {
      endpoint = '/parent/config';
      payload = { pin: args[0], monthlyAllowance: args[1].monthlyAllowance, currency: args[1].currency };
    }
    else if (method === 'recordParentPurchase') {
      endpoint = '/parent/purchase';
      payload = { pin: args[0], childId: args[1], amount: args[2], description: args[3] };
    }
    else if (method === 'recordAdjustment') {
      endpoint = '/parent/adjustment';
      payload = { pin: args[0], childId: args[1], amount: args[2], description: args[3] };
    }
    else if (method === 'signOutParentSession') {
      return true; 
    }

    const response = await fetch(API_BASE_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || 'Server error');
    }
    return data;
  }

  let toastTimer = null;
  function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('error', Boolean(isError));
    toast.classList.toggle('is-danger', Boolean(isError));
    toast.classList.toggle('is-dark', !isError);
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 3600);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // In loadInitialState(), populate the child dropdown
  function renderInitialState() {
    const children = state.initial.children || [];
    const options = children.length
      ? children.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="">No accounts available</option>';
    
    $('childSelect').innerHTML = options;
  }

  // Handle child login submission
  async function handleChildLogin(event) {
    event.preventDefault();
    const childId = $('childSelect').value;
    const pin = $('childPin').value.trim();

    await runForm(event.currentTarget, async () => {
      const dashboard = await callServer('getChildDashboard', childId, pin);
      renderChildDashboard(dashboard);
      showToast('Welcome, ' + dashboard.child.name + '!');
    });
  }

  function renderChildDashboard(dashboard) {
    ['setupView', 'parentLoginForm', 'parentDashboard', 'childLoginForm'].forEach(id => {
      $(id).hidden = true;
    });
    $('childDashboard').hidden = false;

    $('childAccountName').textContent = dashboard.child.name;
    $('childBalance').textContent = formatMoney(dashboard.balanceCents);
    
    // Render child specific rows
    renderChildLedgerRows($('childLedgerBody'), dashboard.transactions);
  }