# AOWeb

Proyecto creado por Damián Catanzaro.

X: [@DamianCatanzaro](https://x.com/DamianCatanzaro)

## Requisitos

- Node.js 22 o superior
- pnpm
- Docker, recomendado para PostgreSQL
- psql, opcional si preferis restaurar el dump desde el host

## 1. Levantar La Base De Datos

El dump inicial del juego esta en `database/aoweb.sql`.

Desde la carpeta padre del proyecto:

```bash
docker run --name aoweb-postgres \
  -e POSTGRES_DB=aoweb \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1:5432:5432 \
  -d postgres:18-alpine
```

Restaurar la base:

```bash
docker exec -i aoweb-postgres psql -U postgres -d aoweb < database/aoweb.sql
```

La URL local para la API queda:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aoweb
```

## 2. Levantar La API

Crear `api/.env` tomando como base `api/.env.example`:

```bash
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aoweb
TOKEN_AUTH=changeme
CORS_ORIGIN=http://localhost:3000
```

Instalar dependencias y levantar en desarrollo:

```bash
cd api
pnpm install
pnpm dev
```

La API queda en `http://localhost:3001`.

## 3. Levantar El Server Del Juego

En otra terminal, crear `server/.env` tomando como base `server/.env.example`:

```bash
NODE_ENV=development
AOWEB_TEST_MODE=false
INITIAL_ONLINE_RECORD=0
PORT=7666
API_BASE_URL=http://127.0.0.1:3001
RESET_CONNECTED_CHARACTERS_ON_STARTUP=false
TOKEN_AUTH=changeme
```

Instalar dependencias y levantar:

```bash
cd server
pnpm install
pnpm dev
```

El server WebSocket queda en `ws://localhost:7666`.

## 4. Levantar El Frontend

En otra terminal, crear `frontend/.env.local` tomando como base `frontend/.env.example`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
API_BASE_URL=http://localhost:3001
TOKEN_AUTH=changeme
NEXT_PUBLIC_WS_URL=ws://localhost:7666
```

Instalar dependencias y levantar:

```bash
cd frontend
pnpm install
pnpm dev
```

Abrir `http://localhost:3000`.

## Capturas

![Captura 1](screenshots/1.jpg)

![Captura 2](screenshots/2.jpg)

![Captura 3](screenshots/3.jpg)

![Captura 4](screenshots/4.jpg)
