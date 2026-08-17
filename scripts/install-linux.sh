#!/usr/bin/env bash
# Linux 安装脚本：安装到 /opt/dodogo 并注册 systemd 服务
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/dodogo"

echo "==> 安装目录: $INSTALL_DIR"
sudo mkdir -p "$INSTALL_DIR"

echo "==> 复制文件"
sudo cp "$ROOT/target/release/dodogo" "$INSTALL_DIR/dodogo"
sudo cp "$ROOT/config/config.example.toml" "$INSTALL_DIR/config.toml"
if [ -d "$ROOT/web/static" ]; then sudo cp -r "$ROOT/web/static" "$INSTALL_DIR/static"; fi

echo "==> 创建专用用户与数据目录"
sudo id -u dodogo &>/dev/null || sudo useradd -r -s /usr/sbin/nologin dodogo
sudo mkdir -p "$INSTALL_DIR/data"
sudo chown -R dodogo:dodogo "$INSTALL_DIR"

echo "==> 注册 systemd 服务"
sudo tee /etc/systemd/system/dodogo.service >/dev/null <<EOF
[Unit]
Description=DoDoGo Project Management
After=network.target

[Service]
User=dodogo
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/dodogo --config $INSTALL_DIR/config.toml
Restart=on-failure
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dodogo
sudo systemctl start dodogo
echo "==> 已启动，访问 http://127.0.0.1:8080"
