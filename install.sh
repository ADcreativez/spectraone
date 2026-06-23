#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Color definitions for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================${NC}"
echo -e "${GREEN}      SpectraOne Installer & Deployment Script     ${NC}"
echo -e "${BLUE}==================================================${NC}"

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     OS_NAME=Linux;;
    Darwin*)    OS_NAME=Mac;;
    *)          OS_NAME="UNKNOWN:${OS}"
esac

echo -e "${BLUE}[*] Running on OS:${NC} ${OS_NAME}"

# Install System Dependencies (Python3, pip, venv)
if [ "$OS_NAME" = "Linux" ]; then
    # Detect Linux distribution
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
    fi
    
    echo -e "${BLUE}[*] Detecting package manager and installing dependencies...${NC}"
    if [ "$DISTRO" = "ubuntu" ] || [ "$DISTRO" = "debian" ] || [ "$DISTRO" = "raspbian" ]; then
        echo -e "${BLUE}[*] Updating apt package lists...${NC}"
        sudo apt-get update -y
        echo -e "${BLUE}[*] Installing python3, pip, and python3-venv...${NC}"
        sudo apt-get install -y python3 python3-pip python3-venv
    elif [ "$DISTRO" = "centos" ] || [ "$DISTRO" = "rhel" ] || [ "$DISTRO" = "fedora" ]; then
        echo -e "${BLUE}[*] Installing python3 and pip...${NC}"
        sudo dnf install -y python3 python3-pip python3-virtualenv || sudo yum install -y python3 python3-pip python3-virtualenv
    else
        echo -e "${YELLOW}[!] Unknown Linux distribution: $DISTRO. Please ensure Python3 and venv are installed.${NC}"
    fi
elif [ "$OS_NAME" = "Mac" ]; then
    # Check if python3 is installed
    if ! command -v python3 &> /dev/null; then
        echo -e "${YELLOW}[!] Python3 not found. Installing via Homebrew...${NC}"
        if command -v brew &> /dev/null; then
            brew install python3
        else
            echo -e "${RED}[X] Homebrew is not installed. Please install Python3 manually.${NC}"
            exit 1
        fi
    fi
fi

# Ensure Python version is 3.8+
PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo -e "${BLUE}[*] Python Version:${NC} $PYTHON_VERSION"

# Setup virtual environment
echo -e "${BLUE}[*] Setting up virtual environment (venv)...${NC}"
if [ -d "venv" ]; then
    echo -e "${YELLOW}[!] 'venv' directory already exists. Re-using it.${NC}"
else
    python3 -m venv venv
fi

# Activate virtual environment and install packages
echo -e "${BLUE}[*] Activating virtual environment...${NC}"
source venv/bin/activate

echo -e "${BLUE}[*] Upgrading pip...${NC}"
pip install --upgrade pip

echo -e "${BLUE}[*] Installing python dependencies...${NC}"
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    echo -e "${YELLOW}[!] requirements.txt not found! Installing default dependencies...${NC}"
    pip install fastapi uvicorn python-multipart python-docx
fi

# Optional Systemd service creation for Linux
if [ "$OS_NAME" = "Linux" ] && command -v systemctl &> /dev/null; then
    echo -e "${BLUE}--------------------------------------------------${NC}"
    echo -e "${YELLOW}[?] Systemd detected. Do you want to configure a systemd service? (y/n)${NC}"
    read -r setup_service
    if [[ "$setup_service" =~ ^[Yy]$ ]]; then
        APP_DIR=$(pwd)
        USER_NAME=$(whoami)
        
        SERVICE_FILE="/etc/systemd/system/spectraone.service"
        echo -e "${BLUE}[*] Creating systemd service file at ${SERVICE_FILE}...${NC}"
        
        sudo bash -c "cat > ${SERVICE_FILE} <<EOF
[Unit]
Description=SpectraOne Cybersecurity Assessment Service
After=network.target

[Service]
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/python ${APP_DIR}/app-spectraone.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF"

        echo -e "${BLUE}[*] Reloading systemd daemon...${NC}"
        sudo systemctl daemon-reload
        echo -e "${BLUE}[*] Enabling spectraone service to start on boot...${NC}"
        sudo systemctl enable spectraone
        echo -e "${BLUE}[*] Starting spectraone service...${NC}"
        sudo systemctl start spectraone
        
        echo -e "${GREEN}[✓] Systemd service configuration complete!${NC}"
        echo -e "    Use 'sudo systemctl status spectraone' to check the status."
        echo -e "    Use 'sudo systemctl restart spectraone' to restart the application."
    fi
fi

echo -e "${BLUE}==================================================${NC}"
echo -e "${GREEN}[✓] SpectraOne installation completed successfully!${NC}"
echo -e "${BLUE}==================================================${NC}"
echo -e "To start the application manually:"
echo -e "  1. Activate venv:   ${YELLOW}source venv/bin/activate${NC}"
echo -e "  2. Run the server:  ${YELLOW}python app-spectraone.py${NC}"
echo -e "Or simply run:        ${YELLOW}./venv/bin/python app-spectraone.py${NC}"
echo -e "The application is listening on port 9000 and accessible from any IP."
echo -e "${BLUE}==================================================${NC}"
