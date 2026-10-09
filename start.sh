#!/bin/bash
# NeuroLock quick start (macOS / Linux / Git Bash)
ROOT="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "NeuroLock Quick Start"
echo "====================="
echo ""
echo "1) Full stack in Docker (website, API, AAA server, OpenLDAP, rsyslog, MySQL) + mobile app"
echo "2) Local development without Docker (AAA dev server + API + app; MySQL must run on 3307)"
echo "3) Mobile app / Expo only"
echo "4) Stop the Docker stack"
echo ""
read -r -p "Enter choice [1-4]: " choice

docker_up() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Docker is not installed. Install Docker Desktop, or use option 2.${NC}"
        return 1
    fi
    cd "$ROOT" || return 1
    if [ ! -f .env ]; then
        echo "Creating .env with fresh random secrets..."
        if ! node scripts/setup-env.mjs; then
            echo -e "${RED}Could not create .env. Install Node.js, or copy .env.example to .env and fill in the secrets.${NC}"
            return 1
        fi
    fi
    echo -e "${YELLOW}Building and starting containers (first run takes a few minutes)...${NC}"
    docker compose up -d --build || return 1
    echo "Waiting for the API to report healthy..."
    for _ in $(seq 1 90); do
        if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4311/api/health)" = "200" ]; then
            echo -e "${GREEN}Ready: website https://localhost   API http://localhost:4311/api${NC}"
            echo "Audit log: docker compose exec rsyslog tail -f /var/log/neurolock/audit.log"
            return 0
        fi
        sleep 2
    done
    echo -e "${RED}The API is not healthy yet. Check: docker compose ps; docker compose logs aaa api${NC}"
    return 1
}

start_aaa() {
    echo -e "${YELLOW}Starting the AAA server (development mode, in-memory directory)...${NC}"
    cd "$ROOT/aaa-server" || return 1
    PY=$(command -v python3 || command -v python)
    if [ ! -d .venv ]; then
        "$PY" -m venv .venv || return 1
    fi
    BIN=.venv/bin
    [ -d .venv/Scripts ] && BIN=.venv/Scripts
    "$BIN/pip" install -q -r requirements.txt || return 1
    if [ ! -f "$ROOT/infra/certs/dev/api.crt" ]; then
        "$BIN/python" "$ROOT/infra/certs/generate_certs.py" "$ROOT/infra/certs/dev" || return 1
    fi
    "$BIN/python" dev_server.py --certs "$ROOT/infra/certs/dev" > "$ROOT/aaa-server/dev.log" 2>&1 &
    echo -e "${GREEN}AAA server on https://localhost:8443 (log: aaa-server/dev.log)${NC}"
    sleep 4
}

start_backend() {
    echo -e "${YELLOW}Starting the REST API...${NC}"
    cd "$ROOT/neurolock-staff-backend" || return 1
    if [ ! -f .env ]; then
        echo -e "${RED}neurolock-staff-backend/.env is missing. Run: node scripts/setup-env.mjs --dev${NC}"
        return 1
    fi
    [ -d node_modules ] || npm install
    if ! npm run db:setup; then
        echo -e "${RED}Could not reach MySQL. Is it running on port 3307?${NC}"
        return 1
    fi
    npm run dev > "$ROOT/neurolock-staff-backend/dev.log" 2>&1 &
    echo -e "${GREEN}API starting on http://localhost:4311/api (log: neurolock-staff-backend/dev.log)${NC}"
    sleep 3
}

start_frontend() {
    echo -e "${YELLOW}Starting the app (Expo). Press w for web, or scan the QR code with Expo Go.${NC}"
    cd "$ROOT/frontend" || return 1
    [ -d node_modules ] || npm install
    npm start
}

case $choice in
    1) docker_up && start_frontend ;;
    2) start_aaa && start_backend && start_frontend ;;
    3) start_frontend ;;
    4) cd "$ROOT" && docker compose down ;;
    *) echo "Invalid choice"; exit 1 ;;
esac
