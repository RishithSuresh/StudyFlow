/* ==========================================================================
   DeepTick Pomodoro - Notifications & Toast System
   ========================================================================== */

class NotificationService {
  constructor() {
    this.hasPermission = 'Notification' in window && Notification.permission === 'granted';
  }

  async requestPermission() {
    if (!('Notification' in window)) {
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      this.hasPermission = permission === 'granted';
      return this.hasPermission;
    } catch (e) {
      console.warn('Error requesting notification permission:', e);
      return false;
    }
  }

  notify(title, message, options = {}) {
    // 1. Show native system notification if permitted
    if (this.hasPermission && document.visibilityState !== 'visible') {
      try {
        new Notification(title, {
          body: message,
          icon: '/favicon.svg',
          ...options
        });
      } catch (e) {
        console.warn('Native notification failed:', e);
      }
    }

    // 2. Always show in-app toast for visual clarity
    this.showToast(title, message, options.type || 'info', options.icon);
  }

  showToast(title, message, type = 'info', customIcon = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = customIcon;
    if (!icon) {
      if (type === 'success') icon = '🎉';
      else if (type === 'break') icon = '☕';
      else if (type === 'warn') icon = '⚠️';
      else icon = '⏱️';
    }

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" aria-label="Close Notification">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    const dismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 300);
    };

    closeBtn.addEventListener('click', dismiss);
    container.appendChild(toast);

    // Auto-dismiss after 6 seconds
    setTimeout(dismiss, 6000);
  }
}

export const notifier = new NotificationService();
