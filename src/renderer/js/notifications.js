'use strict';
/* global document */
// ipcRenderer はここでは不要

/**
 * Toast Notification System
 * show(message, type, duration)
 * type: 'success' | 'warning' | 'error' | 'info'
 */
const Notifications = (() => {
  const container = () => document.getElementById('toast-container');

  function show(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container().appendChild(toast);

    const remove = () => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = setTimeout(remove, duration);
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
  }

  return { show };
})();
