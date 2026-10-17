#!/usr/bin/env bash
# One-time Droplet setup for Tindapo backend (Ubuntu 24.04, run as root)
#
#   scp deploy/setup.sh root@<IP>:/root/ && ssh root@<IP> "bash /root/setup.sh"
#
# Installs: swap, firewall, Node 22, PM2, Nginx, certbot, and a non-root `deploy` user.
# Safe to re-run.
set -euo pipefail

APP_USER=deploy
APP_DIR=/home/$APP_USER/tindapo-backend

echo "🚀 Updating system..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ufw nginx certbot python3-certbot-nginx unattended-upgrades

echo "💾 Swap (1 GB) — needed on 512 MB droplets..."
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "🔐 Firewall: SSH + HTTP + HTTPS only..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "🔐 Automatic security updates..."
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "📦 Node.js 22..."
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "👤 Deploy user..."
if ! id "$APP_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$APP_USER"
fi
mkdir -p /home/$APP_USER/.ssh "$APP_DIR"
# Reuse root's authorized key so you can also `ssh deploy@<IP>`
if [ -f /root/.ssh/authorized_keys ] && [ ! -s /home/$APP_USER/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/$APP_USER/.ssh/authorized_keys
fi
chmod 700 /home/$APP_USER/.ssh
chmod 600 /home/$APP_USER/.ssh/authorized_keys 2>/dev/null || true
chown -R $APP_USER:$APP_USER /home/$APP_USER

echo "🔁 PM2 starts on boot as $APP_USER..."
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp /home/$APP_USER

echo "🔐 Disable SSH password login (keys only)..."
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
# Drop-ins (e.g. 50-cloud-init.conf) override the main file — force them too
sed -i 's/^PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true
# Ubuntu 24.04 uses socket activation (ssh.service is idle until a connection) — new
# connections read the config fresh, so a reload is only needed if the service is running
systemctl is-active --quiet ssh && systemctl reload ssh || true

echo ""
echo "✅ Setup complete."
echo "   Node: $(node -v)   PM2: $(pm2 -v)"
echo "   Next: create $APP_DIR/.env, then configure Nginx (see GUIDELINE.md Section 12)."
